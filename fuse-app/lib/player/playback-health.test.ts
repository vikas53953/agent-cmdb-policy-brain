import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEALTH_CONFIG,
  initHealth,
  stepHealth,
  type HealthConfig,
  type HealthState,
} from "@/lib/player/playback-health";

// A tight config so the stall/retry sequence is easy to drive deterministically:
// a stall after 3s of no progress, at most 2 automatic retries before Skip.
const CONFIG: HealthConfig = { stallAfterMs: 3000, maxRetries: 2 };

// Drive a sequence of observations through the machine, collecting every outcome.
function run(
  start: HealthState,
  obs: Array<{ isPlaying: boolean; positionSec: number; nowMs: number }>,
) {
  let state = start;
  const outcomes = obs.map((o) => {
    const outcome = stepHealth(state, o, CONFIG);
    state = outcome.state;
    return outcome;
  });
  return { state, outcomes };
}

describe("playback health — healthy progress", () => {
  it("stays 'playing' with no retry while position advances", () => {
    const { state, outcomes } = run(initHealth(0), [
      { isPlaying: true, positionSec: 1, nowMs: 1000 },
      { isPlaying: true, positionSec: 2, nowMs: 2000 },
      { isPlaying: true, positionSec: 3, nowMs: 3000 },
    ]);
    expect(state.phase).toBe("playing");
    expect(outcomes.every((o) => o.retry === false)).toBe(true);
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

describe("playback health — stall, retry, then Skip (AE1)", () => {
  it("shows 'stalled' and fires a retry once progress stops past the timeout", () => {
    // Advance once (establish progress at t=1s, pos=5), then stop advancing.
    const first = stepHealth(
      initHealth(0),
      { isPlaying: true, positionSec: 5, nowMs: 1000 },
      CONFIG,
    );
    expect(first.state.phase).toBe("playing");

    // Still at pos 5 after > 3s ⇒ stall + retry.
    const stalled = stepHealth(
      first.state,
      { isPlaying: true, positionSec: 5, nowMs: 4500 },
      CONFIG,
    );
    expect(stalled.state.phase).toBe("stalled");
    expect(stalled.retry).toBe(true);
    expect(stalled.state.retries).toBe(1);
    expect(stalled.state.skipOffered).toBe(false);
  });

  it("offers Skip only after the automatic retries are exhausted", () => {
    let state = stepHealth(
      initHealth(0),
      { isPlaying: true, positionSec: 5, nowMs: 1000 },
      CONFIG,
    ).state;

    const retries: boolean[] = [];
    // Keep it stuck at pos 5, sampling every 3.5s so each step crosses the timeout.
    let now = 1000;
    for (let i = 0; i < 4; i += 1) {
      now += 3500;
      const outcome = stepHealth(state, { isPlaying: true, positionSec: 5, nowMs: now }, CONFIG);
      retries.push(outcome.retry);
      state = outcome.state;
    }

    // Two retries fire (maxRetries), then it stops retrying and offers Skip.
    expect(retries).toEqual([true, true, false, false]);
    expect(state.phase).toBe("stalled");
    expect(state.skipOffered).toBe(true);
  });

  it("recovers to 'playing' and clears retries when progress resumes", () => {
    let state = stepHealth(
      initHealth(0),
      { isPlaying: true, positionSec: 5, nowMs: 1000 },
      CONFIG,
    ).state;
    // Stall + retry once.
    state = stepHealth(state, { isPlaying: true, positionSec: 5, nowMs: 4500 }, CONFIG).state;
    expect(state.retries).toBe(1);

    // Position moves again ⇒ healthy, retries reset, Skip not offered.
    const recovered = stepHealth(
      state,
      { isPlaying: true, positionSec: 6, nowMs: 5000 },
      CONFIG,
    );
    expect(recovered.state.phase).toBe("playing");
    expect(recovered.state.retries).toBe(0);
    expect(recovered.state.skipOffered).toBe(false);
    expect(recovered.retry).toBe(false);
  });
});

describe("default config is sane", () => {
  it("stalls after a few seconds and retries a small number of times", () => {
    expect(DEFAULT_HEALTH_CONFIG.stallAfterMs).toBeGreaterThan(0);
    expect(DEFAULT_HEALTH_CONFIG.maxRetries).toBeGreaterThan(0);
  });
});
