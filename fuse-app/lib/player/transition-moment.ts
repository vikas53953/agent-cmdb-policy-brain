// The Transition Moment (F-0 item 1) — the pure truth behind the hero block.
//
// It answers, honestly, "what happens when this song ends?": which track is NEXT, whether
// the two will truly FUSE (a real crossfade), how many seconds until the fuse begins, and —
// only when genuinely computed — an energy/BPM line. When nothing is next it says plainly
// that playback will end.
//
// HONESTY (the heart of F-0): this function invents NOTHING. The energy/BPM line appears
// ONLY when BOTH tracks carry real analysis numbers (local/analyzable audio via
// lib/dj/analysis.ts). For a YouTube↔YouTube pair — which carry no decoded samples — it
// returns only what is true: the next track, the fuse countdown, and a duration/title-based
// hint about the melt length. It never fabricates a BPM or an "energy matched" claim.
//
// Pure and framework-free so every branch is unit-tested in node; the React component
// (components/player/transition-moment.tsx) is a thin render of this view.

import type { TrackRef } from "@/lib/repos/track";
import { meltReason } from "@/lib/player/adaptive-crossfade";
import type { PlaybackMotion } from "@/lib/player/playback-truth";

// Real, computed analysis for a track — present ONLY for locally-analyzable audio. In the
// normal player (YouTube/Spotify) this is always absent, so the energy line stays off.
export type TrackAnalysis = {
  // Beats per minute, as computed by lib/dj/analysis.ts (never a guess).
  bpm: number;
  // Optional relative energy 0..1, when computed.
  energy?: number;
};

export type TransitionInput = {
  current: TrackRef | null;
  // The next track that will play — queue[0], which may be an autoplay-seeded pick.
  next: TrackRef | null;
  positionSec: number;
  durationSec: number;
  // The ADAPTED crossfade length for this exact pair (from the blend engine), so the
  // countdown reflects the real melt length, not the raw slider value.
  crossfadeSec: number;
  // Can this pair run a REAL crossfade (both on the same overlap-capable adapter)? When
  // false there is a next track but the transition is an honest hard cut, not a fuse.
  canFuse: boolean;
  // True while a blend is actually under way (the melt is happening right now).
  meltActive: boolean;
  // What playback is REALLY doing (lib/player/playback-truth.ts). The countdown is honest
  // arithmetic on `positionSec` — but on a track that never starts, `positionSec` never
  // moves, so that true number promises a fuse that will never arrive. This is the gate:
  // a countdown and a blend description are only shown while sound is genuinely moving.
  motion: PlaybackMotion;
  // The user's configured crossfade ceiling — used only to phrase the honest melt hint.
  maxCrossfadeSec: number;
  // Real analysis for each track, or null/undefined when not locally analyzable. The
  // energy/BPM line renders ONLY when BOTH are present with finite numbers.
  currentAnalysis?: TrackAnalysis | null;
  nextAnalysis?: TrackAnalysis | null;
};

export type TransitionView =
  // Nothing is next (autoplay off + empty queue): playback will end honestly.
  | { kind: "ending" }
  // A next track exists but the pair cannot truly fuse (different/So non-overlap sources),
  // or the duration is not yet known — an honest "up next", no invented countdown.
  | { kind: "up-next"; next: TrackRef }
  // The pair COULD fuse, but playback is not moving — paused by the user, still starting,
  // or stuck. NOW/NEXT still stand (both are true), and one plain line says where the fuse
  // stands instead of a countdown the app cannot stand behind.
  | { kind: "fuse-held"; next: TrackRef; status: string }
  // A real fuse is coming: a live countdown to the melt, its adapted length, an honest
  // hint, and (only when genuinely computed) an energy/BPM line.
  | {
      kind: "fusing";
      next: TrackRef;
      // Whole seconds until the melt begins; 0 once we are inside the window.
      secondsUntilFuse: number;
      // True once the melt has begun (position entered the tail, or a blend is running).
      inWindow: boolean;
      crossfadeSec: number;
      // Honest, duration/title-based reason for the melt length (never BPM/energy unless
      // truly computed — that is the separate energyLine).
      hint: string;
      // "Energy: matched · N BPM flow"-style line, or null when not genuinely computed.
      energyLine: string | null;
    };

// Build the honest energy/BPM line, or null. Only ever non-null when BOTH tracks carry
// finite computed BPMs — anything less and we say nothing rather than invent a number.
function energyLineFrom(
  a: TrackAnalysis | null | undefined,
  b: TrackAnalysis | null | undefined,
): string | null {
  if (!a || !b) return null;
  if (!Number.isFinite(a.bpm) || !Number.isFinite(b.bpm) || a.bpm <= 0 || b.bpm <= 0) {
    return null;
  }
  const near = Math.abs(a.bpm - b.bpm) <= 4; // within a few BPM = a matched, smooth flow
  const bpm = Math.round(b.bpm);
  return near
    ? `Energy: matched · ${bpm} BPM flow`
    : `Energy: ${Math.round(a.bpm)} → ${bpm} BPM`;
}

// The plain line shown in place of a countdown when the fuse is real but playback is not
// moving. Each says what is true and what the listener can do — never an apology, never a
// number, and never a claim that the fuse is on its way when it is not.
function heldStatus(motion: PlaybackMotion): string {
  if (motion === "paused") return "Paused — press play and the fuse picks up from here.";
  if (motion === "stuck") return "This song isn't playing, so the fuse can't start. Skip to hear the next one.";
  return "Starting this song — the fuse begins once it plays.";
}

export function computeTransitionView(input: TransitionInput): TransitionView {
  const { current, next } = input;
  // No current track, or nothing queued and no autoplay pick: playback ends honestly.
  if (!current || !next) return { kind: "ending" };

  // A next track exists, but either the pair cannot truly overlap (a hard cut) or we do
  // not yet know the current track's length — so we cannot honestly count down to a fuse.
  if (!input.canFuse || !(input.durationSec > 0) || !(input.crossfadeSec > 0)) {
    return { kind: "up-next", next };
  }

  // THE GATE. A countdown only means something while the clock is moving. A melt already
  // running counts as moving (the blend engine drives it from the wall clock, not the
  // track position). Anything else — paused, still starting, stuck — gets the plain
  // holding line instead of a number the app cannot stand behind.
  if (!input.meltActive && input.motion !== "sounding") {
    return { kind: "fuse-held", next, status: heldStatus(input.motion) };
  }

  const fuseStart = Math.max(0, input.durationSec - input.crossfadeSec);
  const inWindow = input.meltActive || input.positionSec >= fuseStart;
  const secondsUntilFuse = inWindow ? 0 : Math.max(0, Math.ceil(fuseStart - input.positionSec));

  return {
    kind: "fusing",
    next,
    secondsUntilFuse,
    inWindow,
    crossfadeSec: input.crossfadeSec,
    hint: meltReason({ maxSec: input.maxCrossfadeSec, current, next }),
    energyLine: energyLineFrom(input.currentAnalysis, input.nextAnalysis),
  };
}
