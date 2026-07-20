// Home-feed variety (F-0 item 3) — the same track must never appear in more than one row.
//
// Before this, "Recently played", "Trending", and "More like what you love" were built
// independently, so a hot track could sit in all three at once and the home felt repetitive.
// The rule, in priority order:
//   • Recently played KEEPS whatever it has (it is the most personal, time-ordered row).
//   • Trending EXCLUDES anything already shown in Recently played, backfilling from its pool.
//   • More-like EXCLUDES anything already shown in Recently played OR Trending, backfilling
//     from its pool.
// Each row is given a POOL larger than it displays so, after exclusion, it can still fill up
// from real candidates rather than going short.
//
// Pure and framework-free so the guarantee is a unit-tested function, not scattered UI logic.

import type { TrackRef } from "@/lib/repos/track";
import { trackKey } from "@/lib/home/recommend";

export type DiversifyInput = {
  // Already time-ordered + de-duplicated by the caller. The priority row — kept as-is.
  recentlyPlayed: readonly TrackRef[];
  // Candidate pools (may be larger than the display limit, to allow backfill after exclusion).
  trendingPool: readonly TrackRef[];
  recommendedPool: readonly TrackRef[];
  recentLimit?: number;
  trendingLimit?: number;
  recommendedLimit?: number;
};

export type DiversifyResult = {
  recentlyPlayed: TrackRef[];
  trending: TrackRef[];
  recommended: TrackRef[];
};

// Take up to `limit` tracks from `pool`, skipping any whose key is already in `taken` (and
// any in-pool duplicate). Each track added is recorded in `taken` so later rows exclude it.
function fill(
  pool: readonly TrackRef[],
  limit: number,
  taken: Set<string>,
): TrackRef[] {
  const out: TrackRef[] = [];
  for (const track of pool) {
    if (out.length >= limit) break;
    const key = trackKey(track);
    if (taken.has(key)) continue;
    taken.add(key);
    out.push(track);
  }
  return out;
}

export function diversifyHomeRows(input: DiversifyInput): DiversifyResult {
  const recentLimit = input.recentLimit ?? 12;
  const trendingLimit = input.trendingLimit ?? 12;
  const recommendedLimit = input.recommendedLimit ?? 12;

  // Recently played keeps its own tracks (priority). Seed the "already shown" set from it.
  const taken = new Set<string>();
  const recentlyPlayed = fill(input.recentlyPlayed, recentLimit, taken);
  // Trending excludes what Recently played already shows, backfilling from its pool.
  const trending = fill(input.trendingPool, trendingLimit, taken);
  // More-like excludes everything shown above, backfilling from its pool.
  const recommended = fill(input.recommendedPool, recommendedLimit, taken);

  return { recentlyPlayed, trending, recommended };
}
