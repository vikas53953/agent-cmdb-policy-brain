// Play-history + trending repository. Two jobs, both from day one so the data
// exists when the UI that uses it lands (U12):
//   1. Per-user history (R11): `recordPlay` logs a play, `listRecentPlays` reads
//      the user's own recent tracks (recently-played row + recommendation affinity).
//      Owned data — scoped to ownerId.
//   2. Trending (KTD-4): `trendingByPlayCount` aggregates ANONYMOUS play counts
//      across ALL users (no ownerId filter — trending is intentionally global and
//      not attributable to anyone). `trendingSeed` returns the curated seed Home
//      shows until enough real play data accumulates.
//
// U3 provides this skeleton; U12 builds the Home carousels on top. Kept minimal and
// DI'd (db injectable) so it unit-tests without a database.

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toTrackColumns } from "./track";

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

// The curated trending seed (KTD-4), ordered by rank. Global/un-owned; populated by
// prisma/seed.ts. Home shows this until `trendingByPlayCount` has enough to graduate.
export function trendingSeed(limit = 20, db: PrismaClient = prisma) {
  return db.trendingSeed.findMany({ orderBy: { rank: "asc" }, take: limit });
}
