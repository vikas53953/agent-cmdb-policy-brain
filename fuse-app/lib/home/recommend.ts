// Home-feed ranking + trending graduation (U12, R10/R11, KTD-4).
//
// Pure and framework-free so the "learning" behaviour the product promises is a
// unit-tested function, not scattered UI logic. Two decisions live here:
//
//   1. recommend() — the "more like what you love" row. It scores a candidate pool
//      by how much the user's likes (weight 2) and recent plays (weight 1) favour
//      each candidate's artist (and, as a soft tiebreak, its source). With no
//      history every candidate scores 0, so the pool is returned in its given order
//      (a sensible GENERIC set, never empty — R11's "starts generic"); as the user
//      likes/plays more, that history pulls related items to the top (R11's "gets
//      more personal"). No external catalog call — the pool is assembled by the
//      caller from what we already have (trending + the user's own tracks).
//
//   2. chooseTrending() — KTD-4's graduation. Home shows the curated seed until
//      enough real anonymous play data has accumulated, then switches to the
//      aggregate play-count trending. The threshold is a named constant so the
//      switch point is explicit and testable.

import type { TrackRef } from "@/lib/repos/track";

// KTD-4: how many distinct tracks must have real play counts before aggregate
// trending replaces the curated seed. Below this, Home shows the seed (which always
// has the display fields to render real cover art, R5).
export const TRENDING_GRADUATE_MIN = 8;

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

// Stable identity for a track across sources — used for dedup and React keys.
export function trackKey(track: Pick<TrackRef, "source" | "nativeId">): string {
  return `${track.source}:${track.nativeId}`;
}

// Merge several track lists into one, keeping the FIRST occurrence of each track and
// its original order. The caller uses this to build a single candidate pool without
// the same song appearing twice.
export function dedupeTracks(lists: readonly (readonly TrackRef[])[]): TrackRef[] {
  const seen = new Set<string>();
  const out: TrackRef[] = [];
  for (const list of lists) {
    for (const track of list) {
      const key = trackKey(track);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(track);
    }
  }
  return out;
}

export type RecommendInput = {
  // The user's liked tracks (strongest signal of taste). Empty for a new account.
  likes: readonly TrackRef[];
  // The user's recently played tracks (a weaker, more transient signal).
  recent: readonly TrackRef[];
  // The candidate tracks to rank (assembled by the caller — trending + the user's
  // own tracks). Its given order is the generic fallback when there is no history.
  pool: readonly TrackRef[];
  limit?: number;
};

// Rank the pool by affinity to the user's taste. Deterministic: ties keep the pool's
// original order, so with no history the result IS the pool order (generic).
export function recommend({ likes, recent, pool, limit = 12 }: RecommendInput): TrackRef[] {
  const artistWeight = new Map<string, number>();
  const sourceWeight = new Map<string, number>();

  const learn = (track: TrackRef, weight: number) => {
    const artist = norm(track.artist);
    if (artist) artistWeight.set(artist, (artistWeight.get(artist) ?? 0) + weight);
    sourceWeight.set(track.source, (sourceWeight.get(track.source) ?? 0) + weight);
  };
  for (const track of likes) learn(track, 2);
  for (const track of recent) learn(track, 1);

  // Artist affinity dominates (x10); source affinity is only a gentle tiebreak so a
  // loved artist always outranks a merely-familiar source.
  const scored = pool.map((track, index) => ({
    track,
    index,
    score: (artistWeight.get(norm(track.artist)) ?? 0) * 10 + (sourceWeight.get(track.source) ?? 0),
  }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, Math.max(0, limit)).map((s) => s.track);
}

// KTD-4 graduation: use aggregate play-count trending once it has at least
// `minCount` distinct tracks; otherwise fall back to the curated seed. Returns a
// fresh array so callers can safely mutate/slice it.
export function chooseTrending(
  seed: readonly TrackRef[],
  counts: readonly TrackRef[],
  minCount: number = TRENDING_GRADUATE_MIN,
): TrackRef[] {
  return counts.length >= minCount ? [...counts] : [...seed];
}
