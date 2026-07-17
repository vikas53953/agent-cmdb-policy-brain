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
