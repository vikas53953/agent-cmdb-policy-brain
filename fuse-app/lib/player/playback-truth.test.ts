import { describe, expect, it } from "vitest";
import { describePlayback } from "@/lib/player/playback-truth";
import type { PlayerState } from "@/lib/player/types";
import type { TrackRef } from "@/lib/repos/track";

// THE BUG THIS FILE PINS. On a YouTube embed that refused to start, one screen said all of
// this at once: "this track won't play right now" + Skip, "Playback stalled — retrying",
// 0:00 of 3:22 — while the transport showed PAUSE and the hero block promised "Fusing in
// 198 seconds". Each surface had improvised its own answer from a different store field.
// describePlayback is the ONE answer they all read now, so they cannot disagree.

const song: TrackRef = {
  source: "youtube",
  nativeId: "abc",
  title: "Track abc",
  artist: "Someone",
  artUrl: null,
  durationSec: 202,
};

function state(patch: Partial<PlayerState> = {}): PlayerState {
  return {
    current: song,
    queue: [],
    // Derived by the store (PlayerState.canAdvance); a fixture must still satisfy the type.
    canAdvance: false,
    isPlaying: false,
    positionSec: 0,
    durationSec: 202,
    shuffle: false,
    repeat: "off",
    notice: null,
    status: "idle",
    recovery: { phase: "ok", skipOffered: false },
    intent: "idle",
    engineState: "unstarted",
    history: [],
    radioActive: false,
    sleepStopAfterTrack: false,
    volume: 1,
    muted: false,
    autoplayQueued: false,
    ...patch,
  };
}

// A track genuinely playing: the user asked for sound, the engine produces it.
const playing = state({
  isPlaying: true,
  status: "playing",
  intent: "play",
  engineState: "playing",
  positionSec: 12,
});

// The exact wedged-embed state from the bug: the store still says isPlaying, but the
// ladder has given up and the clock never moved.
const wedged = state({
  isPlaying: true,
  status: "error",
  intent: "play",
  engineState: "playing",
  positionSec: 0,
  recovery: { phase: "error", skipOffered: true },
});

describe("describePlayback — one answer to 'is sound genuinely coming out?'", () => {
  it("reads SOUNDING only when the user wants sound and the engine is producing it", () => {
    const truth = describePlayback(playing);
    expect(truth.motion).toBe("sounding");
    expect(truth.soundIsMoving).toBe(true);
    expect(truth.stuck).toBe(false);
    expect(truth.transportShowsPause).toBe(true);
    expect(truth.canPromiseFuse).toBe(true);
  });

  it("reads SILENT when no track is loaded", () => {
    const truth = describePlayback(state({ current: null }));
    expect(truth.motion).toBe("silent");
    expect(truth.transportShowsPause).toBe(false);
    expect(truth.canPromiseFuse).toBe(false);
  });

  it("never shows Pause on a wedged track, however loudly isPlaying insists", () => {
    const truth = describePlayback(wedged);
    expect(truth.motion).toBe("stuck");
    expect(truth.soundIsMoving).toBe(false);
    expect(truth.transportShowsPause).toBe(false);
    expect(truth.transportAction).toBe("play"); // the tap tries to play, never "pauses" silence
    expect(truth.canPromiseFuse).toBe(false);
    expect(truth.giveUp).toBe(true);
  });

  it("reads STUCK (not terminal) while the recovery ladder is still working the track", () => {
    const truth = describePlayback(
      state({
        isPlaying: true,
        status: "playing",
        intent: "play",
        engineState: "playing",
        recovery: { phase: "stalled", skipOffered: false },
      }),
    );
    expect(truth.motion).toBe("stuck");
    expect(truth.stuck).toBe(true);
    expect(truth.giveUp).toBe(false); // still trying — Skip is not the message yet
    expect(truth.canPromiseFuse).toBe(false);
  });

  it("STALLED IS NOT PAUSED: the same frozen clock reads differently by user intent", () => {
    const paused = describePlayback(
      state({ isPlaying: false, status: "idle", intent: "pause", engineState: "paused" }),
    );
    expect(paused.motion).toBe("paused");
    expect(paused.pausedByUser).toBe(true);
    expect(paused.stuck).toBe(false); // the user's own choice is never a fault
    expect(paused.transportShowsPause).toBe(false); // a paused track offers Play
    expect(paused.transportAction).toBe("play");

    const stalled = describePlayback(wedged);
    expect(stalled.pausedByUser).toBe(false);
    expect(stalled.stuck).toBe(true);
  });

  it("a track the user pauses AFTER a failure reads paused, not stuck (intent wins)", () => {
    const truth = describePlayback({ ...wedged, intent: "pause", isPlaying: false });
    expect(truth.motion).toBe("paused");
    expect(truth.stuck).toBe(false);
    expect(truth.giveUp).toBe(false);
  });

  it("reads STARTING while the adapter is loading — no Pause, no countdown yet", () => {
    const truth = describePlayback(
      state({ status: "loading", intent: "play", isPlaying: false }),
    );
    expect(truth.motion).toBe("starting");
    expect(truth.transportShowsPause).toBe(false);
    expect(truth.canPromiseFuse).toBe(false);
  });

  it("a rehydrated session waiting for a tap is quiet, not stuck", () => {
    const truth = describePlayback(state({ intent: "idle", positionSec: 45 }));
    expect(truth.motion).toBe("paused");
    expect(truth.stuck).toBe(false);
  });

  it("the transport icon and the transport action always agree", () => {
    for (const s of [playing, wedged, state(), state({ intent: "pause" })]) {
      const truth = describePlayback(s);
      expect(truth.transportAction).toBe(truth.transportShowsPause ? "pause" : "play");
    }
  });
});
