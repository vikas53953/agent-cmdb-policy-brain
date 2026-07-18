import { describe, expect, it } from "vitest";
import { PlayerStore } from "@/lib/player/store";
import { createAdapterRegistry } from "@/lib/player/adapters";
import { SOURCE_CAPABILITIES } from "@/lib/player/capabilities";
import type { SourceAdapter } from "@/lib/player/types";
import type { TrackRef, TrackSource } from "@/lib/repos/track";

// A minimal fake adapter that records the generic calls the store makes. It exposes
// the SAME contract for every source, which is the whole point: the store drives it
// without knowing which source it is (KTD-6 — no source-specific branch in the store).
function makeFakeAdapter(source: TrackSource) {
  const calls: string[] = [];
  const adapter: SourceAdapter = {
    source,
    capabilities: SOURCE_CAPABILITIES[source],
    load: async () => {
      calls.push("load");
    },
    play: async () => {
      calls.push("play");
    },
    pause: () => {
      calls.push("pause");
    },
    seek: () => {
      calls.push("seek");
    },
    setVolume: () => {
      calls.push("setVolume");
    },
    setRate: () => {
      calls.push("setRate");
    },
    unload: () => {
      calls.push("unload");
    },
  };
  return { adapter, calls };
}

const track = (source: TrackSource, nativeId: string): TrackRef => ({
  source,
  nativeId,
  title: `Track ${nativeId}`,
  artist: "Someone",
  artUrl: null,
  durationSec: 200,
});

describe("PlayerStore is the single source of playback truth", () => {
  it("play then pause reflects isPlaying without any source-specific branch", async () => {
    const registry = createAdapterRegistry();
    const { adapter, calls } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    const started = await store.play(track("youtube", "abc"));
    expect(started).toBe(true);
    expect(store.getState().isPlaying).toBe(true);
    expect(store.getState().current?.nativeId).toBe("abc");
    expect(calls).toEqual(["load", "play"]);

    store.pause();
    expect(store.getState().isPlaying).toBe(false);
    expect(calls).toEqual(["load", "play", "pause"]);
  });

  it("drives the identical contract for a different source (no YouTube-only wiring)", async () => {
    const registry = createAdapterRegistry();
    const { adapter, calls } = makeFakeAdapter("local");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("local", "file-1"));
    expect(store.getState().isPlaying).toBe(true);
    expect(calls).toEqual(["load", "play"]);
  });

  it("honestly stays not-playing when no adapter is registered for the source (R17)", async () => {
    const registry = createAdapterRegistry(); // empty — no engines wired (U5 reality)
    const store = new PlayerStore({ registry });

    const started = await store.play(track("spotify", "sp-1"));
    expect(started).toBe(false);
    // The track is focused, but the store does not claim to be playing it.
    expect(store.getState().current?.nativeId).toBe("sp-1");
    expect(store.getState().isPlaying).toBe(false);
  });
});

describe("queue navigation", () => {
  it("advances to the next queued track and shrinks the queue", async () => {
    const registry = createAdapterRegistry();
    registry.register(makeFakeAdapter("youtube").adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "a"));
    store.setQueue([track("youtube", "b"), track("youtube", "c")]);

    const advanced = await store.next();
    expect(advanced).toBe(true);
    expect(store.getState().current?.nativeId).toBe("b");
    expect(store.getState().queue.map((t) => t.nativeId)).toEqual(["c"]);
  });

  it("returns false at the end of the queue with repeat off", async () => {
    const registry = createAdapterRegistry();
    registry.register(makeFakeAdapter("youtube").adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "a"));
    const advanced = await store.next();
    expect(advanced).toBe(false);
    expect(store.getState().current?.nativeId).toBe("a");
  });

  it("repeat one replays the current track", async () => {
    const registry = createAdapterRegistry();
    registry.register(makeFakeAdapter("youtube").adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "a"));
    store.setQueue([track("youtube", "b")]);
    store.cycleRepeat(); // off -> all
    store.cycleRepeat(); // all -> one
    expect(store.getState().repeat).toBe("one");

    await store.next();
    expect(store.getState().current?.nativeId).toBe("a");
    // Queue untouched because we repeated the current track.
    expect(store.getState().queue.map((t) => t.nativeId)).toEqual(["b"]);
  });

  it("repeat all recycles the finished track to the tail", async () => {
    const registry = createAdapterRegistry();
    registry.register(makeFakeAdapter("youtube").adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "a"));
    store.setQueue([track("youtube", "b")]);
    store.cycleRepeat(); // off -> all

    await store.next();
    expect(store.getState().current?.nativeId).toBe("b");
    expect(store.getState().queue.map((t) => t.nativeId)).toEqual(["a"]);
  });
});

describe("shuffle picks a real track from the queue (U8, R17 — no dead control)", () => {
  it("advances to some track that was in the queue and shrinks it by one", async () => {
    const registry = createAdapterRegistry();
    registry.register(makeFakeAdapter("youtube").adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "a"));
    store.setQueue([track("youtube", "b"), track("youtube", "c"), track("youtube", "d")]);
    store.toggleShuffle();
    expect(store.getState().shuffle).toBe(true);

    const advanced = await store.next();
    expect(advanced).toBe(true);
    // Whatever was picked, it came from the queue and the queue is now smaller by one.
    expect(["b", "c", "d"]).toContain(store.getState().current?.nativeId);
    expect(store.getState().queue).toHaveLength(2);
    expect(store.getState().queue.map((t) => t.nativeId)).not.toContain(
      store.getState().current?.nativeId,
    );
  });
});

describe("retry re-issues playback without resetting position (U8, AE1)", () => {
  it("nudges the active adapter's play() again and keeps position", async () => {
    const registry = createAdapterRegistry();
    const { adapter, calls } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "a"));
    store.reportPosition(42, 200);
    calls.length = 0; // ignore the load/play from the initial play()

    await store.retry();
    expect(calls).toEqual(["play"]); // no load, no unload — same player, same position
    expect(store.getState().positionSec).toBe(42);
  });

  it("is an honest no-op when nothing is playing", async () => {
    const store = new PlayerStore({ registry: createAdapterRegistry() });
    await expect(store.retry()).resolves.toBeUndefined();
    expect(store.getState().isPlaying).toBe(false);
  });
});

describe("subscriptions and reported position", () => {
  it("notifies subscribers on state change and stops after unsubscribe", async () => {
    const registry = createAdapterRegistry();
    registry.register(makeFakeAdapter("youtube").adapter);
    const store = new PlayerStore({ registry });

    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    await store.play(track("youtube", "a"));
    expect(notifications).toBeGreaterThan(0);

    const afterFirst = notifications;
    unsubscribe();
    store.pause();
    expect(notifications).toBe(afterFirst);
  });

  it("mirrors adapter-reported position and duration into state", () => {
    const store = new PlayerStore({ registry: createAdapterRegistry() });
    store.reportPosition(42, 200);
    expect(store.getState().positionSec).toBe(42);
    expect(store.getState().durationSec).toBe(200);
  });

  it("clamps seek within the known duration", () => {
    const registry = createAdapterRegistry();
    registry.register(makeFakeAdapter("youtube").adapter);
    const store = new PlayerStore({ registry, initial: { durationSec: 100 } });
    store.seek(500);
    expect(store.getState().positionSec).toBe(100);
    store.seek(-5);
    expect(store.getState().positionSec).toBe(0);
  });
});

describe("resolvePlayable substitution (U15 — Spotify → YouTube fallback, AE5)", () => {
  it("plays the substituted track on its own engine and carries an honest notice", async () => {
    const registry = createAdapterRegistry();
    const yt = makeFakeAdapter("youtube");
    registry.register(yt.adapter);

    // A Spotify-like adapter that substitutes to a YouTube track (the real fallback).
    const ytTarget = track("youtube", "vid");
    const spotify: SourceAdapter = {
      ...makeFakeAdapter("spotify").adapter,
      resolvePlayable: async () => ({ track: ytTarget, notice: "playing the YouTube version" }),
    };
    registry.register(spotify);
    const store = new PlayerStore({ registry });

    const started = await store.play(track("spotify", "sp-1"));
    expect(started).toBe(true);
    // The engine is the YouTube adapter (the resolved track's source), not Spotify.
    expect(yt.calls).toEqual(["load", "play"]);
    expect(store.getState().current?.source).toBe("youtube");
    expect(store.getState().current?.nativeId).toBe("vid");
    expect(store.getState().isPlaying).toBe(true);
    expect(store.getState().notice).toBe("playing the YouTube version");
  });

  it("honestly stays silent with a reason when no substitute can be resolved", async () => {
    const registry = createAdapterRegistry();
    const spotify: SourceAdapter = {
      ...makeFakeAdapter("spotify").adapter,
      resolvePlayable: async () => ({ track: null, reason: "no YouTube version found" }),
    };
    registry.register(spotify);
    const store = new PlayerStore({ registry });

    const started = await store.play(track("spotify", "sp-1"));
    expect(started).toBe(false);
    expect(store.getState().isPlaying).toBe(false);
    expect(store.getState().current?.source).toBe("spotify");
    expect(store.getState().notice).toBe("no YouTube version found");
  });

  it("clears a stale notice when a normal track plays next", async () => {
    const registry = createAdapterRegistry();
    const yt = makeFakeAdapter("youtube");
    registry.register(yt.adapter);
    const spotify: SourceAdapter = {
      ...makeFakeAdapter("spotify").adapter,
      resolvePlayable: async () => ({ track: track("youtube", "v1"), notice: "fallback" }),
    };
    registry.register(spotify);
    const store = new PlayerStore({ registry });

    await store.play(track("spotify", "sp-1"));
    expect(store.getState().notice).toBe("fallback");
    await store.play(track("youtube", "plain"));
    expect(store.getState().notice).toBeNull();
  });
});

describe("switching source stops the previous adapter", () => {
  it("pauses and unloads the old adapter before starting the new one", async () => {
    const registry = createAdapterRegistry();
    const yt = makeFakeAdapter("youtube");
    const local = makeFakeAdapter("local");
    registry.register(yt.adapter);
    registry.register(local.adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "a"));
    await store.play(track("local", "b"));

    expect(yt.calls).toEqual(["load", "play", "pause", "unload"]);
    expect(local.calls).toEqual(["load", "play"]);
  });
});

describe("recovery ladder honesty (AE1 — the playback-stall class fix)", () => {
  it("a fresh play starts with a clean recovery state and no engine error", async () => {
    const registry = createAdapterRegistry();
    const { adapter } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "abc"));
    expect(store.getState().recovery).toEqual({ phase: "ok", skipOffered: false });
    expect(store.currentErrorKind()).toBe("none");
  });

  it("records an engine error kind without lying that playback is still healthy", async () => {
    const registry = createAdapterRegistry();
    const { adapter } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "abc"));
    store.reportError({ message: "The video's owner does not allow it", kind: "fatal", code: 150 });
    // The error is remembered for the recovery monitor to act on…
    expect(store.currentErrorKind()).toBe("fatal");
    // …and it is honest: the store must not still be claiming a clean "ok" recovery.
    // (The app-wide monitor turns this into stalled→error; here we assert the flag.)
    expect(store.currentErrorKind()).not.toBe("none");
  });

  it("clears the engine error once real position progress resumes (self-recovery)", async () => {
    const registry = createAdapterRegistry();
    const { adapter } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "abc"));
    store.reportError({ message: "hiccup", kind: "soft", code: 5 });
    expect(store.currentErrorKind()).toBe("soft");

    store.reportPosition(3); // the player started advancing after all
    expect(store.currentErrorKind()).toBe("none");
  });

  it("recreate rebuilds the underlying player (unload → load → play) on the same track", async () => {
    const registry = createAdapterRegistry();
    const { adapter, calls } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "abc"));
    calls.length = 0;
    const ok = await store.recreate();
    expect(ok).toBe(true);
    expect(calls).toEqual(["unload", "load", "play"]);
    expect(store.getState().current?.nativeId).toBe("abc"); // same track
  });

  it("failStalled surfaces an honest error + Skip and stops claiming to play", async () => {
    const registry = createAdapterRegistry();
    const { adapter } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    // Two tracks: playing the first seeds the second as the up-next queue.
    store.setQueue([track("youtube", "b")]);
    await store.play(track("youtube", "a"));

    store.failStalled();
    const s = store.getState();
    expect(s.isPlaying).toBe(false);
    expect(s.status).toBe("error");
    expect(s.recovery.phase).toBe("error");
    expect(s.recovery.skipOffered).toBe(true); // there is a queued track to skip to
    expect(s.notice).toMatch(/won't play/i);
  });

  it("failStalled with an empty queue still admits the error (skip simply has no target)", async () => {
    const registry = createAdapterRegistry();
    const { adapter } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "solo"));
    store.failStalled();
    const s = store.getState();
    expect(s.status).toBe("error");
    expect(s.recovery.phase).toBe("error");
    expect(s.recovery.skipOffered).toBe(false); // nothing queued to skip to
  });
});
