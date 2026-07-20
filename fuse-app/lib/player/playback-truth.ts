// THE ONE ANSWER TO "IS SOUND GENUINELY COMING OUT RIGHT NOW?" (the honesty class fix).
//
// THE CLASS BUG THIS KILLS. Every surface used to improvise its own answer from a
// different field: the transport read `isPlaying`, the Transition Moment read
// `positionSec` + `durationSec`, the stall banner read `recovery.phase`, the
// data-player-state attribute read `status`. On a YouTube embed that refused to start,
// those four readings disagreed at the SAME moment on the SAME screen — the banner said
// "this track won't play", the button showed Pause, and the hero block promised a fuse in
// 198 seconds computed off a clock that had never moved. Each number was individually
// defensible; together they lied.
//
// The fix is not four guards. It is ONE derived reading of the store's existing truth,
// which every surface renders from, so no two surfaces can ever disagree again.
//
// PAUSED IS NOT STUCK. The store carries the user's `intent` deliberately (see
// PlayerIntent) — "play" / "pause" / "idle" — written only by user commands, never
// manufactured by the recovery ladder. A frozen clock means completely different things
// under those intents: under "pause" the silence is the user's own choice and everything
// on screen should stay calm and sensible; under "play" a frozen clock while the app
// claims to be playing IS the lie. So intent is consulted BEFORE any health field, exactly
// as playback-health.ts's intent gate does — one rule, two readers.
//
// Pure and framework-free (types only) so every branch is unit-tested in node. The React
// binding is use-playback-truth.ts.

import type { PlayerState } from "@/lib/player/types";

// What playback is REALLY doing right now, in the app's own plain vocabulary:
//   • "silent"   — no track is loaded; there is nothing to be true or false about.
//   • "paused"   — the user chose silence. Expected, honest, not a fault.
//   • "starting" — the user asked for sound and the app is working toward it; no sound yet.
//   • "sounding" — sound is genuinely coming out and the clock is moving. ONLY this state
//                  entitles a surface to show Pause, or to count down to anything.
//   • "stuck"    — the user wants sound and the app cannot produce it: the recovery ladder
//                  is working the track, or it has given up. Nothing may claim progress.
export type PlaybackMotion = "silent" | "paused" | "starting" | "sounding" | "stuck";

export type PlaybackTruth = {
  motion: PlaybackMotion;
  // The single question this module exists to answer: is sound genuinely coming out AND
  // moving forward? Everything else on this object is a plain-words consequence of it.
  soundIsMoving: boolean;
  // Silent because the USER chose it — never a fault, never a stall.
  pausedByUser: boolean;
  // The app wants to play this track and cannot. True while the ladder is retrying AND
  // after it gives up, because in both cases nothing is progressing.
  stuck: boolean;
  // The ladder is exhausted: this track will not play at all. Skip is the way forward.
  giveUp: boolean;
  // The transport shows Pause ONLY when sound is genuinely moving — a Pause icon is a
  // claim that there is something to pause.
  transportShowsPause: boolean;
  // What tapping the transport must actually do, derived from the same reading, so the
  // icon and the action can never disagree.
  transportAction: "play" | "pause";
  // May a surface show a live countdown, a blend description, or any other promise that
  // depends on the clock moving? Only while it truly is.
  canPromiseFuse: boolean;
};

export function describePlayback(state: PlayerState): PlaybackTruth {
  const motion = motionOf(state);
  const soundIsMoving = motion === "sounding";
  return {
    motion,
    soundIsMoving,
    pausedByUser: motion === "paused",
    stuck: motion === "stuck",
    // Terminal only when the ladder truly gave up (or the store could not start at all) —
    // and only while the user still wants sound, so a paused track never reads as failed.
    giveUp:
      motion === "stuck" &&
      (state.recovery.phase === "error" || state.status === "error"),
    transportShowsPause: soundIsMoving,
    transportAction: soundIsMoving ? "pause" : "play",
    canPromiseFuse: soundIsMoving,
  };
}

function motionOf(state: PlayerState): PlaybackMotion {
  // Nothing loaded: nothing to claim.
  if (!state.current) return "silent";

  // THE INTENT GATE (mirrors playback-health.ts). The user chose silence, so a frozen
  // clock is exactly what should happen. This is checked FIRST so a track the user paused
  // can never be read as stuck — including one paused after a failure.
  if (state.intent === "pause") return "paused";

  // The app cannot produce sound for this track: the ladder gave up, or the store hit an
  // honest error (nothing playable resolved, the engine threw).
  if (state.status === "error" || state.recovery.phase === "error") return "stuck";

  // The ladder is actively working a frozen clock. Not yet terminal, but nothing is
  // progressing, so nothing may claim it is.
  if (state.recovery.phase === "stalled") return "stuck";

  // No sound was ever asked for (fresh load, a rehydrated session waiting for a tap, or a
  // source with no engine wired). Honest quiet, not a fault.
  if (state.intent === "idle") return "paused";

  // The user asked for sound and no fault is known — but the adapter has not started yet.
  if (state.status === "loading" || !state.isPlaying) return "starting";

  return "sounding";
}
