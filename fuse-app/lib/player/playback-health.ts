// Playback health state machine (U8, R2/R18, AE1) — pure and framework-free.
//
// The old app could freeze silently: a stuck YouTube player just sat there. The
// honest replacement is this — Now Playing must DETECT a stall (still "playing" but
// the position has stopped advancing), show "Playback stalled — retrying", fire a
// retry, and after repeated failure offer Skip. Never a silent freeze (AE1).
//
// This is the pure decision core, kept out of the React effect so the timing rules
// are unit-tested in node rather than buried in component timers. Now Playing samples
// the player on an interval and feeds each observation to `stepHealth`; the returned
// `retry` flag tells it to re-issue playback, and the returned phase/`skipOffered`
// drive the banner and the Skip control.

export type HealthPhase = "idle" | "playing" | "stalled";

export type HealthState = {
  phase: HealthPhase;
  // The last position we saw real progress at, and when (ms clock). Together these
  // are the base of the stall timer: no progress for `stallAfterMs` ⇒ a stall.
  lastPositionSec: number;
  lastProgressAtMs: number;
  // Retries fired for the CURRENT stall (reset to 0 the moment progress resumes).
  retries: number;
  // True once automatic retries are exhausted and the user should be offered Skip.
  skipOffered: boolean;
};

export type HealthConfig = {
  // No forward progress for this long, while playing, counts as a stall.
  stallAfterMs: number;
  // How many automatic retries to attempt before giving up and offering Skip.
  maxRetries: number;
};

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  stallAfterMs: 3000,
  maxRetries: 2,
};

export type HealthObservation = {
  isPlaying: boolean;
  positionSec: number;
  nowMs: number;
};

export type HealthOutcome = {
  state: HealthState;
  // The caller should re-issue playback (a stall-recovery nudge) on this step.
  retry: boolean;
};

export function initHealth(nowMs: number): HealthState {
  return {
    phase: "idle",
    lastPositionSec: 0,
    lastProgressAtMs: nowMs,
    retries: 0,
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
  // Not playing (paused / nothing loaded) is never a stall. Reset the timer base so
  // a long pause does not instantly read as stalled the moment playback resumes.
  if (!obs.isPlaying) {
    return {
      state: {
        phase: "idle",
        lastPositionSec: obs.positionSec,
        lastProgressAtMs: obs.nowMs,
        retries: 0,
        skipOffered: false,
      },
      retry: false,
    };
  }

  // Real forward progress ⇒ healthy. Clear any stall / retry bookkeeping.
  if (obs.positionSec > prev.lastPositionSec + PROGRESS_EPSILON_SEC) {
    return {
      state: {
        phase: "playing",
        lastPositionSec: obs.positionSec,
        lastProgressAtMs: obs.nowMs,
        retries: 0,
        skipOffered: false,
      },
      retry: false,
    };
  }

  // Playing but not advancing. Has it been stuck long enough to call it a stall?
  const stalledForMs = obs.nowMs - prev.lastProgressAtMs;
  if (stalledForMs < config.stallAfterMs) {
    // Still inside the grace window — keep the prior phase (healthy until proven not).
    return {
      state: { ...prev, lastPositionSec: obs.positionSec },
      retry: false,
    };
  }

  // Stalled. Fire another retry if we have any left; otherwise offer Skip.
  if (prev.retries < config.maxRetries) {
    return {
      state: {
        phase: "stalled",
        lastPositionSec: obs.positionSec,
        // Re-base the timer so the next stall window is measured from this retry.
        lastProgressAtMs: obs.nowMs,
        retries: prev.retries + 1,
        skipOffered: false,
      },
      retry: true,
    };
  }

  return {
    state: {
      phase: "stalled",
      lastPositionSec: obs.positionSec,
      lastProgressAtMs: prev.lastProgressAtMs,
      retries: prev.retries,
      skipOffered: true,
    },
    retry: false,
  };
}
