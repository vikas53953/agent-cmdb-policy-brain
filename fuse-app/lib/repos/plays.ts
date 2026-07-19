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
    where: { playedAt: { gte: since } },
    select: { ownerId: true, source: true, nativeId: true, playedAt: true },
    orderBy: { playedAt: "desc" },
    take: limit,
  });
}

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
export async function trendingTracks(limit = 20, db: PrismaClient = prisma): Promise<TrackRef[]> {
  const groups = await trendingByPlayCount(limit, db);
  const rows = await Promise.all(
    groups.map((g) =>
      db.play.findFirst({
        where: { source: g.source, nativeId: g.nativeId },
        orderBy: { playedAt: "desc" },
      }),
    ),
  );
  const out: TrackRef[] = [];
  for (const row of rows) {
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
