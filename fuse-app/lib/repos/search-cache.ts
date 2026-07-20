// Server-side search-result cache (KTD-8). YouTube `search.list` costs 100 units of
// a small daily budget, so a naive search-per-keystroke design exhausts quota in
// minutes. This cache is the first line of defence: the search route normalizes the
// query, reads here, and ONLY on a miss (or an expired entry) hits the external APIs.
//
// This is GLOBAL data, not per-user — search results for "paper cities" are the same
// for everyone, so there is no ownerId and no tenancy concern. U6 builds the search
// route on top of this skeleton.

import type { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// Default cache lifetime. Long TTL is the whole point (KTD-8) — search results are
// stable enough that a day of caching is safe and saves the expensive quota.
export const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Cache-key schema version. BUMP THIS whenever the cached SHAPE or the meaning of a
// cached entry changes, so every pre-existing entry misses immediately instead of
// serving stale data for the rest of its 24h TTL.
//   • v1 — the original entries, which wrongly baked per-source status/reason STRINGS
//          into the cached payload. After the P1 fix those strings are computed fresh on
//          every request and never cached; bumping to v2 guarantees no customer is ever
//          served a v1 entry's stale "…try again" notice again.
//   • v3 — the overnight-QA fix. Two things changed the MEANING of a cached row set: the
//          ranking now surfaces the official artist first, and provider titles are now
//          HTML-decoded at the ingestion boundary (so no "&amp;" is written into a cached
//          row). Bumping to v3 makes every pre-existing entry miss immediately, so no
//          customer is served a stale mis-ordered / raw-entity result set for the rest of
//          its 24h TTL — the fixes take effect the instant this deploys, not a day later.
export const SEARCH_CACHE_VERSION = "v3";

// Normalize a raw query into the cache key so trivially-different spellings share one
// entry: trim, collapse internal whitespace, lowercase. Exported so the route and
// tests key identically (a normalization drift would silently miss the cache).
export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

// The full stored key: the schema version prefixed onto the normalized query. Every
// read and write goes through this, so a version bump invalidates the whole cache at
// once (old-version keys can never collide with new-version keys).
export function cacheKey(raw: string): string {
  return `${SEARCH_CACHE_VERSION}:${normalizeQuery(raw)}`;
}

// Read cached results for a query, or null on a miss OR an expired entry. A null
// return is the route's signal to call the external APIs. `now` is injectable so the
// TTL boundary is testable without wall-clock timing.
export async function readSearchCache(
  rawQuery: string,
  db: PrismaClient = prisma,
  now: Date = new Date(),
): Promise<Prisma.JsonValue | null> {
  const queryKey = cacheKey(rawQuery);
  const row = await db.searchCache.findUnique({ where: { queryKey } });
  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) return null; // expired — treat as a miss
  return row.results;
}

// Write (upsert) results for a query with a TTL. `ttlMs` and `now` are injectable so
// tests can assert the expiry boundary. Upsert so a re-search after expiry refreshes
// the same key rather than erroring on the primary key.
export function writeSearchCache(
  rawQuery: string,
  results: Prisma.InputJsonValue,
  db: PrismaClient = prisma,
  ttlMs: number = SEARCH_CACHE_TTL_MS,
  now: Date = new Date(),
) {
  const queryKey = cacheKey(rawQuery);
  const expiresAt = new Date(now.getTime() + ttlMs);
  return db.searchCache.upsert({
    where: { queryKey },
    create: { queryKey, results, expiresAt },
    update: { results, expiresAt },
  });
}
