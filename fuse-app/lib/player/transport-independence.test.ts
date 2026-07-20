// THE DISCRIMINATOR: is the transport button's state affected by `engineState`?
//
// WHY THIS TEST EXISTS. Two bugs were investigated in parallel and one was proposed as
// the cause of the other. The crossfade bug (the YouTube adapter promoted a blended
// player without re-arming its event handlers, so `engineState` froze at "playing"
// after the first crossfade) is real. The open question was whether that frozen field
// also explains the mini-player play button needing a second tap after a skip.
//
// It does not, and this test is the proof: the transport renders and acts through
// describePlayback(), which reads current / intent / status / isPlaying / recovery —
// and never engineState. So a frozen engineState cannot desync the play button.
//
// Keeping this as a test rather than a comment means the independence is ENFORCED. If
// someone later wires engineState into the transport reading, this fails and says why.

import { describe, test, expect } from "vitest";
import { describePlayback } from "@/lib/player/playback-truth";
import type { PlayerState, EngineState } from "@/lib/player/types";

const TRACK = { source: "youtube", nativeId: "abc123", title: "A song" } as const;

function state(over: Partial<PlayerState> = {}): PlayerState {
  return {
    current: TRACK,
    queue: [],
    history: [],
    isPlaying: true,
    status: "playing",
    intent: "play",
    positionSec: 10,
    durationSec: 200,
    engineState: "playing",
    recovery: { phase: "ok", skipOffered: false },
    notice: null,
    volume: 1,
    muted: false,
    shuffle: false,
    repeat: "off",
    radioActive: false,
    autoplayQueued: false,
    sleepStopAfterTrack: false,
    ...over,
  } as unknown as PlayerState;
}

const EVERY_ENGINE_STATE: EngineState[] = [
  "unstarted",
  "buffering",
  "playing",
  "paused",
  "ended",
  "error",
];

describe("the transport reading ignores engineState", () => {
  test("a genuinely playing track reads the same under EVERY engineState", () => {
    for (const engineState of EVERY_ENGINE_STATE) {
      const truth = describePlayback(state({ engineState }));
      expect(truth.transportAction, `engineState=${engineState}`).toBe("pause");
      expect(truth.transportShowsPause, `engineState=${engineState}`).toBe(true);
    }
  });

  test("a paused track reads the same under EVERY engineState", () => {
    for (const engineState of EVERY_ENGINE_STATE) {
      const truth = describePlayback(
        state({ engineState, intent: "pause", isPlaying: false, status: "idle" }),
      );
      expect(truth.transportAction, `engineState=${engineState}`).toBe("play");
      expect(truth.transportShowsPause, `engineState=${engineState}`).toBe(false);
    }
  });

  // The frozen-engineState scenario exactly: after a crossfade the engine reported
  // nothing further, so engineState stuck at "playing". If the button read that field,
  // a track the user then paused would still show Pause and the first tap would be
  // spent "pausing" silence — the two-click symptom. It reads intent instead.
  test("a frozen engineState cannot make a paused track claim it is playing", () => {
    const afterCrossfadeThenPaused = state({
      engineState: "playing", // stale: the promoted player stopped reporting
      intent: "pause",
      isPlaying: false,
      status: "idle",
    });
    const truth = describePlayback(afterCrossfadeThenPaused);
    expect(truth.motion).toBe("paused");
    expect(truth.transportAction).toBe("play");
  });
});

describe("what a completed crossfade leaves behind", () => {
  // promoteBlended() sets isPlaying/intent/status to a playing track (store.ts). The
  // reading must therefore be "sounding" — the next track is NOT left paused, so F-4's
  // auto-resume failure does not originate in this state transition.
  test("the promoted track reads as genuinely sounding", () => {
    const promoted = state({
      isPlaying: true,
      status: "playing",
      intent: "play",
      positionSec: 0,
      engineState: "playing",
    });
    const truth = describePlayback(promoted);
    expect(truth.motion).toBe("sounding");
    expect(truth.soundIsMoving).toBe(true);
    expect(truth.transportAction).toBe("pause");
  });
});
