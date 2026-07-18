// Server-side lyrics cache (KTD-3). LRCLIB is free and keyless but rate-limited by
// courtesy; caching lookups in Postgres keeps repeat plays of the same song off the
// network. Crucially, a confirmed MISS is cached too (`found: false`) so the honest
// "No lyrics available for this song" state (R7/AE2) is served from cache without
// re-hitting LRCLIB every time.
//
// GLOBAL data — lyrics for a song are identical for every user, so there is no
// ownerId. U9 builds the LRCLIB client + lyrics route on top of this skeleton.

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

// Default lifetime. Lyrics change rarely; a long TTL is safe. A miss can be given a
// shorter TTL by the caller (a song may gain lyrics later), hence the injectable arg.
export const LYRICS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Build the normalized cache key from track identity. Exported so the route and tests
// key identically. Duration is bucketed to the second; title/artist are lowercased and
// whitespace-collapsed so trivial spelling differences share an entry.
export function lyricsKey(title: string, artist: string | null, durationSec: number | null): string {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return [norm(title), artist ? norm(artist) : "", durationSec ?? ""].join("|");
}

// The cached lyrics payload shape returned to the route/component.
export type CachedLyrics = {
  found: boolean;
  syncedLyrics: string | null;
  plainLyrics: string | null;
};

// Read cached lyrics for a track, or null on a miss OR an expired entry (null = the
// route should query LRCLIB). A cached `found: false` is a real hit — it returns the
// honest empty state without another network call. `now` injectable for tests.
export async function readLyricsCache(
  title: string,
  artist: string | null,
  durationSec: number | null,
  db: PrismaClient = prisma,
  now: Date = new Date(),
): Promise<CachedLyrics | null> {
  const trackKey = lyricsKey(title, artist, durationSec);
  const row = await db.lyricsCache.findUnique({ where: { trackKey } });
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null; // expired
  return { found: row.found, syncedLyrics: row.syncedLyrics, plainLyrics: row.plainLyrics };
}

// Write (upsert) a lyrics lookup result — including a confirmed miss (found: false).
// `ttlMs` and `now` injectable so tests assert the expiry.
export function writeLyricsCache(
  title: string,
  artist: string | null,
  durationSec: number | null,
  payload: CachedLyrics,
  db: PrismaClient = prisma,
  ttlMs: number = LYRICS_CACHE_TTL_MS,
  now: Date = new Date(),
) {
  const trackKey = lyricsKey(title, artist, durationSec);
  const expiresAt = new Date(now.getTime() + ttlMs);
  return db.lyricsCache.upsert({
    where: { trackKey },
    create: {
      trackKey,
      found: payload.found,
      syncedLyrics: payload.syncedLyrics,
      plainLyrics: payload.plainLyrics,
      expiresAt,
    },
    update: {
      found: payload.found,
      syncedLyrics: payload.syncedLyrics,
      plainLyrics: payload.plainLyrics,
      expiresAt,
    },
  });
}
