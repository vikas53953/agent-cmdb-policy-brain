import { describe, expect, it, vi } from "vitest";
import {
  MEDIA_SEEK_STEP_SEC,
  buildMediaMetadata,
  buildMediaSessionBindings,
  buildPositionState,
  hasMediaSession,
  mediaPlaybackState,
  type MediaSessionActionName,
  type MediaSessionTarget,
} from "@/lib/player/media-session";
import type { TrackRef } from "@/lib/repos/track";

const track: TrackRef = {
  source: "youtube",
  nativeId: "abc123",
  title: "Midnight City",
  artist: "M83",
  artUrl: "https://img.example/cover.jpg",
  durationSec: 240,
};

describe("buildMediaMetadata — what the lock screen shows", () => {
  it("carries title, artist and artwork from the current track", () => {
    const metadata = buildMediaMetadata(track);
    expect(metadata?.title).toBe("Midnight City");
    expect(metadata?.artist).toBe("M83");
    expect(metadata?.artwork.length).toBeGreaterThan(0);
    expect(metadata?.artwork.every((a) => a.src === track.artUrl)).toBe(true);
  });

  it("offers several declared sizes so platforms that pick by size find one", () => {
    const sizes = buildMediaMetadata(track)?.artwork.map((a) => a.sizes) ?? [];
    expect(new Set(sizes).size).toBe(sizes.length);
    expect(sizes).toContain("512x512");
  });

  it("renders a missing artist as an absent line, never the string 'null'", () => {
    const metadata = buildMediaMetadata({ ...track, artist: null });
    expect(metadata?.artist).toBe("");
  });

  it("publishes no artwork rather than a broken image when the track has no cover", () => {
    expect(buildMediaMetadata({ ...track, artUrl: null })?.artwork).toEqual([]);
  });

  it("is null when nothing is loaded, so the OS panel is not left showing a stale track", () => {
    expect(buildMediaMetadata(null)).toBeNull();
  });
});

describe("mediaPlaybackState — the OS play/pause button", () => {
  it("mirrors playing and paused for a loaded track", () => {
    expect(mediaPlaybackState({ current: track, isPlaying: true })).toBe("playing");
    expect(mediaPlaybackState({ current: track, isPlaying: false })).toBe("paused");
  });

  it("reports none when nothing is loaded, so no dead control is offered", () => {
    expect(mediaPlaybackState({ current: null, isPlaying: false })).toBe("none");
  });
});

describe("buildPositionState — the lock screen scrub bar", () => {
  it("reports position and duration for a real track", () => {
    expect(buildPositionState({ positionSec: 30, durationSec: 240 })).toEqual({
      duration: 240,
      position: 30,
      playbackRate: 1,
    });
  });

  it("clamps a position that briefly overshoots the duration", () => {
    expect(buildPositionState({ positionSec: 999, durationSec: 240 })?.position).toBe(240);
  });

  it("publishes nothing when there is no honest duration to report", () => {
    expect(buildPositionState({ positionSec: 5, durationSec: 0 })).toBeNull();
    expect(buildPositionState({ positionSec: 5, durationSec: Number.NaN })).toBeNull();
  });
});

function fakeTarget(positionSec = 100) {
  const calls = {
    resume: vi.fn(),
    pause: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    seek: vi.fn(),
  };
  const target: MediaSessionTarget = {
    ...calls,
    getState: () => ({ positionSec }),
  };
  return { target, calls };
}

function handlerFor(target: MediaSessionTarget, action: MediaSessionActionName) {
  const binding = buildMediaSessionBindings(target).find((b) => b.action === action);
  if (!binding) throw new Error(`no binding registered for ${action}`);
  return binding.handler;
}

describe("buildMediaSessionBindings — hardware buttons reach the real transport", () => {
  it("registers the full set of actions a music app is expected to answer", () => {
    const { target } = fakeTarget();
    const actions = buildMediaSessionBindings(target).map((b) => b.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "play",
        "pause",
        "nexttrack",
        "previoustrack",
        "seekbackward",
        "seekforward",
        "seekto",
      ]),
    );
  });

  it("wires play and pause to the store rather than a second transport", () => {
    const { target, calls } = fakeTarget();
    handlerFor(target, "play")();
    handlerFor(target, "pause")();
    expect(calls.resume).toHaveBeenCalledTimes(1);
    expect(calls.pause).toHaveBeenCalledTimes(1);
  });

  it("treats a headset skip as a manual Next, so the sleep timer survives it", () => {
    const { target, calls } = fakeTarget();
    handlerFor(target, "nexttrack")();
    expect(calls.next).toHaveBeenCalledWith("user");
  });

  it("wires previoustrack to the store's true-previous behaviour", () => {
    const { target, calls } = fakeTarget();
    handlerFor(target, "previoustrack")();
    expect(calls.previous).toHaveBeenCalledTimes(1);
  });

  it("seeks by the platform's offset, falling back to the app's named step", () => {
    const { target, calls } = fakeTarget(100);
    handlerFor(target, "seekforward")({ seekOffset: 30 });
    expect(calls.seek).toHaveBeenCalledWith(130);
    handlerFor(target, "seekforward")();
    expect(calls.seek).toHaveBeenLastCalledWith(100 + MEDIA_SEEK_STEP_SEC);
    handlerFor(target, "seekbackward")();
    expect(calls.seek).toHaveBeenLastCalledWith(100 - MEDIA_SEEK_STEP_SEC);
  });

  it("never seeks before the start of the track", () => {
    const { target, calls } = fakeTarget(3);
    handlerFor(target, "seekbackward")({ seekOffset: 10 });
    expect(calls.seek).toHaveBeenCalledWith(0);
  });

  it("jumps to an absolute position for seekto", () => {
    const { target, calls } = fakeTarget();
    handlerFor(target, "seekto")({ seekTime: 42 });
    expect(calls.seek).toHaveBeenCalledWith(42);
  });

  it("ignores a seekto with no time instead of jumping to 0:00", () => {
    const { target, calls } = fakeTarget();
    handlerFor(target, "seekto")({});
    expect(calls.seek).not.toHaveBeenCalled();
  });
});

describe("hasMediaSession — feature detection", () => {
  it("is false in node (no navigator), so the bridge is a no-op under SSR", () => {
    // The whole point: this must answer honestly rather than throwing where the API is
    // absent — which is exactly the server render and older browsers.
    expect(() => hasMediaSession()).not.toThrow();
    expect(hasMediaSession()).toBe(false);
  });
});
