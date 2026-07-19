import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEALTH_CONFIG,
  initHealth,
  stepHealth,
  type EngineErrorKind,
  type HealthConfig,
  type HealthState,
  type RecoveryAction,
} from "@/lib/player/playback-health";
import type { EngineState, PlayerIntent } from "@/lib/player/types";

// A tight config so the ladder is easy to drive deterministically: a stall after 3s of no
// progress, then 2 nudge-retries, then 1 player-recreate, then the honest terminal.
const CONFIG: HealthConfig = { stallAfterMs: 3000, maxRetries: 2, maxRecreates: 1 };

type Obs = {
  intent: PlayerIntent;
  engineState: EngineState;
  positionSec: number;
  nowMs: number;
  errorKind?: EngineErrorKind;
};

// The common "the user wants sound and the engine claims to be playing" observation.
function playing(positionSec: number, nowMs: number, extra: Partial<Obs> = {}): Obs {
  return { intent: "play", engineState: "playing", positionSec, nowMs, ...extra };
}

function run(start: HealthState, obs: Obs[]) {
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
      playing(1, 1000),
      playing(2, 2000),
      playing(3, 3000),
    ]);
    expect(state.phase).toBe("playing");
    expect(outcomes.every((o) => o.action === "none")).toBe(true);
    expect(state.skipOffered).toBe(false);
  });

  it("a pause is never a stall (intent gate)", () => {
    const { state } = run(initHealth(0), [
      playing(5, 1000),
      // The user paused: intent 'pause', engine 'paused', clock frozen for 8s.
      { intent: "pause", engineState: "paused", positionSec: 5, nowMs: 9000 },
      { intent: "pause", engineState: "paused", positionSec: 5, nowMs: 20000 },
    ]);
    expect(state.phase).toBe("idle");
    expect(state.skipOffered).toBe(false);
  });

  it("an idle / never-started track is never a stall, even with a frozen clock", () => {
    // The R1 class: the app is open with a track focused but the user never pressed play.
    const { state, outcomes } = run(initHealth(0), [
      { intent: "idle", engineState: "unstarted", positionSec: 0, nowMs: 5000 },
      { intent: "idle", engineState: "unstarted", positionSec: 0, nowMs: 60000 },
    ]);
    expect(state.phase).toBe("idle");
    expect(outcomes.every((o) => o.action === "none")).toBe(true);
  });

  it("wants sound but the engine reports paused/ended is NOT a stall", () => {
    // Intent could briefly say 'play' while the engine is between states; a frozen clock
    // there must not trip the ladder because the engine is not actually playing.
    const outcome = stepHealth(
      initHealth(0),
      { intent: "play", engineState: "ended", positionSec: 200, nowMs: 10000 },
      CONFIG,
    );
    expect(outcome.action).toBe("none");
    expect(outcome.state.phase).toBe("playing");
  });
});

describe("playback recovery — the bounded ladder (AE1)", () => {
  // Establish real progress, then keep the clock frozen while the engine still claims to
  // be playing and the user still wants sound. The ladder must walk retry→retry→recreate→
  // terminal and then STOP acting (never an infinite loop, never an auto-advance).
  function stuckLadder() {
    let state = stepHealth(initHealth(0), playing(5, 1000), CONFIG).state;
    const actions: RecoveryAction[] = [];
    let now = 1000;
    for (let i = 0; i < 6; i += 1) {
      now += 3500; // each sample crosses the 3s stall window
      const outcome = stepHealth(state, playing(5, now), CONFIG);
      actions.push(outcome.action);
      state = outcome.state;
    }
    return { state, actions };
  }

  it("walks retry → retry → recreate → terminal, then stops (no advance rung)", () => {
    const { state, actions } = stuckLadder();
    expect(actions).toEqual(["retry", "retry", "recreate", "none", "none", "none"]);
    expect(state.phase).toBe("error");
    expect(state.skipOffered).toBe(true);
  });

  it("marks 'stalled' while actively recovering, 'error' only at the terminal", () => {
    let state = stepHealth(initHealth(0), playing(5, 1000), CONFIG).state;
    // First stall crossing ⇒ a retry, surfaced as "stalled".
    state = stepHealth(state, playing(5, 4500), CONFIG).state;
    expect(state.phase).toBe("stalled");
    expect(state.skipOffered).toBe(false);
  });

  it("recovers to 'playing' and clears the episode when progress resumes", () => {
    let state = stepHealth(initHealth(0), playing(5, 1000), CONFIG).state;
    state = stepHealth(state, playing(5, 4500), CONFIG).state;
    expect(state.step).toBe(1);

    const recovered = stepHealth(state, playing(6, 5000), CONFIG);
    expect(recovered.state.phase).toBe("playing");
    expect(recovered.state.step).toBe(0);
    expect(recovered.state.skipOffered).toBe(false);
    expect(recovered.action).toBe("none");
  });

  it("the grace window is measured from the last REAL progress (no mid-song creep)", () => {
    // Sub-epsilon jitter within the grace window must not advance the stall baseline, so a
    // genuinely frozen clock still trips exactly one stallAfterMs later.
    let state = stepHealth(initHealth(0), playing(5, 1000), CONFIG).state;
    state = stepHealth(state, playing(5.1, 2000), CONFIG).state; // jitter < epsilon, in grace
    expect(state.lastProgressAtMs).toBe(1000); // baseline unchanged
    const tripped = stepHealth(state, playing(5.1, 4200), CONFIG); // 3.2s since real progress
    expect(tripped.action).toBe("retry");
  });
});

describe("playback recovery — hard engine errors", () => {
  it("a FATAL error (embed refused / unavailable) goes straight to the honest terminal", () => {
    // Retry and recreate can never un-refuse an embed, and there is no advance rung, so the
    // only honest move is an error + Skip immediately.
    const outcome = stepHealth(
      initHealth(0),
      playing(0, 500, { errorKind: "fatal" }),
      CONFIG,
    );
    expect(outcome.action).toBe("none");
    expect(outcome.state.phase).toBe("error");
    expect(outcome.state.skipOffered).toBe(true);
  });

  it("a SOFT error still tries retry then recreate before the terminal", () => {
    const first = stepHealth(initHealth(0), playing(0, 200, { errorKind: "soft" }), CONFIG);
    expect(first.action).toBe("retry");
    const second = stepHealth(first.state, playing(0, 400, { errorKind: "soft" }), CONFIG);
    expect(second.action).toBe("retry");
    const third = stepHealth(second.state, playing(0, 600, { errorKind: "soft" }), CONFIG);
    expect(third.action).toBe("recreate");
    const terminal = stepHealth(third.state, playing(0, 800, { errorKind: "soft" }), CONFIG);
    expect(terminal.action).toBe("none");
    expect(terminal.state.skipOffered).toBe(true);
  });

  it("a fatal error while the user has paused is still not acted on (intent gate wins)", () => {
    const outcome = stepHealth(
      initHealth(0),
      { intent: "pause", engineState: "paused", positionSec: 0, nowMs: 500, errorKind: "fatal" },
      CONFIG,
    );
    expect(outcome.action).toBe("none");
    expect(outcome.state.phase).toBe("idle");
  });
});

describe("default config is sane", () => {
  it("stalls after a few seconds and takes a small, bounded number of steps", () => {
    expect(DEFAULT_HEALTH_CONFIG.stallAfterMs).toBeGreaterThan(0);
    expect(DEFAULT_HEALTH_CONFIG.maxRetries).toBeGreaterThan(0);
    expect(DEFAULT_HEALTH_CONFIG.maxRecreates).toBeGreaterThan(0);
  });
});
