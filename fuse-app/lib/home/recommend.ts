// Home-feed ranking + trending graduation (U12, R10/R11, KTD-4).
//
// Pure and framework-free so the "learning" behaviour the product promises is a
// unit-tested function, not scattered UI logic. Two decisions live here:
//
//   1. recommend() — the "more like what you love" row. It scores a candidate pool on
//      TWO independent signals, so the row is about taste and not merely about names:
//        * artist affinity — how much the user's likes (weight 2) and recent plays
//          (weight 1) favour each candidate's artist;
//        * co-play affinity — how often a candidate turns up in the same listening
//          session as something the user already loves (lib/home/coplay.ts), computed
//          from the ownerId + playedAt already stored on every Play row.
//      Source affinity remains only a soft tiebreak. With no history every candidate
//      scores 0, so the pool is returned in its given order (a sensible GENERIC set,
//      never empty — R11's "starts generic"); as the user likes/plays more, both
//      signals pull related items to the top (R11's "gets more personal"). No external
//      catalog call — the pool is assembled by the caller from what we already have.
//      Genre, audio-feature and embedding signals are NOT used: this database stores
//      none of them, and an invented score would be a lie (R17).
//
//   2. chooseTrending() / trendingRowTitle() — KTD-4's graduation. Home shows the
//      starter-picks seed until enough real anonymous play data has accumulated, then
//      switches to the aggregate play-count trending. The threshold is a named constant
//      so the switch point is explicit and testable, and the ROW LABEL follows the same
//      switch — the row only calls itself "Trending" when real play counts back it.

import type { TrackRef } from "@/lib/repos/track";

// KTD-4: how many distinct tracks must have real play counts before aggregate
// trending replaces the starter-picks seed. Below this, Home shows the seed (which
// always has the display fields to render real cover art, R5).
export const TRENDING_GRADUATE_MIN = 8;

// The two honest names for the trending row. The seeded row is a hand-picked starter
// list, NOT a measurement of what people are playing, so it never says "Trending".
export const STARTER_ROW_TITLE = "Starter picks";
export const STARTER_ROW_SUBTITLE = "A few songs to get you going — real trending shows up once people start playing.";
export const TRENDING_ROW_TITLE = "Trending";
export const TRENDING_ROW_SUBTITLE = "Most played across everyone right now.";

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

// Stable identity for a track across sources — used for dedup, React keys, and the
// co-play counts. Takes plain strings so raw database rows (whose `source` column is
// an unvalidated string) can be keyed the same way as validated TrackRefs.
export function trackKey(track: { source: string; nativeId: string }): string {
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
  // Co-play affinity from lib/home/coplay.ts: trackKey -> how many listening sessions
  // this track shared with something the user loves. Optional — with no play history
  // anywhere there is nothing to compute, and the row falls back to artist affinity.
  coPlay?: ReadonlyMap<string, number>;
  limit?: number;
};

// Rank the pool by affinity to the user's taste. Deterministic: ties keep the pool's
// original order, so with no history the result IS the pool order (generic).
export function recommend({ likes, recent, pool, coPlay, limit = 12 }: RecommendInput): TrackRef[] {
  const artistWeight = new Map<string, number>();
  const sourceWeight = new Map<string, number>();

  const learn = (track: TrackRef, weight: number) => {
    const artist = norm(track.artist);
    if (artist) artistWeight.set(artist, (artistWeight.get(artist) ?? 0) + weight);
    sourceWeight.set(track.source, (sourceWeight.get(track.source) ?? 0) + weight);
  };
  for (const track of likes) learn(track, 2);
  for (const track of recent) learn(track, 1);

  // Artist affinity dominates (x10). Co-play — songs people actually listen to in the
  // same sitting as what this user loves — is the second real signal (x4): strong
  // enough to surface a new artist the user has never played, not so strong that it
  // outvotes an artist they have loved twice over. Source affinity stays a gentle
  // tiebreak (x1) so a loved artist always outranks a merely-familiar source.
  const scored = pool.map((track, index) => ({
    track,
    index,
    score:
      (artistWeight.get(norm(track.artist)) ?? 0) * 10 +
      (coPlay?.get(trackKey(track)) ?? 0) * 4 +
      (sourceWeight.get(track.source) ?? 0),
  }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, Math.max(0, limit)).map((s) => s.track);
}

// Has aggregate trending graduated? One rule, used by BOTH the row's contents and the
// row's label, so the two can never disagree and the row can never claim to be
// "Trending" while it is really showing the hand-picked starter seed (R17).
export function isRealTrending(
  counts: readonly TrackRef[],
  minCount: number = TRENDING_GRADUATE_MIN,
): boolean {
  return counts.length >= minCount;
}

// KTD-4 graduation: use aggregate play-count trending once it has at least
// `minCount` distinct tracks; otherwise fall back to the starter-picks seed. Returns a
// fresh array so callers can safely mutate/slice it.
export function chooseTrending(
  seed: readonly TrackRef[],
  counts: readonly TrackRef[],
  minCount: number = TRENDING_GRADUATE_MIN,
): TrackRef[] {
  return isRealTrending(counts, minCount) ? [...counts] : [...seed];
}

// The honest heading + subheading for the trending row, given whether real aggregate
// play data is backing it. `false` is the safe default everywhere: a row we are unsure
// about is described as starter picks, never as trending.
export function trendingRowLabel(isReal: boolean): { title: string; subtitle: string } {
  return isReal
    ? { title: TRENDING_ROW_TITLE, subtitle: TRENDING_ROW_SUBTITLE }
    : { title: STARTER_ROW_TITLE, subtitle: STARTER_ROW_SUBTITLE };
}
