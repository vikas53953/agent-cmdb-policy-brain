// Playback recovery ladder (U8 + R2/R18/AE1) — pure and framework-free.
//
// THE CLASS BUG THIS KILLS: the old app (and the first rebuild) could sit forever in
// "Playback stalled — retrying" and never recover. A YouTube embed that refuses to
// play on a given network (datacenter IP bot-gating, an owner who blocked embedding,
// a plain-unavailable video) just froze: position stuck at 0 while the app kept
// claiming to play, or looped a retry that could never un-refuse the embed.
//
// The honest replacement is a BOUNDED RECOVERY LADDER. On a stall we do, in order:
//   1. retry  — nudge the same player (playVideo again). Fixes a transient buffer stall.
//   2. recreate — destroy + rebuild the player on the same track. Fixes a wedged iframe.
//   3. terminal error — if nothing plays, surface an HONEST error with a working Skip.
// It NEVER loops forever: every episode marches down the ladder and terminates. A hard
// engine error (embed refused / unavailable) skips straight to the terminal — retrying or
// rebuilding a refused embed is futile, so the honest move is an error + Skip.
//
// THE INTENT GATE (the R1/R3/R4 class fix). A stall is NOT "the polled clock stopped": a
// paused, minimised, idle, or ended track has a frozen clock too, and judging those as
// stalls is exactly what spammed "stall-retry" while the user had paused, and what
// auto-recovered a track the user never started. A real stall requires ALL of:
//   • intent === "play"  (the USER wants sound — set only by a user command, never by the
//     ladder), AND
//   • engineState is "playing" or "buffering"  (the ENGINE claims to be producing sound),
//     AND
//   • positionSec has not advanced for stallAfterMs.
// If intent is pause/idle, or the engine reports paused/unstarted/ended, it is DEFINITIVELY
// NOT a stall — return idle/ok and reset the timer. This is what removes the false-stall
// spam and the self-recovery that used to auto-advance a paused/never-started track.
//
// Advancing the queue is NO LONGER a recovery action: that was the R3 bug (a false stall
// auto-advanced to a different track and raced the user's Next). Auto-advance is a
// user/queue decision — the user's Next, or a REAL end-of-track engine "ended" event.
//
// This is the pure decision core, kept out of the React effect so the timing rules are
// unit-tested in node rather than buried in component timers. One app-wide monitor
// (use-playback-recovery.ts) samples the player each tick, feeds the observation here,
// and performs the returned `action` against the store; the returned phase/skipOffered
// drive the honest banner and the Skip control on every surface.

import type { EngineState, PlayerIntent } from "@/lib/player/types";

export type HealthPhase = "idle" | "playing" | "stalled" | "error";

// What the monitor should DO on this step. "none" while healthy or terminal. There is no
// "advance" — the monitor never auto-changes the track (that was the R3 bug).
export type RecoveryAction = "none" | "retry" | "recreate";

export type HealthState = {
  phase: HealthPhase;
  // The last position we saw real progress at, and when (ms clock). Together these are
  // the base of the stall timer: no progress for `stallAfterMs` ⇒ a stall.
  lastPositionSec: number;
  lastProgressAtMs: number;
  // How many recovery ACTIONS we have taken in the CURRENT stall episode (reset to 0
  // the moment real progress resumes). Drives which ladder rung comes next.
  step: number;
  // True once the ladder is exhausted and the honest error + Skip is the terminal
  // state. No further actions fire — this is what makes an infinite loop impossible.
  skipOffered: boolean;
};

export type HealthConfig = {
  // No forward progress for this long, while playing, counts as a stall.
  stallAfterMs: number;
  // How many "nudge the same player" retries before rebuilding it.
  maxRetries: number;
  // How many "destroy + rebuild the player" attempts before advancing to an alternate.
  maxRecreates: number;
};

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  // No progress for this long, WHILE the user wants sound and the engine claims to be
  // playing, counts as a stall. 4s tolerates a normal buffer blip without tripping; the
  // whole bounded ladder (retry → recreate → honest terminal) still fits the time budget.
  stallAfterMs: 4000,
  maxRetries: 2,
  maxRecreates: 1,
};

// The kind of engine error observed for the current track, if any:
//   • "none"  — no error; judge health purely by whether position advances.
//   • "soft"  — a possibly-transient error (bad request / HTML5 hiccup): try recreate.
//   • "fatal" — this video will never play here (embed blocked / unavailable): retry and
//               recreate cannot help, so go straight to the honest terminal (error + Skip).
export type EngineErrorKind = "none" | "soft" | "fatal";

export type HealthObservation = {
  // The USER's intent (see PlayerIntent). Only "play" can ever be a stall.
  intent: PlayerIntent;
  // The ENGINE's own lifecycle (see EngineState). Only "playing"/"buffering" can stall.
  engineState: EngineState;
  positionSec: number;
  nowMs: number;
  errorKind?: EngineErrorKind;
};

export type HealthOutcome = {
  state: HealthState;
  action: RecoveryAction;
};

export function initHealth(nowMs: number): HealthState {
  return {
    phase: "idle",
    lastPositionSec: 0,
    lastProgressAtMs: nowMs,
    step: 0,
    skipOffered: false,
  };
}

// The position must move forward by at least this much to count as real progress —
// guards against the tiny float jitter a player clock can report while stuck.
const PROGRESS_EPSILON_SEC = 0.25;

// The engine states in which a frozen clock could mean a real stall — the user wants
// sound and the engine claims to be producing (or about to produce) it.
function engineCouldStall(engineState: EngineState): boolean {
  return engineState === "playing" || engineState === "buffering";
}

// A definitively-healthy / not-a-stall reset used whenever intent or the engine says the
// frozen clock is expected (paused, idle, unstarted, ended, nothing wanted).
function reset(
  phase: HealthPhase,
  obs: HealthObservation,
): HealthOutcome {
  return {
    state: {
      phase,
      lastPositionSec: obs.positionSec,
      lastProgressAtMs: obs.nowMs,
      step: 0,
      skipOffered: false,
    },
    action: "none",
  };
}

export function stepHealth(
  prev: HealthState,
  obs: HealthObservation,
  config: HealthConfig = DEFAULT_HEALTH_CONFIG,
): HealthOutcome {
  const errorKind: EngineErrorKind = obs.errorKind ?? "none";
  const hasError = errorKind !== "none";
  const wantsSound = obs.intent === "play";
  const progressed = obs.positionSec > prev.lastPositionSec + PROGRESS_EPSILON_SEC;

  // THE INTENT GATE. If the user does not want sound right now, nothing is a stall — no
  // matter what the clock or engine says. This single guard removes the whole R1/R3/R4
  // class: a paused, minimised, idle, or never-started track is judged healthy-idle and
  // the recovery episode is cleared. A pending error is dropped with it (the store also
  // clears errorKind on pause/idle), so the ladder can never re-arm against it.
  if (!wantsSound) {
    return reset("idle", obs);
  }

  // The user wants sound. Real forward progress ⇒ healthy; clear the whole episode
  // (including the terminal, so a late-arriving alternate that plays rescues it).
  if (progressed) {
    return reset("playing", obs);
  }

  // Terminal already reached and still no progress — hold the honest error, never act
  // again (no infinite loop).
  if (prev.skipOffered) {
    return { state: { ...prev, phase: "error" }, action: "none" };
  }

  // A FATAL engine error (embed refused / unavailable): retry and recreate cannot help,
  // so surface the honest terminal (error + Skip) immediately.
  if (errorKind === "fatal") {
    return {
      state: {
        phase: "error",
        lastPositionSec: obs.positionSec,
        lastProgressAtMs: obs.nowMs,
        step: config.maxRetries + config.maxRecreates,
        skipOffered: true,
      },
      action: "none",
    };
  }

  // No hard error, wants sound, not progressing. It is only a POSSIBLE stall if the engine
  // itself claims to be playing/buffering. If the engine reports paused/unstarted/ended,
  // the frozen clock is expected — not a stall. Reset the timer so a resume is measured
  // fresh.
  if (!hasError && !engineCouldStall(obs.engineState)) {
    return reset("playing", obs);
  }

  // Playing/buffering (or a soft error) but not advancing. Inside the grace window, stay
  // healthy — a normal buffer blip should not trip the ladder. Keep prev UNCHANGED so the
  // stall timer is always measured from the last REAL progress (no mid-song creep).
  const stalledForMs = obs.nowMs - prev.lastProgressAtMs;
  if (!hasError && stalledForMs < config.stallAfterMs) {
    return { state: { ...prev }, action: "none" };
  }

  // We are in a stall episode. Pick the next ladder rung from how many actions we have
  // already taken: retry (maxRetries) → recreate (maxRecreates) → honest terminal.
  const R = config.maxRetries;
  const C = config.maxRecreates;
  const step = prev.step;

  let action: RecoveryAction;
  if (step < R) action = "retry";
  else if (step < R + C) action = "recreate";
  else action = "none"; // ladder exhausted → terminal honest error

  if (action === "none") {
    return {
      state: {
        phase: "error",
        lastPositionSec: obs.positionSec,
        lastProgressAtMs: prev.lastProgressAtMs,
        step,
        skipOffered: true,
      },
      action: "none",
    };
  }

  return {
    state: {
      // While actively working the ladder the surface reads "stalled" (honestly
      // recovering); only the exhausted terminal above reads "error".
      phase: "stalled",
      lastPositionSec: obs.positionSec,
      // Re-base the timer so the next rung is measured from this action.
      lastProgressAtMs: obs.nowMs,
      step: step + 1,
      skipOffered: false,
    },
    action,
  };
}
