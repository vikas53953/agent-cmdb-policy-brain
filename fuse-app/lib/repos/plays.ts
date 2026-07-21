// Play-history + trending repository. Two jobs, both from day one so the data
// exists when the UI that uses it lands (U12):
//   1. Per-user history (R11): `recordPlay` logs a play, `listRecentPlays` reads
//      the user's own recent tracks (recently-played row + recommendation affinity).
//      Owned data — scoped to ownerId.
//   2. Trending (KTD-4): `trendingByPlayCount` aggregates ANONYMOUS play counts
//      across ALL users (no ownerId filter — trending is intentionally global and
//      not attributable to anyone). `trendingSeed` returns the starter-picks seed Home
//      shows (labelled "Starter picks", never "Trending") until enough real play data
//      accumulates. `listRecentPlayEvents` feeds the co-play signal.
//
// U3 provides this skeleton; U12 builds the Home carousels on top. Kept minimal and
// DI'd (db injectable) so it unit-tests without a database.

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ROBOT_EMAIL } from "@/lib/robot-door";
import { toTrackColumns, isTrackSource, type TrackRef } from "./track";

// Record that the caller played a track. Ownership is inherent — the row is written
// with ownerId: userId. Fire-and-forget from the player; never blocks playback.
export function recordPlay(
  userId: string,
  track: {
    source: string;
    nativeId: string;
    title: string;
    artist?: string | null;
    artUrl?: string | null;
  },
  db: PrismaClient = prisma,
) {
  const cols = toTrackColumns(track);
  return db.play.create({
    data: {
      ownerId: userId,
      source: cols.source,
      nativeId: cols.nativeId,
      title: cols.title,
      artist: cols.artist,
      artUrl: cols.artUrl,
    },
  });
}

// The caller's recently played tracks, newest first. Scoped to ownerId — one user's
// history is never visible to another. `limit` caps the row count.
export function listRecentPlays(userId: string, limit = 20, db: PrismaClient = prisma) {
  return db.play.findMany({
    where: { ownerId: userId },
    orderBy: { playedAt: "desc" },
    take: limit,
  });
}

// Raw play events for the co-play signal (audit 36). Returns the minimum needed to
// reconstruct listening sessions — who played it (to keep one person's sitting from
// bleeding into another's), what it was, and when — and nothing else: no title, no
// artist, no user rows. `lib/home/coplay.ts` turns these into sessions and per-track
// co-occurrence counts; only the counts reach the UI, so no individual's history is
// exposed.
//
// Bounded on purpose. `sinceDays` keeps the window recent (what people pair together
// now, not two years ago) and `limit` caps the row count so this can never turn into
// an unbounded table scan. Newest-first, because when the cap bites we want the most
// recent listening, not the oldest.
export function listRecentPlayEvents(
  { sinceDays = 30, limit = 5000 }: { sinceDays?: number; limit?: number } = {},
  db: PrismaClient = prisma,
) {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  return db.play.findMany({
    // Co-play is a cross-user aggregate, so it carries the same robot exclusion as
    // trending: the watchman's plays must not manufacture fake "played together" signal
    // that steers real users' recommendations. (Local plays are intentionally NOT excluded
    // here — co-play only ever emits anonymous (source, nativeId) counts, never titles.)
    where: { playedAt: { gte: since }, ...ROBOT_OWNER_SCOPE },
    select: { ownerId: true, source: true, nativeId: true, playedAt: true },
    orderBy: { playedAt: "desc" },
    take: limit,
  });
}

// The one source whose rows must NEVER feed a global surface.
//
// THE LEAK THIS CLOSES: a "local" play is a file off the user's own machine, so its
// `title` IS their filename — "tax-return-voice-note.mp3", a leaked demo, anything.
// Trending is global and un-owned by design, so a single local play by one person would
// have put that person's private filename on EVERY user's Home. It was latent only
// because the local adapter is not auto-registered yet; that is one line away.
//
// The fix is a QUERY-LEVEL exclusion in the trending aggregate itself, not a filter
// applied by the caller. That is what makes it class-level: every present and future
// reader of trending inherits the exclusion, and no new Home rail can reintroduce the
// leak by forgetting to filter. Local plays still count fully in the OWNER's own
// history (`listRecentPlays`) — that read is ownerId-scoped, so it is theirs to see.
const LOCAL_SOURCE = "local";

// The other identity whose rows must NEVER feed a global surface: the E2E test robot.
//
// THE LEAK THIS CLOSES: the release gate and the 30-minute live-site watchman sign in
// through the robot door (lib/robot-door.ts) as the dedicated `robot@fuse.test` account
// and, on the PRODUCTION deployment, play test tracks and run test searches. Every play
// is a real Play row in the production database, so the robot's plays (e.g. the
// "Robot Fallback Probe" track from e2e/spotify-fallback.spec.ts) were being counted by
// the global trending aggregate and surfaced on every real user's Home. Each watchman
// run added more — deleting the row would not have stopped it re-accumulating in 30
// minutes; only excluding the identity at query time does.
//
// The robot has ONE stable identity — the `robot@fuse.test` User row the door always
// signs in as — so we exclude by that email through the `owner` relation. Matching by a
// hardcoded id is impossible (the User row's id is a runtime-generated cuid), and the
// email is exactly the honest, stable handle the door commits to. Real users always
// carry a Google-verified (non-null) email, so this excludes the robot and nobody else.
//
// This is global-only: the robot's OWN owner-scoped reads (listRecentPlays) still return
// its rows, so its e2e specs that replay their own writes keep working. Its plays are
// walled off from REAL-USER aggregates, not erased.
const ROBOT_OWNER_SCOPE = { owner: { email: { not: ROBOT_EMAIL } } } as const;

// The where-clause every global (cross-user) play read must carry: exclude local-file
// plays (private filenames) AND the E2E robot's plays (test pollution). Folded into one
// constant so every present and future global reader inherits both exclusions and no new
// Home rail can reintroduce either leak by forgetting to filter.
const GLOBAL_PLAY_SCOPE = {
  source: { not: LOCAL_SOURCE },
  ...ROBOT_OWNER_SCOPE,
} as const;

// A trending entry: a track plus how many times it has been played across everyone.
export type TrendingEntry = {
  source: string;
  nativeId: string;
  playCount: number;
};

// Aggregate anonymous play counts across ALL users (KTD-4). Deliberately NOT scoped
// to any ownerId: trending is a global signal, and grouping only by (source, nativeId)
// means no individual's history is exposed. U12 decides when there is "enough" data to
// prefer this over the curated seed.
export async function trendingByPlayCount(limit = 20, db: PrismaClient = prisma): Promise<TrendingEntry[]> {
  const groups = await db.play.groupBy({
    by: ["source", "nativeId"],
    where: GLOBAL_PLAY_SCOPE,
    _count: { _all: true },
    orderBy: { _count: { nativeId: "desc" } },
    take: limit,
  });
  return groups.map((g) => ({ source: g.source, nativeId: g.nativeId, playCount: g._count._all }));
}

// The starter-picks seed (KTD-4), ordered by rank. Global/un-owned; populated by
// prisma/seed.ts. Home shows this — under its own honest "Starter picks" heading —
// until `trendingByPlayCount` has enough to graduate to real trending.
export function trendingSeed(limit = 20, db: PrismaClient = prisma) {
  return db.trendingSeed.findMany({ orderBy: { rank: "asc" }, take: limit });
}

// Aggregate trending as renderable tracks (U12). `trendingByPlayCount` only returns
// identities + counts; a track needs its display fields (title, artist, cover art) to
// render real artwork (R5). Since there is no canonical Track table (KTD-6), the
// display fields live on the Play rows themselves — so we enrich each top group with
// the most recent Play for that (source, nativeId). Global/anonymous: no ownerId
// filter, and a representative row exposes only public display fields, not whose play
// it was. Returns fewer than `limit` if a group has no readable row (never fabricates).
//
// THE BUG THIS KILLS: enrichment used to run one `findFirst` PER trending group inside
// a Promise.all — ~20 serverless-Postgres round-trips on every Home render, and
// unbounded in the sense that it scaled with `limit`, so raising the rail size silently
// multiplied the database cost of the app's most-visited page. Now the whole enrichment
// is ONE `findMany` over the identities we already know, picked apart in memory. The
// query count is constant (2 total: the groupBy plus this) no matter how big the rail
// grows — that is the class-level property, not a smaller N.
export async function trendingTracks(limit = 20, db: PrismaClient = prisma): Promise<TrackRef[]> {
  const groups = await trendingByPlayCount(limit, db);
  if (groups.length === 0) return [];

  // One batched read for every trending identity at once. Same LOCAL_SOURCE exclusion
  // as the aggregate — the display fields are the private part, so the guard has to be
  // on the read that actually returns titles, not only on the counting query.
  const rows = await db.play.findMany({
    where: {
      ...GLOBAL_PLAY_SCOPE,
      OR: groups.map((g) => ({ source: g.source, nativeId: g.nativeId })),
    },
    orderBy: { playedAt: "desc" },
  });

  // Newest-first, so the FIRST row seen for an identity is its most recent play — the
  // same representative row the per-group findFirst used to return.
  const newestByKey = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.source} ${row.nativeId}`;
    if (!newestByKey.has(key)) newestByKey.set(key, row);
  }

  // Emit in trending order (the groups' order), not the rows' order.
  const out: TrackRef[] = [];
  for (const g of groups) {
    const row = newestByKey.get(`${g.source} ${g.nativeId}`);
    if (!row) continue;
    out.push({
      source: isTrackSource(row.source) ? row.source : "youtube",
      nativeId: row.nativeId,
      title: row.title,
      artist: row.artist ?? null,
      artUrl: row.artUrl ?? null,
      durationSec: null,
    });
  }
  return out;
}
