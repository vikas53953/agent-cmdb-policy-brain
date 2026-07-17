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

// Normalize a raw query into the cache key so trivially-different spellings share one
// entry: trim, collapse internal whitespace, lowercase. Exported so the route and
// tests key identically (a normalization drift would silently miss the cache).
export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

// Read cached results for a query, or null on a miss OR an expired entry. A null
// return is the route's signal to call the external APIs. `now` is injectable so the
// TTL boundary is testable without wall-clock timing.
export async function readSearchCache(
  rawQuery: string,
  db: PrismaClient = prisma,
  now: Date = new Date(),
): Promise<Prisma.JsonValue | null> {
  const queryKey = normalizeQuery(rawQuery);
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
  const queryKey = normalizeQuery(rawQuery);
  const expiresAt = new Date(now.getTime() + ttlMs);
  return db.searchCache.upsert({
    where: { queryKey },
    create: { queryKey, results, expiresAt },
    update: { results, expiresAt },
  });
}
