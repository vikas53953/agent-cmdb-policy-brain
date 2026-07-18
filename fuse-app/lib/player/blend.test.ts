import { describe, expect, it } from "vitest";
import {
  BlendController,
  blendProgressFromElapsed,
  blendStartThresholdSec,
  canBlendDuration,
  clampCrossfadeSec,
  equalPowerGains,
  shouldStartBlend,
  type BlendAdapterPorts,
  type BlendStorePorts,
  type BlendTimers,
} from "@/lib/player/blend";
import type { PlayerState } from "@/lib/player/types";
import type { TrackRef, TrackSource } from "@/lib/repos/track";

const yt = (id: string): TrackRef => ({
  source: "youtube",
  nativeId: id,
  title: `Track ${id}`,
  artist: "Someone",
  artUrl: null,
  durationSec: 200,
});

// ── Pure math ───────────────────────────────────────────────────────────────

describe("equalPowerGains (constant-power crossfade curve)", () => {
  it("hands full volume to the outgoing at the start and the incoming at the end", () => {
    expect(equalPowerGains(0)).toMatchObject({ outgoing: 1 });
    expect(equalPowerGains(0).incoming).toBeCloseTo(0, 6);
    expect(equalPowerGains(1).outgoing).toBeCloseTo(0, 6);
    expect(equalPowerGains(1).incoming).toBeCloseTo(1, 6);
  });

  it("keeps total POWER at one across the whole blend (no mid-blend loudness dip)", () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const { outgoing, incoming } = equalPowerGains(p);
      expect(outgoing * outgoing + incoming * incoming).toBeCloseTo(1, 6);
    }
  });

  it("clamps out-of-range progress rather than producing garbage gains", () => {
    expect(equalPowerGains(-1).outgoing).toBe(1);
    expect(equalPowerGains(2).incoming).toBeCloseTo(1, 6);
  });
});

describe("blend timing helpers", () => {
  it("starts the blend `crossfade` seconds before the end", () => {
    expect(blendStartThresholdSec(200, 8)).toBe(192);
    expect(blendStartThresholdSec(200, 3)).toBe(197);
    expect(blendStartThresholdSec(2, 8)).toBe(0); // never negative
  });

  it("only blends a track comfortably longer than the crossfade", () => {
    expect(canBlendDuration(200, 8)).toBe(true);
    expect(canBlendDuration(8, 8)).toBe(false);
    expect(canBlendDuration(9, 8)).toBe(false); // needs > crossfade + 1s headroom
  });

  it("derives clamped progress from elapsed wall-clock time", () => {
    expect(blendProgressFromElapsed(0, 8)).toBe(0);
    expect(blendProgressFromElapsed(4000, 8)).toBeCloseTo(0.5, 6);
    expect(blendProgressFromElapsed(9000, 8)).toBe(1); // clamped
  });

  it("clamps a crossfade length into the honest 3..15s window", () => {
    expect(clampCrossfadeSec(999)).toBe(15);
    expect(clampCrossfadeSec(1)).toBe(3);
    expect(clampCrossfadeSec(Number.NaN)).toBe(6);
    expect(clampCrossfadeSec(8)).toBe(8);
  });
});

describe("shouldStartBlend (stays inert unless a real blend applies)", () => {
  const base = {
    isPlaying: true,
    alreadyBlending: false,
    positionSec: 195,
    durationSec: 200,
    crossfadeSec: 8,
    currentSource: "youtube" as TrackSource | null,
    nextSource: "youtube" as TrackSource | null,
    blendableSources: ["youtube"] as readonly TrackSource[],
  };

  it("fires inside the crossfade tail with a blendable next track", () => {
    expect(shouldStartBlend(base)).toBe(true);
  });

  it("does not fire mid-track (before the tail)", () => {
    expect(shouldStartBlend({ ...base, positionSec: 100 })).toBe(false);
  });

  it("does not fire when nothing is queued next", () => {
    expect(shouldStartBlend({ ...base, nextSource: null })).toBe(false);
  });

  it("does not fire when the next source cannot overlap (e.g. not yet wired)", () => {
    expect(
      shouldStartBlend({ ...base, nextSource: "spotify", blendableSources: ["youtube"] }),
    ).toBe(false);
  });

  it("does not fire when paused, already blending, or the track is too short", () => {
    expect(shouldStartBlend({ ...base, isPlaying: false })).toBe(false);
    expect(shouldStartBlend({ ...base, alreadyBlending: true })).toBe(false);
    expect(shouldStartBlend({ ...base, durationSec: 8 })).toBe(false);
  });
});

// ── Controller (fakes for the store, adapter, and timers) ───────────────────

function makeFakeStore(initial: Partial<PlayerState> = {}) {
  let state: PlayerState = {
    current: null,
    queue: [],
    isPlaying: false,
    positionSec: 0,
    durationSec: 0,
    shuffle: false,
    repeat: "off",
    notice: null,
    status: "idle",
    ...initial,
  };
  const listeners = new Set<() => void>();
  const promoted: TrackRef[] = [];
  const store: BlendStorePorts = {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    promoteBlended: (track) => {
      promoted.push(track);
      const idx = state.queue.findIndex(
        (t) => t.source === track.source && t.nativeId === track.nativeId,
      );
      const queue = idx >= 0 ? state.queue.filter((_, i) => i !== idx) : state.queue;
      state = { ...state, current: track, queue, isPlaying: true, positionSec: 0 };
      for (const l of listeners) l();
    },
  };
  return {
    store,
    promoted,
    set(patch: Partial<PlayerState>) {
      state = { ...state, ...patch };
      for (const l of listeners) l();
    },
  };
}

function makeFakeAdapter(source: TrackSource = "youtube") {
  const calls: string[] = [];
  const volumes: Array<[number, number]> = [];
  const adapter: BlendAdapterPorts = {
    source,
    beginBlend: async (t) => {
      calls.push(`beginBlend:${t.nativeId}`);
    },
    setBlendVolumes: (o, i) => {
      volumes.push([o, i]);
    },
    completeBlend: () => calls.push("completeBlend"),
    cancelBlend: () => calls.push("cancelBlend"),
    setVolume: (v) => calls.push(`setVolume:${v}`),
  };
  return { adapter, calls, volumes };
}

function makeManualTimers() {
  let now = 0;
  const handlers = new Map<number, () => void>();
  let id = 1;
  const timers: BlendTimers = {
    setInterval: (fn) => {
      const i = id++;
      handlers.set(i, fn);
      return i;
    },
    clearInterval: (i) => handlers.delete(i),
    now: () => now,
  };
  return {
    timers,
    advance(ms: number, stepMs = 50) {
      let remaining = ms;
      while (remaining > 0) {
        const d = Math.min(stepMs, remaining);
        now += d;
        for (const fn of [...handlers.values()]) fn();
        remaining -= d;
      }
    },
  };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function setupController(crossfadeSec = 8) {
  const fakeStore = makeFakeStore();
  const fakeAdapter = makeFakeAdapter("youtube");
  const manual = makeManualTimers();
  const controller = new BlendController({
    store: fakeStore.store,
    resolveBlendAdapter: (s) => (s === "youtube" ? fakeAdapter.adapter : null),
    getCrossfadeSec: () => crossfadeSec,
    timers: manual.timers,
    rampMs: 50,
  });
  controller.start();
  return { fakeStore, fakeAdapter, manual, controller };
}

describe("BlendController — the two-track melt (R3, F2)", () => {
  it("starts the incoming ~crossfade seconds before the end and overlaps the two", async () => {
    const { fakeStore, fakeAdapter, controller } = setupController(8);
    // Playing track one, track two queued, duration 200. Just before the tail: no blend.
    fakeStore.set({
      current: yt("one"),
      queue: [yt("two")],
      isPlaying: true,
      durationSec: 200,
      positionSec: 191,
    });
    expect(fakeAdapter.calls).not.toContain("beginBlend:two");

    // Enter the crossfade tail (200 - 8 = 192): the blend begins.
    fakeStore.set({ positionSec: 192 });
    await flush();
    expect(fakeAdapter.calls).toContain("beginBlend:two");
    // Incoming starts silent (autoplay-safe), outgoing at full — a real overlap.
    expect(fakeAdapter.volumes[0]).toEqual([1, 0]);
    // The melt panel sees the incoming track.
    expect(controller.getMeltState()).toMatchObject({ active: true });
    expect(controller.getMeltState().incoming?.nativeId).toBe("two");
  });

  it("cross-ramps with the equal-power curve and promotes with no cut to silence", async () => {
    const { fakeStore, fakeAdapter, manual, controller } = setupController(8);
    fakeStore.set({
      current: yt("one"),
      queue: [yt("two")],
      isPlaying: true,
      durationSec: 200,
      positionSec: 192,
    });
    await flush();

    // Halfway through the 8s crossfade both tracks sit near 0.707 (equal power).
    manual.advance(4000);
    const mid = fakeAdapter.volumes.at(-1)!;
    expect(mid[0]).toBeCloseTo(0.707, 2);
    expect(mid[1]).toBeCloseTo(0.707, 2);

    // Finish the crossfade: the incoming is promoted (no reload) and brought to full.
    manual.advance(4000);
    expect(fakeAdapter.calls).toContain("completeBlend");
    expect(fakeAdapter.calls).toContain("setVolume:1");
    expect(fakeStore.promoted.map((t) => t.nativeId)).toContain("two");
    // The melt is over.
    expect(controller.getMeltState().active).toBe(false);
  });

  it("honours a shorter crossfade length — a ~3s overlap window (R16 slider is real)", async () => {
    const { fakeStore, fakeAdapter, manual } = setupController(3);
    // Tail for a 3s crossfade is 197, not 192.
    fakeStore.set({
      current: yt("one"),
      queue: [yt("two")],
      isPlaying: true,
      durationSec: 200,
      positionSec: 196,
    });
    await flush();
    expect(fakeAdapter.calls).not.toContain("beginBlend:two");

    fakeStore.set({ positionSec: 197 });
    await flush();
    expect(fakeAdapter.calls).toContain("beginBlend:two");

    // At 2s in, the 3s blend is not done yet.
    manual.advance(2000);
    expect(fakeAdapter.calls).not.toContain("completeBlend");
    // By 3s it completes — the overlap window matched the chosen length.
    manual.advance(1000);
    expect(fakeAdapter.calls).toContain("completeBlend");
  });

  it("stays inert during ordinary playback (no next, non-blendable next, or paused)", async () => {
    const { fakeStore, fakeAdapter } = setupController(8);
    // Deep in the tail but nothing queued next.
    fakeStore.set({
      current: yt("one"),
      queue: [],
      isPlaying: true,
      durationSec: 200,
      positionSec: 199,
    });
    await flush();
    expect(fakeAdapter.calls).toHaveLength(0);

    // A next track from a source with no overlap adapter (e.g. Spotify, not yet wired).
    fakeStore.set({
      queue: [
        { source: "spotify", nativeId: "sp", title: "S", artist: null, artUrl: null, durationSec: 200 },
      ],
    });
    await flush();
    expect(fakeAdapter.calls).toHaveLength(0);
  });

  it("abandons a blend cleanly if the user jumps to another track mid-melt", async () => {
    const { fakeStore, fakeAdapter, controller } = setupController(8);
    fakeStore.set({
      current: yt("one"),
      queue: [yt("two")],
      isPlaying: true,
      durationSec: 200,
      positionSec: 192,
    });
    await flush();
    expect(fakeAdapter.calls).toContain("beginBlend:two");

    // User picks an unrelated track — neither the outgoing nor the incoming.
    fakeStore.set({ current: yt("nine"), queue: [] });
    expect(fakeAdapter.calls).toContain("cancelBlend");
    // Primary restored to full volume, melt cleared — never left quiet.
    expect(fakeAdapter.calls).toContain("setVolume:1");
    expect(controller.getMeltState().active).toBe(false);
  });
});
