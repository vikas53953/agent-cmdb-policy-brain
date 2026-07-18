import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEALTH_CONFIG,
  initHealth,
  stepHealth,
  type HealthConfig,
  type HealthState,
  type RecoveryAction,
} from "@/lib/player/playback-health";

// A tight config so the ladder is easy to drive deterministically: a stall after 3s
// of no progress, then 2 nudge-retries, then 1 player-recreate, then advance.
const CONFIG: HealthConfig = { stallAfterMs: 3000, maxRetries: 2, maxRecreates: 1 };

// Drive a sequence of observations through the machine, collecting every outcome.
function run(
  start: HealthState,
  obs: Array<{
    isPlaying: boolean;
    positionSec: number;
    nowMs: number;
    errorKind?: "none" | "soft" | "fatal";
  }>,
) {
  let state = start;
  const outcomes = obs.map((o) => {
    const outcome = stepHealth(state, o, CONFIG);
    state = outcome.state;
    return outcome;
  });
  return { state, outcomes };
}

describe("playback recovery — healthy progress", () => {
  it("stays 'playing' with no action while position advances", () => {
    const { state, outcomes } = run(initHealth(0), [
      { isPlaying: true, positionSec: 1, nowMs: 1000 },
      { isPlaying: true, positionSec: 2, nowMs: 2000 },
      { isPlaying: true, positionSec: 3, nowMs: 3000 },
    ]);
    expect(state.phase).toBe("playing");
    expect(outcomes.every((o) => o.action === "none")).toBe(true);
    expect(state.skipOffered).toBe(false);
  });

  it("a pause is never a stall", () => {
    const { state } = run(initHealth(0), [
      { isPlaying: true, positionSec: 5, nowMs: 1000 },
      { isPlaying: false, positionSec: 5, nowMs: 9000 }, // paused for 8s
      { isPlaying: false, positionSec: 5, nowMs: 20000 },
    ]);
    expect(state.phase).toBe("idle");
    expect(state.skipOffered).toBe(false);
  });
});

describe("playback recovery — the bounded ladder (AE1)", () => {
  // Establish real progress, then keep the clock frozen and sample past each timeout so
  // every step crosses the stall window. The ladder must walk retry→retry→recreate→
  // advance→terminal and then STOP acting (never an infinite loop).
  function stuckLadder() {
    let state = stepHealth(
      initHealth(0),
      { isPlaying: true, positionSec: 5, nowMs: 1000 },
      CONFIG,
    ).state;
    const actions: RecoveryAction[] = [];
    let now = 1000;
    for (let i = 0; i < 6; i += 1) {
      now += 3500; // each sample crosses the 3s stall window
      const outcome = stepHealth(state, { isPlaying: true, positionSec: 5, nowMs: now }, CONFIG);
      actions.push(outcome.action);
      state = outcome.state;
    }
    return { state, actions };
  }

  it("walks retry → retry → recreate → advance → terminal, then stops", () => {
    const { state, actions } = stuckLadder();
    expect(actions).toEqual(["retry", "retry", "recreate", "advance", "none", "none"]);
    expect(state.phase).toBe("error");
    expect(state.skipOffered).toBe(true);
  });

  it("marks 'stalled' while actively recovering, 'error' only at the terminal", () => {
    let state = stepHealth(
      initHealth(0),
      { isPlaying: true, positionSec: 5, nowMs: 1000 },
      CONFIG,
    ).state;
    // First stall crossing ⇒ a retry, surfaced as "stalled".
    state = stepHealth(state, { isPlaying: true, positionSec: 5, nowMs: 4500 }, CONFIG).state;
    expect(state.phase).toBe("stalled");
    expect(state.skipOffered).toBe(false);
  });

  it("recovers to 'playing' and clears the episode when progress resumes", () => {
    let state = stepHealth(
      initHealth(0),
      { isPlaying: true, positionSec: 5, nowMs: 1000 },
      CONFIG,
    ).state;
    state = stepHealth(state, { isPlaying: true, positionSec: 5, nowMs: 4500 }, CONFIG).state;
    expect(state.step).toBe(1);

    const recovered = stepHealth(
      state,
      { isPlaying: true, positionSec: 6, nowMs: 5000 },
      CONFIG,
    );
    expect(recovered.state.phase).toBe("playing");
    expect(recovered.state.step).toBe(0);
    expect(recovered.state.skipOffered).toBe(false);
    expect(recovered.action).toBe("none");
  });
});

describe("playback recovery — hard engine errors", () => {
  it("a FATAL error (embed refused / unavailable) advances immediately, skipping retry", () => {
    // No grace, no retries wasted: a refused embed can never be un-refused by nudging.
    const outcome = stepHealth(
      initHealth(0),
      { isPlaying: true, positionSec: 0, nowMs: 500, errorKind: "fatal" },
      CONFIG,
    );
    expect(outcome.action).toBe("advance");
    expect(outcome.state.phase).toBe("stalled");
  });

  it("a FATAL error with nothing left to advance to reaches the honest terminal", () => {
    const state = stepHealth(
      initHealth(0),
      { isPlaying: true, positionSec: 0, nowMs: 500, errorKind: "fatal" },
      CONFIG,
    ).state;
    expect(state.step).toBe(4); // R(2) + C(1) + advance(1)
    // Advance failed (no alternate); the next errored sample lands on the terminal.
    const terminal = stepHealth(
      state,
      { isPlaying: true, positionSec: 0, nowMs: 1500, errorKind: "fatal" },
      CONFIG,
    );
    expect(terminal.action).toBe("none");
    expect(terminal.state.phase).toBe("error");
    expect(terminal.state.skipOffered).toBe(true);
  });

  it("a SOFT error still tries recreate before advancing", () => {
    // Soft error crosses straight into the ladder (no grace) but respects the rungs.
    const first = stepHealth(
      initHealth(0),
      { isPlaying: true, positionSec: 0, nowMs: 200, errorKind: "soft" },
      CONFIG,
    );
    expect(first.action).toBe("retry");
    const second = stepHealth(
      first.state,
      { isPlaying: true, positionSec: 0, nowMs: 400, errorKind: "soft" },
      CONFIG,
    );
    expect(second.action).toBe("retry");
    const third = stepHealth(
      second.state,
      { isPlaying: true, positionSec: 0, nowMs: 600, errorKind: "soft" },
      CONFIG,
    );
    expect(third.action).toBe("recreate");
  });
});

describe("default config is sane", () => {
  it("stalls after a few seconds and takes a small, bounded number of steps", () => {
    expect(DEFAULT_HEALTH_CONFIG.stallAfterMs).toBeGreaterThan(0);
    expect(DEFAULT_HEALTH_CONFIG.maxRetries).toBeGreaterThan(0);
    expect(DEFAULT_HEALTH_CONFIG.maxRecreates).toBeGreaterThan(0);
  });
});
