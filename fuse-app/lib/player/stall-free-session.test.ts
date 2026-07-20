import { describe, expect, it } from "vitest";
import { PlayerStore } from "@/lib/player/store";
import { createAdapterRegistry } from "@/lib/player/adapters";
import {
  createYouTubeAdapter,
  type DocumentLike,
  type Timers,
  type YtPlayerCallbacks,
  type YtPlayerHandle,
} from "@/lib/player/adapters/youtube";
import {
  initHealth,
  stepHealth,
  DEFAULT_HEALTH_CONFIG,
  type HealthState,
} from "@/lib/player/playback-health";
import type { TrackRef } from "@/lib/repos/track";

// ── F-1 END-TO-END EVIDENCE ────────────────────────────────────────────────────
//
// The unit tests in youtube.test.ts pin the wiring. THIS file proves the symptom: it
// runs a realistic multi-track listening session through the REAL PlayerStore, the REAL
// YouTube adapter (its two-player crossfade included) and the REAL recovery ladder, with
// only the browser seams faked — then asserts that the ladder never once fires, i.e. that
// "Playback stalled — retrying" is never logged during normal playback.
//
// Before the fix this session produced a stall episode on every track after the first
// crossfade, because the promoted player's engine lifecycle stopped reaching the store.

const TICK_MS = 1000; // the recovery monitor's real sample rate
const POLL_MS = 500; // the adapter's real clock-mirror rate

const YT_PLAYING = 1;
const YT_ENDED = 0;
const YT_BUFFERING = 3;

const track = (id: string, durationSec = 180): TrackRef => ({
  source: "youtube",
  nativeId: id,
  title: `Track ${id}`,
  artist: "Someone",
  artUrl: null,
  durationSec,
});

// ── Fake browser seams ─────────────────────────────────────────────────────────

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

// A YT player fake with a real clock: it advances while "playing" and fires the engine's
// own PLAYING / BUFFERING / ENDED events exactly as the IFrame API does.
function enginePlayer(durationSec: number) {
  let cb: YtPlayerCallbacks | null = null;
  let t = 0;
  let playing = false;
  let ended = false;
  const handle: YtPlayerHandle = {
    playVideo: () => {
      if (ended) {
        // A real player restarts from 0 on play-after-end. This is exactly what made the
        // pre-fix false stall self-heal into an audible restart of the same song.
        t = 0;
        ended = false;
      }
      playing = true;
      cb?.onStateChange(YT_PLAYING);
    },
    pauseVideo: () => {
      playing = false;
    },
    seekTo: (s) => {
      t = s;
    },
    setVolume: () => {},
    setPlaybackRate: () => {},
    loadVideoById: () => {
      t = 0;
      ended = false;
    },
    cueVideoById: () => {},
    getCurrentTime: () => t,
    getDuration: () => durationSec,
    destroy: () => {
      playing = false;
      cb = null;
    },
  };
  return {
    handle,
    bind(callbacks: YtPlayerCallbacks) {
      cb = callbacks;
    },
    // Advance wall-clock by ms; the engine plays, buffers and ends on its own.
    advance(ms: number) {
      if (!playing || ended) return;
      t += ms / 1000;
      if (t >= durationSec) {
        t = durationSec;
        playing = false;
        ended = true;
        cb?.onStateChange(YT_ENDED);
      }
    },
    buffer() {
      cb?.onStateChange(YT_BUFFERING);
    },
    resumeFromBuffer() {
      cb?.onStateChange(YT_PLAYING);
    },
    isEnded: () => ended,
  };
}

function manualTimers() {
  const handlers: Array<() => void> = [];
  const timers: Timers = {
    setInterval: (fn) => {
      handlers.push(fn);
      return handlers.length;
    },
    clearInterval: (id) => {
      handlers[id - 1] = () => {};
    },
  };
  return {
    timers,
    tick() {
      for (const h of [...handlers]) h();
    },
  };
}

describe("F-1: a normal listening session never trips the stall ladder", () => {
  it("plays a queue across auto-crossfades with ZERO stall-retry / stall-recreate", async () => {
    const timers = manualTimers();
    const engines: Array<ReturnType<typeof enginePlayer>> = [];

    // Short tracks so a multi-track session is cheap to simulate; the durations only
    // decide when the engine fires ENDED.
    const durations = [30, 30, 30];
    let built = 0;

    const adapter = createYouTubeAdapter({
      doc: fakeDoc(),
      timers: timers.timers,
      coordinator: null,
      // `store` is bound after construction via the registry below.
      store: {
        reportPosition: (pos, dur) => storeRef!.reportPosition(pos, dur),
        next: (reason) => storeRef!.next(reason),
        reportError: (info) => storeRef!.reportError(info),
        reportEngineState: (s) => storeRef!.reportEngineState(s),
      },
      factory: async (_t, _v, cb) => {
        const e = enginePlayer(durations[Math.min(built, durations.length - 1)]);
        built += 1;
        e.bind(cb);
        engines.push(e);
        cb.onReady();
        return e.handle;
      },
    });

    const registry = createAdapterRegistry();
    registry.register(adapter);
    const storeRef: PlayerStore | null = new PlayerStore({ registry });
    const store = storeRef;

    store.setQueue([track("bbb", 30), track("ccc", 30)]);
    await store.play(track("aaa", 30));

    // The recovery ladder, driven exactly as use-playback-recovery.ts drives it.
    let health: HealthState = initHealth(0);
    const ladderActions: string[] = [];
    let nowMs = 0;
    let lastKey = "youtube:aaa";

    // Drive the auto-crossfade exactly as BlendController does: begin the blend inside the
    // tail of the outgoing track, ramp, then promote. This is the path that used to leave
    // the app with a primary player whose engine lifecycle nobody could hear.
    const CROSSFADE_SEC = 6;
    let blending: TrackRef | null = null;
    let blendTicks = 0;

    // ~90 simulated seconds at the real 1s monitor tick / 500ms adapter poll.
    for (let i = 0; i < 90; i += 1) {
      // Two adapter polls per monitor tick.
      for (let p = 0; p < TICK_MS / POLL_MS; p += 1) {
        for (const e of engines) e.advance(POLL_MS);
        timers.tick();
      }
      nowMs += TICK_MS;

      // ── the crossfade the app really performs ──────────────────────────────
      {
        const st = store.getState();
        const upNext = st.queue[0] ?? null;
        if (
          !blending &&
          upNext &&
          st.durationSec > 0 &&
          st.positionSec >= st.durationSec - CROSSFADE_SEC &&
          st.intent === "play"
        ) {
          blending = upNext;
          blendTicks = 0;
          await adapter.beginBlend(upNext);
        } else if (blending) {
          blendTicks += 1;
          const progress = Math.min(1, blendTicks / CROSSFADE_SEC);
          adapter.setBlendVolumes(1 - progress, progress);
          if (progress >= 1) {
            adapter.completeBlend();
            store.promoteBlended(blending);
            blending = null;
          }
        }
      }

      const s = store.getState();
      const key = s.current ? `${s.current.source}:${s.current.nativeId}` : null;
      // The monitor re-baselines the ladder whenever the track changes.
      if (key !== lastKey) {
        health = initHealth(nowMs);
        lastKey = key ?? "";
      }
      if (!key) continue;

      const outcome = stepHealth(
        health,
        {
          intent: s.intent,
          engineState: store.currentEngineState(),
          positionSec: s.positionSec,
          nowMs,
          errorKind: store.currentErrorKind(),
        },
        DEFAULT_HEALTH_CONFIG,
      );
      health = outcome.state;
      if (outcome.action !== "none") ladderActions.push(`${outcome.action}@${nowMs}ms`);
      if (health.phase === "error") ladderActions.push(`error@${nowMs}ms`);
    }

    // Guard the guard: the session must actually have crossfaded (more than one player
    // built and promoted), or this test would be proving nothing.
    expect(engines.length).toBeGreaterThan(1);

    // THE EVIDENCE: not one rung of the recovery ladder fired across the whole session.
    // Every one of these would have written "Playback stalled — retrying" (or
    // "— rebuilding the player") to the activity log.
    expect(ladderActions).toEqual([]);

    // And the session genuinely progressed — this is not "quiet because nothing played".
    expect(store.getState().current?.nativeId).not.toBe("aaa");
    expect(store.getState().history.length).toBeGreaterThan(0);
  });

  it("a real end-of-track is reported as 'ended' — which can never be read as a stall", async () => {
    const timers = manualTimers();
    let engine: ReturnType<typeof enginePlayer> | null = null;

    // The registry is populated after construction, so the store exists before the
    // adapter's bridge closes over it.
    const registry = createAdapterRegistry();
    const store = new PlayerStore({ registry });
    const adapter = createYouTubeAdapter({
      doc: fakeDoc(),
      timers: timers.timers,
      coordinator: null,
      store: {
        reportPosition: (pos, dur) => store.reportPosition(pos, dur),
        next: async () => false, // nothing queued: the track simply ends and stops
        reportError: (info) => store.reportError(info),
        reportEngineState: (s) => store.reportEngineState(s),
      },
      factory: async (_t, _v, cb) => {
        engine = enginePlayer(10);
        engine.bind(cb);
        cb.onReady();
        return engine.handle;
      },
    });
    registry.register(adapter);

    await store.play(track("aaa", 10));

    // Run past the end of the track with an EMPTY queue — the pre-fix worst case, where
    // the clock freezes at the end and nothing advances.
    let health: HealthState = initHealth(0);
    const actions: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      for (let p = 0; p < 2; p += 1) {
        engine!.advance(POLL_MS);
        timers.tick();
      }
      const s = store.getState();
      const outcome = stepHealth(health, {
        intent: s.intent,
        engineState: store.currentEngineState(),
        positionSec: s.positionSec,
        nowMs: (i + 1) * TICK_MS,
        errorKind: store.currentErrorKind(),
      });
      health = outcome.state;
      if (outcome.action !== "none") actions.push(outcome.action);
    }

    expect(engine!.isEnded()).toBe(true);
    // The engine's own truth reached the store, so the frozen clock is EXPECTED, not a stall.
    expect(store.currentEngineState()).toBe("ended");
    expect(actions).toEqual([]);
    expect(health.phase).not.toBe("error");
  });
});
