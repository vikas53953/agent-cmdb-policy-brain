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
//   3. advance — try the NEXT matching result / alternate video for the track.
//   4. terminal error — if nothing plays, surface an HONEST error with a working Skip.
// It NEVER loops forever: every episode marches down the ladder and terminates. A hard
// engine error (embed refused / unavailable) skips straight to `advance` — retrying a
// refused embed is futile, so we do not waste the time budget on it.
//
// This is the pure decision core, kept out of the React effect so the timing rules are
// unit-tested in node rather than buried in component timers. One app-wide monitor
// (use-playback-recovery.ts) samples the player each tick, feeds the observation here,
// and performs the returned `action` against the store; the returned phase/skipOffered
// drive the honest banner and the Skip control on every surface.

export type HealthPhase = "idle" | "playing" | "stalled" | "error";

// What the monitor should DO on this step. "none" while healthy or terminal.
export type RecoveryAction = "none" | "retry" | "recreate" | "advance";

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
  // 2s of no progress is a stall. Kept short so the whole ladder (retry → recreate →
  // advance → honest terminal) fits inside the ~30s budget even when several tracks in a
  // row refuse to play — the reality on bot-gated datacenter IPs.
  stallAfterMs: 2000,
  maxRetries: 2,
  maxRecreates: 1,
};

// The kind of engine error observed for the current track, if any:
//   • "none"  — no error; judge health purely by whether position advances.
//   • "soft"  — a possibly-transient error (bad request / HTML5 hiccup): try recreate.
//   • "fatal" — this video will never play here (embed blocked / unavailable): the
//               only useful move is to advance to an alternate, so skip retry+recreate.
export type EngineErrorKind = "none" | "soft" | "fatal";

export type HealthObservation = {
  isPlaying: boolean;
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

export function stepHealth(
  prev: HealthState,
  obs: HealthObservation,
  config: HealthConfig = DEFAULT_HEALTH_CONFIG,
): HealthOutcome {
  const errorKind: EngineErrorKind = obs.errorKind ?? "none";
  const hasError = errorKind !== "none";

  // Terminal already reached — hold the honest error, never act again (no infinite loop).
  // Real forward progress can still rescue it (a late-arriving alternate that plays).
  if (prev.skipOffered) {
    if (!hasError && obs.positionSec > prev.lastPositionSec + PROGRESS_EPSILON_SEC) {
      return {
        state: {
          phase: "playing",
          lastPositionSec: obs.positionSec,
          lastProgressAtMs: obs.nowMs,
          step: 0,
          skipOffered: false,
        },
        action: "none",
      };
    }
    return { state: { ...prev, phase: "error" }, action: "none" };
  }

  // Not playing and no error (paused / nothing loaded) is never a stall. Reset the
  // timer base so a long pause does not read as stalled the instant playback resumes.
  if (!obs.isPlaying && !hasError) {
    return {
      state: {
        phase: "idle",
        lastPositionSec: obs.positionSec,
        lastProgressAtMs: obs.nowMs,
        step: 0,
        skipOffered: false,
      },
      action: "none",
    };
  }

  // Real forward progress ⇒ healthy. Clear the whole recovery episode.
  if (!hasError && obs.positionSec > prev.lastPositionSec + PROGRESS_EPSILON_SEC) {
    return {
      state: {
        phase: "playing",
        lastPositionSec: obs.positionSec,
        lastProgressAtMs: obs.nowMs,
        step: 0,
        skipOffered: false,
      },
      action: "none",
    };
  }

  // Playing (or errored) but not advancing. Inside the grace window with no hard error,
  // stay healthy — a normal buffer blip should not trip the ladder.
  const stalledForMs = obs.nowMs - prev.lastProgressAtMs;
  if (!hasError && stalledForMs < config.stallAfterMs) {
    return {
      state: { ...prev, lastPositionSec: obs.positionSec },
      action: "none",
    };
  }

  // We are in a stall episode. Pick the next ladder rung from how many actions we have
  // already taken. A FATAL engine error jumps past retry+recreate (they cannot help a
  // refused/unavailable video) straight to advancing to an alternate.
  const R = config.maxRetries;
  const C = config.maxRecreates;
  const effectiveStep =
    errorKind === "fatal" ? Math.max(prev.step, R + C) : prev.step;

  let action: RecoveryAction;
  if (effectiveStep < R) action = "retry";
  else if (effectiveStep < R + C) action = "recreate";
  else if (effectiveStep < R + C + 1) action = "advance";
  else action = "none"; // ladder exhausted → terminal honest error

  if (action === "none") {
    return {
      state: {
        phase: "error",
        lastPositionSec: obs.positionSec,
        lastProgressAtMs: prev.lastProgressAtMs,
        step: prev.step,
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
      step: effectiveStep + 1,
      skipOffered: false,
    },
    action,
  };
}
