// Search-result playability (U6, R17 honesty — the class-level fix).
//
// A search result's play button may render ENABLED only if tapping it actually
// plays sound IN THIS COMMIT. That is decided here, from two facts:
//   1. Which source the result is from.
//   2. Whether a playback adapter for that source is registered right now.
//
// At U6 the picture is honest and forward-compatible:
//   • YouTube — its playback adapter lands in U7. Until an adapter is registered,
//     a YouTube result is DISABLED with a plain reason. The moment U7 registers
//     the adapter, `hasAdapter` flips true and the same rows light up — no change
//     needed here.
//   • Spotify — search/metadata work now, but real Spotify playback (and the
//     honest YouTube fallback) land in U15. So a Spotify result is ALWAYS disabled
//     in this commit with "Plays after Spotify support arrives", regardless of any
//     adapter — never a clickable dead result (the plan's interim-honesty rule).
//   • local — never appears in search results (it is device files for the DJ).
//
// Pure and framework-free so it is unit-tested in node without a DOM.

import type { TrackSource } from "@/lib/repos/track";

// Interim reasons, in plain words a non-technical owner reads (R17).
export const SPOTIFY_SOON_REASON = "Plays after Spotify support arrives";
export const ENGINE_SOON_REASON = "Playback starts once the player engine is connected";
export const LOCAL_NOT_SEARCHABLE_REASON = "Your own files are added in the DJ, not from search";

export type Playability = { playable: boolean; reason: string | null };

// Decide whether a result of `source` can play now, given whether that source's
// adapter is currently registered in the player.
export function resultPlayability(source: TrackSource, hasAdapter: boolean): Playability {
  if (source === "spotify") {
    // Deferred to U15 by design — disabled even if some adapter existed.
    return { playable: false, reason: SPOTIFY_SOON_REASON };
  }
  if (source === "local") {
    return { playable: false, reason: LOCAL_NOT_SEARCHABLE_REASON };
  }
  // YouTube: honest to the registry — enabled only once U7's adapter is wired.
  return hasAdapter ? { playable: true, reason: null } : { playable: false, reason: ENGINE_SOON_REASON };
}
