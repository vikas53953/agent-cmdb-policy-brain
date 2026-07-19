import { describe, expect, it, vi } from "vitest";
import {
  clampPlaybackRate,
  createYouTubeAdapter,
  YOUTUBE_CAPABILITIES,
  youtubeAdapter,
  type DocumentLike,
  type PlayerBridge,
  type Timers,
  type YtPlayerCallbacks,
  type YtPlayerHandle,
} from "@/lib/player/adapters/youtube";
import { adapterRegistry } from "@/lib/player/adapters";
import { SOURCE_CAPABILITIES } from "@/lib/player/capabilities";
import type { TrackRef } from "@/lib/repos/track";

// A YouTube track (search only ever plays YouTube in U7).
const track = (id: string): TrackRef => ({
  source: "youtube",
  nativeId: id,
  title: `Track ${id}`,
  artist: "Someone",
  artUrl: null,
  durationSec: 200,
});

// ── A DOM-free fake environment so the adapter runs under the node test env ─────

type FakeEl = {
  className: string;
  style: Record<string, string>;
  parentElement: FakeEl | null;
  children: FakeEl[];
  appendChild(child: FakeEl): void;
  setAttribute(): void;
};

function fakeEl(): FakeEl {
  const el: FakeEl = {
    className: "",
    style: {},
    parentElement: null,
    children: [],
    appendChild(child) {
      // Mirror DOM re-parenting: detach from a previous parent first.
      if (child.parentElement) {
        child.parentElement.children = child.parentElement.children.filter(
          (c) => c !== child,
        );
      }
      child.parentElement = el;
      el.children.push(child);
    },
    setAttribute() {},
  };
  return el;
}

function fakeDoc(): DocumentLike {
  const body = fakeEl();
  return {
    createElement: () => fakeEl() as unknown as HTMLElement,
    body: body as unknown as HTMLElement,
  };
}

// A fake YT player handle that records calls and lets the test fire state events.
function fakePlayer() {
  const calls: string[] = [];
  let currentTime = 0;
  let duration = 0;
  let cb: YtPlayerCallbacks | null = null;
  const handle: YtPlayerHandle = {
    playVideo: () => calls.push("playVideo"),
    pauseVideo: () => calls.push("pauseVideo"),
    seekTo: (s) => calls.push(`seekTo:${s}`),
    setVolume: (v) => calls.push(`setVolume:${v}`),
    setPlaybackRate: (r) => calls.push(`setPlaybackRate:${r}`),
    loadVideoById: (id) => calls.push(`loadVideoById:${id}`),
    cueVideoById: (id) => calls.push(`cueVideoById:${id}`),
    getCurrentTime: () => currentTime,
    getDuration: () => duration,
    destroy: () => calls.push("destroy"),
  };
  return {
    calls,
    handle,
    setClock(t: number, d: number) {
      currentTime = t;
      duration = d;
    },
    fireState(state: number) {
      cb?.onStateChange(state);
    },
    bind(callbacks: YtPlayerCallbacks) {
      cb = callbacks;
    },
  };
}

// Manual timer control so the polling loop is deterministic in node.
function manualTimers() {
  let handler: (() => void) | null = null;
  const timers: Timers = {
    setInterval: (fn) => {
      handler = fn;
      return 1;
    },
    clearInterval: () => {
      handler = null;
    },
  };
  return {
    timers,
    tick() {
      handler?.();
    },
    isRunning() {
      return handler !== null;
    },
  };
}

function fakeStore() {
  const positions: Array<{ pos: number; dur?: number }> = [];
  const errors: Array<{ message: string; kind: "soft" | "fatal"; code?: number }> = [];
  let nextCalls = 0;
  const bridge: PlayerBridge = {
    reportPosition: (pos, dur) => positions.push({ pos, dur }),
    next: async () => {
      nextCalls += 1;
      return true;
    },
    reportError: (info) => errors.push(info),
  };
  return {
    bridge,
    positions,
    errors,
    nextCalls: () => nextCalls,
  };
}

describe("clampPlaybackRate (U7 — YouTube's real [0.25..2] ceiling)", () => {
  it("clamps 3x down to the real 2x maximum", () => {
    expect(clampPlaybackRate(3)).toBe(2);
  });
  it("clamps below the floor up to 0.25", () => {
    expect(clampPlaybackRate(0.1)).toBe(0.25);
  });
  it("passes an in-range rate through unchanged", () => {
    expect(clampPlaybackRate(1.5)).toBe(1.5);
  });
  it("falls back to 1x for NaN", () => {
    expect(clampPlaybackRate(Number.NaN)).toBe(1);
  });
});

describe("YouTube capabilities match the matrix", () => {
  it("is exactly the YouTube column from the capability resolver", () => {
    expect(YOUTUBE_CAPABILITIES).toBe(SOURCE_CAPABILITIES.youtube);
    expect(YOUTUBE_CAPABILITIES.eq).toBe(false);
    expect(YOUTUBE_CAPABILITIES.loops).toBe(false);
    expect(YOUTUBE_CAPABILITIES.fx).toBe(false);
    expect(YOUTUBE_CAPABILITIES.scratch).toBe(false);
    expect(YOUTUBE_CAPABILITIES.singleDeckOnly).toBe(false);
    expect(YOUTUBE_CAPABILITIES.rateRange).toEqual([0.25, 2]);
  });
});

describe("the adapter registers itself so YouTube results become playable (R17)", () => {
  it("is the registered youtube adapter in the shared registry", () => {
    expect(adapterRegistry.get("youtube")).toBe(youtubeAdapter);
    expect(youtubeAdapter.source).toBe("youtube");
  });
});

describe("adapter playback behaviour (driven through injected fakes)", () => {
  function setup() {
    const player = fakePlayer();
    const store = fakeStore();
    const timers = manualTimers();
    const factory = vi.fn(
      async (_target: HTMLElement, _videoId: string, cb: YtPlayerCallbacks) => {
        player.bind(cb);
        cb.onReady(); // real player fires ready once the API is loaded
        return player.handle;
      },
    );
    const adapter = createYouTubeAdapter({
      factory,
      store: store.bridge,
      doc: fakeDoc(),
      timers: timers.timers,
    });
    return { adapter, player, store, timers, factory };
  }

  it("creates ONE player and plays it (visible surface flow: load then play)", async () => {
    const { adapter, player, factory } = setup();
    await adapter.load(track("aaa"));
    await adapter.play();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(player.calls).toContain("playVideo");
  });

  it("reuses the single player for the next track — no teardown, same iframe", async () => {
    const { adapter, player, factory } = setup();
    await adapter.load(track("aaa"));
    await adapter.load(track("bbb"));
    expect(factory).toHaveBeenCalledTimes(1); // not recreated
    expect(player.calls).toContain("loadVideoById:bbb");
    expect(player.calls).not.toContain("destroy");
  });

  it("clamps a 3x speed request to 2x on the real player", async () => {
    const { adapter, player } = setup();
    await adapter.load(track("aaa"));
    adapter.setRate(3);
    expect(player.calls).toContain("setPlaybackRate:2");
  });

  it("maps 0..1 volume onto the player's 0..100 scale", async () => {
    const { adapter, player } = setup();
    await adapter.load(track("aaa"));
    adapter.setVolume(0.5);
    expect(player.calls).toContain("setVolume:50");
  });

  it("mirrors the player clock into the store while polling", async () => {
    const { adapter, player, store, timers } = setup();
    await adapter.load(track("aaa"));
    player.setClock(42, 200);
    timers.tick();
    expect(store.positions.at(-1)).toEqual({ pos: 42, dur: 200 });
  });

  it("advances the queue when a track ends", async () => {
    const { adapter, player, store } = setup();
    await adapter.load(track("aaa"));
    player.fireState(0); // YT ENDED
    expect(store.nextCalls()).toBe(1);
  });

  it("unload destroys the player and stops polling", async () => {
    const { adapter, player, timers } = setup();
    await adapter.load(track("aaa"));
    expect(timers.isRunning()).toBe(true);
    adapter.unload();
    expect(player.calls).toContain("destroy");
    expect(timers.isRunning()).toBe(false);
  });

  it("is a no-op without a DOM (SSR / node) rather than pretending to play", async () => {
    const store = fakeStore();
    const factory = vi.fn();
    const adapter = createYouTubeAdapter({
      factory: factory as never,
      store: store.bridge,
      doc: null, // no document
    });
    await adapter.load(track("aaa"));
    await adapter.play();
    expect(factory).not.toHaveBeenCalled();
  });
});

// The auto-crossfade blend surface (U11): a SECOND visible player overlaps the primary
// so two YouTube tracks truly cross-ramp, then the incoming is promoted with no reload.
describe("two-player blend surface (U11 — real overlap, seamless promotion)", () => {
  // A setup that returns a FRESH player per factory call, so we can tell the primary
  // (players[0]) from the incoming (players[1]) apart.
  function setup() {
    const players: Array<{ p: ReturnType<typeof fakePlayer>; videoId: string }> = [];
    const store = fakeStore();
    const timers = manualTimers();
    const factory = vi.fn(
      async (_target: HTMLElement, videoId: string, cb: YtPlayerCallbacks) => {
        const p = fakePlayer();
        p.bind(cb);
        cb.onReady();
        players.push({ p, videoId });
        return p.handle;
      },
    );
    const adapter = createYouTubeAdapter({
      factory,
      store: store.bridge,
      doc: fakeDoc(),
      timers: timers.timers,
    });
    return { adapter, players, factory };
  }

  it("beginBlend warms a SECOND player and plays it while the primary keeps playing", async () => {
    const { adapter, players, factory } = setup();
    await adapter.load(track("aaa"));
    await adapter.beginBlend(track("bbb"));
    expect(factory).toHaveBeenCalledTimes(2); // primary + incoming
    expect(players[1].videoId).toBe("bbb");
    expect(players[1].p.calls).toContain("playVideo");
    // The outgoing was never destroyed — both are live (a real overlap).
    expect(players[0].p.calls).not.toContain("destroy");
  });

  it("setBlendVolumes cross-ramps both players on the 0..100 scale", async () => {
    const { adapter, players } = setup();
    await adapter.load(track("aaa"));
    await adapter.beginBlend(track("bbb"));
    adapter.setBlendVolumes(0.25, 0.75);
    expect(players[0].p.calls).toContain("setVolume:25");
    expect(players[1].p.calls).toContain("setVolume:75");
  });

  it("completeBlend retires the old primary and promotes the incoming with NO reload", async () => {
    const { adapter, players } = setup();
    await adapter.load(track("aaa"));
    await adapter.beginBlend(track("bbb"));
    adapter.completeBlend();
    expect(players[0].p.calls).toContain("destroy"); // old primary gone
    expect(players[1].p.calls).not.toContain("destroy"); // incoming continues, no reload
    expect(players[1].p.calls).not.toContain("loadVideoById:bbb");
    // Primary controls now route to the promoted incoming player.
    adapter.setVolume(0.5);
    expect(players[1].p.calls).toContain("setVolume:50");
  });

  it("cancelBlend tears down only the incoming and leaves the primary playing", async () => {
    const { adapter, players } = setup();
    await adapter.load(track("aaa"));
    await adapter.beginBlend(track("bbb"));
    adapter.cancelBlend();
    expect(players[1].p.calls).toContain("destroy");
    adapter.setVolume(0.5);
    expect(players[0].p.calls).toContain("setVolume:50"); // primary still active
    expect(players[0].p.calls).not.toContain("destroy");
  });

  it("beginBlend is a no-op without a DOM rather than pretending to overlap", async () => {
    const store = fakeStore();
    const factory = vi.fn();
    const adapter = createYouTubeAdapter({
      factory: factory as never,
      store: store.bridge,
      doc: null,
    });
    await adapter.beginBlend(track("bbb"));
    expect(factory).not.toHaveBeenCalled();
  });
});

// A fake host coordinator that records the geometry calls, so we can prove GEOMETRY mode
// (the app's main player) never re-parents: it builds the player in the coordinator's host
// and promotes a blend by swapping refs, not by appendChild across containers.
function fakeCoordinator() {
  const primary = fakeEl();
  const inc = fakeEl();
  const live: Array<{ role: string; live: boolean }> = [];
  let promoted = 0;
  const coordinator = {
    start: () => () => {},
    primaryHost: () => primary as unknown as HTMLElement,
    incomingHost: () => inc as unknown as HTMLElement,
    promoteIncoming: () => {
      promoted += 1;
    },
    registerSlot: () => {},
    releaseSlot: () => {},
    setPlaybackLive: (role: string, isLive: boolean) => live.push({ role, live: isLive }),
    activeSlot: () => null,
  };
  return { coordinator, primary, inc, live, promoted: () => promoted };
}

describe("geometry mode (the reparent-reload fix) — coordinator-driven host", () => {
  function setup() {
    const players: Array<{ p: ReturnType<typeof fakePlayer>; videoId: string }> = [];
    const store = fakeStore();
    const timers = manualTimers();
    const coord = fakeCoordinator();
    const factory = vi.fn(
      async (_target: HTMLElement, videoId: string, cb: YtPlayerCallbacks) => {
        const p = fakePlayer();
        p.bind(cb);
        cb.onReady();
        players.push({ p, videoId });
        return p.handle;
      },
    );
    const adapter = createYouTubeAdapter({
      factory,
      store: store.bridge,
      doc: fakeDoc(),
      timers: timers.timers,
      coordinator: coord.coordinator as never,
    });
    return { adapter, players, coord, store };
  }

  it("builds the player inside the coordinator's primary host and marks playback live", async () => {
    const { adapter, coord } = setup();
    await adapter.load(track("aaa"));
    // The target the player was built in is a child of the coordinator's primary host — the
    // ONE never-re-parented element.
    expect((coord.primary as unknown as { children: unknown[] }).children.length).toBe(1);
    expect(coord.live).toContainEqual({ role: "primary", live: true });
  });

  it("mount/unmount are no-ops in geometry mode (slots own on-screen placement)", async () => {
    const { adapter } = setup();
    await adapter.load(track("aaa"));
    const container = fakeEl() as unknown as HTMLElement;
    adapter.mount(container);
    adapter.unmount(container);
    // The container is never used as a host — no reparent path exists.
    expect((container as unknown as { children: unknown[] }).children.length).toBe(0);
  });

  it("completeBlend promotes by a geometry swap, never an appendChild reparent", async () => {
    const { adapter, coord, players } = setup();
    await adapter.load(track("aaa"));
    await adapter.beginBlend(track("bbb"));
    expect(coord.live).toContainEqual({ role: "incoming", live: true });

    adapter.completeBlend();
    expect(coord.promoted()).toBe(1); // the seamless swap happened
    expect(players[0].p.calls).toContain("destroy"); // old primary retired
    expect(players[1].p.calls).not.toContain("destroy"); // incoming continues, no reload
    expect(players[1].p.calls).not.toContain("loadVideoById:bbb"); // never reloaded
    // Primary controls now route to the promoted incoming player.
    adapter.setVolume(0.5);
    expect(players[1].p.calls).toContain("setVolume:50");
  });

  it("unload clears the primary and tells the coordinator playback is no longer live", async () => {
    const { adapter, coord } = setup();
    await adapter.load(track("aaa"));
    adapter.unload();
    expect(coord.live).toContainEqual({ role: "primary", live: false });
  });

  it("pause marks playback not-live so a slot-less screen shows no orphaned chip (P1 DJ)", async () => {
    // When the DJ console (a screen with no player slot) pauses the main track, the paused
    // video carries no ToS visibility obligation — so the adapter tells the coordinator
    // playback is no longer live, which hides the host instead of stranding an
    // uncontrollable fallback chip over the console. Resuming re-marks it live.
    const { adapter, coord } = setup();
    await adapter.load(track("aaa"));
    await adapter.play();
    coord.live.length = 0; // focus on what pause/play report from here
    adapter.pause();
    expect(coord.live).toContainEqual({ role: "primary", live: false });
    coord.live.length = 0;
    await adapter.play();
    expect(coord.live).toContainEqual({ role: "primary", live: true });
  });
});

describe("engine state seam (intent-gated recovery reads this)", () => {
  function setup() {
    const player = fakePlayer();
    const engineStates: string[] = [];
    const store: PlayerBridge = {
      reportPosition: () => {},
      next: async () => true,
      reportError: () => {},
      reportEngineState: (s) => engineStates.push(s),
    };
    const timers = manualTimers();
    const factory = vi.fn(
      async (_t: HTMLElement, _v: string, cb: YtPlayerCallbacks) => {
        player.bind(cb);
        cb.onReady();
        return player.handle;
      },
    );
    const adapter = createYouTubeAdapter({ factory, store, doc: fakeDoc(), timers: timers.timers });
    return { adapter, player, engineStates };
  }

  it("mirrors YT.PlayerState codes into the store as EngineState", async () => {
    const { adapter, player, engineStates } = setup();
    await adapter.load(track("aaa"));
    player.fireState(1); // PLAYING
    player.fireState(2); // PAUSED
    player.fireState(3); // BUFFERING
    expect(engineStates).toContain("playing");
    expect(engineStates).toContain("paused");
    expect(engineStates).toContain("buffering");
    // getEngineState reflects the latest.
    expect(adapter.getEngineState?.()).toBe("buffering");
  });

  it("reports 'paused' on pause() so recovery sees the engine is not playing", async () => {
    const { adapter, engineStates } = setup();
    await adapter.load(track("aaa"));
    adapter.pause();
    expect(engineStates).toContain("paused");
  });
});
