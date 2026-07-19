// Adaptive crossfade length (F-0 item 4) — the user's slider becomes the MAX, and the
// engine clamps the melt PER PAIR so the transition suits the two songs.
//
// The problem it fixes: a fixed slider value was the only truth, so a punchy vocal song
// melting into another punchy vocal song got the same long overlap as two ambient mixes —
// producing a muddy stretch of two voices singing over each other ("vocal-on-vocal mush").
//
// The rule, honest and duration/title-based (YouTube hands us no BPM, so we never invent
// one):
//   • Long melts are allowed only when BOTH tracks are long-form / ambient (a lofi stream,
//     a DJ mix, a very long upload) — those have no clashing vocal hook, so a long blend is
//     musical.
//   • Otherwise (any typical-length song is involved) the melt is clamped SHORT (2–4s) so
//     two vocals never overlap for long.
// The configured setting is the CEILING in both cases — "up to Ns"; the engine only ever
// clamps DOWN from it, never above it.
//
// Pure and framework-free (no DOM, no store) so every clamp rule is unit-tested in node.

import type { TrackRef } from "@/lib/repos/track";
import { CROSSFADE_MAX_SEC } from "@/lib/repos/settings";

// A short melt lives in this 2–4s window — long enough to feel blended, short enough that
// two vocal hooks never sit on top of each other. Deliberately allows 2s, BELOW the
// settings floor of 3s: the adaptive clamp is a per-pair safety, separate from the range a
// person can DIAL. The setting stays the ceiling.
export const SHORT_MELT_MIN_SEC = 2;
export const SHORT_MELT_MAX_SEC = 4;

// A track at least this long is treated as long-form (a stream / mix / very long upload)
// no matter what its title says — 20 minutes is well past any ordinary song.
export const LONG_FORM_MIN_DURATION_SEC = 20 * 60;

// Titles that plainly advertise a long-form / ambient upload — the kind a long melt suits.
// Word-boundary matched so "remix" never trips "mix" falsely and an ordinary song title
// never reads as a stream. Conservative on purpose: when unsure, we treat it as a song and
// keep the melt short (the safe default — a short melt never causes mush).
const LONG_FORM_TITLE_RE =
  /\b(lo-?fi|chill-?hop|dj\s*(set|mix)|mega\s*mix|mixtape|\d+\s*\/\s*\d+|24-?7|radio|live\s*stream|livestream|stream|non-?stop|continuous|compilation|full\s*album|study\s*(beats|mix|music)|sleep\s*(music|mix)|ambient|white\s*noise|playlist)\b/i;

// Is this track a long-form / ambient upload (a long melt suits it)? True when it is very
// long by duration OR its title advertises a stream/mix/long-form kind. A missing duration
// falls back to the title alone — honest: we use what we truly know.
export function isLongForm(track: Pick<TrackRef, "title" | "durationSec">): boolean {
  if (track.durationSec != null && track.durationSec >= LONG_FORM_MIN_DURATION_SEC) {
    return true;
  }
  return LONG_FORM_TITLE_RE.test(track.title ?? "");
}

// The plain-words class of a track, for an honest on-screen hint about the melt length.
export type MeltClass = "long-form" | "song";

export function meltClass(track: Pick<TrackRef, "title" | "durationSec">): MeltClass {
  return isLongForm(track) ? "long-form" : "song";
}

export type AdaptiveInput = {
  // The user's configured crossfade length — the CEILING. Clamped to the honest window.
  maxSec: number;
  current: Pick<TrackRef, "title" | "durationSec">;
  next: Pick<TrackRef, "title" | "durationSec">;
};

function clampToCeiling(seconds: number): number {
  if (!Number.isFinite(seconds)) return SHORT_MELT_MAX_SEC;
  return Math.min(CROSSFADE_MAX_SEC, Math.max(SHORT_MELT_MIN_SEC, Math.round(seconds)));
}

// The adapted melt length for a (current → next) pair, never above the configured ceiling.
//   • both long-form  → the full configured length (a long, musical melt).
//   • anything else   → a short 2–4s melt (clamp the ceiling into the short window), so a
//     vocal song never overlaps another vocal for long.
export function adaptedCrossfadeSec(input: AdaptiveInput): number {
  const ceiling = clampToCeiling(input.maxSec);
  const bothLongForm = isLongForm(input.current) && isLongForm(input.next);
  if (bothLongForm) return ceiling;
  // Short melt: clamp the ceiling into the 2–4s window (a small setting stays small; a big
  // setting is pulled down to 4s for the punchy pair).
  return Math.min(SHORT_MELT_MAX_SEC, Math.max(SHORT_MELT_MIN_SEC, ceiling));
}

// An honest, jargon-free reason for the chosen melt length — shown in the Transition
// Moment so the countdown's length is explained, never a mystery number.
export function meltReason(input: AdaptiveInput): string {
  const bothLongForm = isLongForm(input.current) && isLongForm(input.next);
  return bothLongForm
    ? "Long melt — both are long-form mixes"
    : "Short melt — keeping the vocals clear";
}
