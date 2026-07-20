// Queue behaviour parity with Spotify / Apple Music / YouTube Music.
//
// Each describe block below kills ONE specific, reproducible bug from the queue audit. The
// comment on each says what a listener actually experienced, because that is the thing these
// tests exist to stop coming back — not the implementation detail that happened to cause it.

import { describe, expect, it, vi } from "vitest";
import { PlayerStore } from "@/lib/player/store";
import { BlendController, type BlendAdapterPorts, type BlendTimers } from "@/lib/player/blend";
import { createAdapterRegistry } from "@/lib/player/adapters";
import { SOURCE_CAPABILITIES } from "@/lib/player/capabilities";
import type { SourceAdapter } from "@/lib/player/types";
import type { TrackRef } from "@/lib/repos/track";

const yt = (nativeId: string): TrackRef => ({
  source: "youtube",
  nativeId,
  title: `Track ${nativeId}`,
  artist: "Someone",
  artUrl: null,
  durationSec: 200,
});

function fakeAdapter(): SourceAdapter {
  return {
    source: "youtube",
    capabilities: SOURCE_CAPABILITIES.youtube,
    load: async () => {},
    play: async () => {},
    pause: () => {},
    seek: () => {},
    setVolume: () => {},
    setRate: () => {},
    unload: () => {},
  };
}

function freshStore(): PlayerStore {
  const registry = createAdapterRegistry();
  registry.register(fakeAdapter());
  return new PlayerStore({ registry });
}

const ids = (store: PlayerStore) => store.getState().queue.map((t) => t.nativeId);

// ── A ─────────────────────────────────────────────────────────────────────────────
// WHAT THE LISTENER SAW: queue up five songs from search, tap a sixth song to play now,
// and all five vanish. No warning, no undo. Every row tap in the app calls setQueue(), and
// setQueue() replaced the entire upcoming list.
describe("a fresh listening context never destroys the hand-built queue (fix A)", () => {
  it("keeps everything the listener queued when a row tap replaces the context", async () => {
    const store = freshStore();
    await store.play(yt("playing"));
    store.setQueue([yt("album1"), yt("album2")]); // the list the first tap came from
    store.addToQueue(yt("mine1"));
    store.addToQueue(yt("mine2"));

    // The listener now taps a completely different song, which hands over a new context.
    store.setQueue([yt("other1"), yt("other2")]);

    // The hand-queued songs are still there — and still ahead of the new context.
    expect(ids(store)).toEqual(["mine1", "mine2", "other1", "other2"]);
  });

  it("plays the user queue before the context list", async () => {
    const store = freshStore();
    await store.play(yt("playing"));
    store.setQueue([yt("album1")]);
    store.addToQueue(yt("mine"));

    await store.next();
    expect(store.getState().current?.nativeId).toBe("mine");
    expect(ids(store)).toEqual(["album1"]);
  });

  it("still replaces the CONTEXT list — a new tap does not pile albums up forever", async () => {
    const store = freshStore();
    await store.play(yt("playing"));
    store.setQueue([yt("a1"), yt("a2"), yt("a3")]);
    store.setQueue([yt("b1")]);
    expect(ids(store)).toEqual(["b1"]);
  });

  it("a hand-queued song survives even when the context is emptied by a tap", async () => {
    const store = freshStore();
    await store.play(yt("playing"));
    store.playNext(yt("mine"));
    store.setQueue([]);
    expect(ids(store)).toEqual(["mine"]);
  });
});

// ── B ─────────────────────────────────────────────────────────────────────────────
// WHAT THE LISTENER SAW: the queue screen let you drag, nudge and delete rows but not TAP
// one to play it — reaching the sixth song up next meant pressing Next six times — and there
// was no way to empty the queue short of removing every row by hand.
describe("the queue screen can play a row and clear the list (fix B)", () => {
  it("playFromQueue jumps straight to a row and drops what it skipped past", async () => {
    const store = freshStore();
    await store.play(yt("playing"));
    store.setQueue([yt("a"), yt("b"), yt("c"), yt("d")]);

    const played = await store.playFromQueue(2);
    expect(played).toBe(true);
    expect(store.getState().current?.nativeId).toBe("c");
    // Exactly what pressing Next three times would have left behind.
    expect(ids(store)).toEqual(["d"]);
  });

  it("playFromQueue records the track it left in history, so Previous still works", async () => {
    const store = freshStore();
    await store.play(yt("playing"));
    store.setQueue([yt("a"), yt("b")]);
    await store.playFromQueue(1);
    expect(store.getState().history.map((t) => t.nativeId)).toEqual(["playing"]);
  });

  it("playFromQueue is an honest no-op on a stale index, never a crash", async () => {
    const store = freshStore();
    await store.play(yt("playing"));
    store.setQueue([yt("a")]);
    expect(await store.playFromQueue(7)).toBe(false);
    expect(await store.playFromQueue(-1)).toBe(false);
    expect(store.getState().current?.nativeId).toBe("playing");
    expect(ids(store)).toEqual(["a"]);
  });

  it("clearQueue empties BOTH the user queue and the context, and keeps playing", async () => {
    const store = freshStore();
    await store.play(yt("playing"));
    store.setQueue([yt("a"), yt("b")]);
    store.addToQueue(yt("mine"));

    store.clearQueue();
    expect(ids(store)).toEqual([]);
    // Clearing the queue is not a stop command — the current track is untouched.
    expect(store.getState().current?.nativeId).toBe("playing");
    expect(store.getState().isPlaying).toBe(true);
  });

  it("clearQueue drops the radio / autoplay labels describing a list that no longer exists", async () => {
    const store = freshStore();
    store.setRadioProvider(async () => [yt("r1"), yt("r2")]);
    await store.play(yt("seed"));
    await store.seedAutoplayQueue();
    expect(store.getState().autoplayQueued).toBe(true);

    store.clearQueue();
    expect(store.getState().autoplayQueued).toBe(false);
    expect(store.getState().radioActive).toBe(false);
  });
});

// ── C ─────────────────────────────────────────────────────────────────────────────
// WHAT THE LISTENER SAW: on the last track with "Autoplay similar" on, the Skip button was
// greyed out — even though pressing it would genuinely have worked. Both transport surfaces
// derived "can I advance?" from queue.length, which is only ONE of the three ways next()
// actually advances.
describe("canAdvance reflects what next() would really do (fix C)", () => {
  it("is false only when listening genuinely ends here", async () => {
    const store = freshStore();
    await store.play(yt("last"));
    expect(store.getState().canAdvance).toBe(false);
    expect(await store.next()).toBe(false);
  });

  it("is true with an empty queue when repeat would replay", async () => {
    const store = freshStore();
    await store.play(yt("last"));
    store.cycleRepeat(); // off → all
    expect(store.getState().canAdvance).toBe(true);
    store.cycleRepeat(); // all → one
    expect(store.getState().canAdvance).toBe(true);
  });

  it("is true with an empty queue when consented radio continuation is wired", async () => {
    const store = freshStore();
    await store.play(yt("last"));
    expect(store.getState().canAdvance).toBe(false);

    store.setRadioProvider(async () => [yt("similar")]);
    expect(store.getState().canAdvance).toBe(true);

    // Withdrawing consent takes it away again — the control follows the real capability.
    store.setAutoplaySimilar(false);
    expect(store.getState().canAdvance).toBe(false);
  });

  it("notifies subscribers when the capability changes, so a control re-renders", async () => {
    const store = freshStore();
    await store.play(yt("last"));
    const seen: boolean[] = [];
    store.subscribe((s) => seen.push(s.canAdvance));
    store.setRadioProvider(async () => [yt("similar")]);
    expect(seen).toContain(true);
  });

  it("is true whenever something is queued", async () => {
    const store = freshStore();
    await store.play(yt("a"));
    store.setQueue([yt("b")]);
    expect(store.getState().canAdvance).toBe(true);
  });
});

// ── D ─────────────────────────────────────────────────────────────────────────────
// WHAT THE LISTENER SAW: with shuffle on, "Up next" listed the album in its original order
// while playback jumped somewhere else entirely. The panel rendered the array as stored; the
// advance rolled a die. The displayed list was simply a lie.
describe("the visible queue IS the play order under shuffle (fix D)", () => {
  it("re-orders the visible list when shuffle is toggled on", async () => {
    // Across many stores the projected order genuinely varies — the toggle is real.
    const orders = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const store = freshStore();
      await store.play(yt("a"));
      store.setQueue(["b", "c", "d", "e", "f"].map(yt));
      store.toggleShuffle();
      orders.add(ids(store).join(","));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it("plays exactly the track shown at the top of the visible queue", async () => {
    for (let i = 0; i < 50; i += 1) {
      const store = freshStore();
      await store.play(yt("a"));
      store.setQueue(["b", "c", "d", "e", "f"].map(yt));
      store.toggleShuffle();
      const shownFirst = ids(store)[0];
      await store.next();
      expect(store.getState().current?.nativeId).toBe(shownFirst);
    }
  });

  it("a queue set while shuffle is already on arrives shuffled, not in list order", async () => {
    const orders = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const store = freshStore();
      await store.play(yt("a"));
      store.toggleShuffle();
      store.setQueue(["b", "c", "d", "e", "f"].map(yt));
      orders.add(ids(store).join(","));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it("turning shuffle back off restores the list's real running order", async () => {
    const store = freshStore();
    await store.play(yt("a"));
    store.setQueue(["b", "c", "d", "e", "f"].map(yt));
    store.toggleShuffle();
    store.toggleShuffle();
    expect(ids(store)).toEqual(["b", "c", "d", "e", "f"]);
  });

  it("shuffle never re-orders songs the listener queued by hand", async () => {
    const store = freshStore();
    await store.play(yt("a"));
    store.setQueue(["c1", "c2", "c3", "c4"].map(yt));
    store.addToQueue(yt("mine1"));
    store.addToQueue(yt("mine2"));
    store.toggleShuffle();
    expect(ids(store).slice(0, 2)).toEqual(["mine1", "mine2"]);
  });
});

// ── E ─────────────────────────────────────────────────────────────────────────────
// WHAT THE LISTENER HEARD: pressing Next twice quickly during a melt played the SAME song
// twice, overlapping itself and out of phase. The second Next fell through to store.next(),
// which restarted the melting-in track on the primary player, while the blend — whose guard
// accepted "current === incoming" as still-ours — kept ramping it and then promoted it too.
describe("a manual skip during a melt never double-plays the incoming track (fix E)", () => {
  function makeBlendPorts() {
    const calls: string[] = [];
    const ports: BlendAdapterPorts = {
      source: "youtube",
      beginBlend: async (t) => {
        calls.push(`beginBlend:${t.nativeId}`);
      },
      setBlendVolumes: () => {},
      completeBlend: () => {
        calls.push("completeBlend");
      },
      cancelBlend: () => {
        calls.push("cancelBlend");
      },
      setVolume: () => {},
    };
    return { ports, calls };
  }

  function manualTimers() {
    let now = 0;
    const handlers = new Map<number, () => void>();
    let nextId = 1;
    const timers: BlendTimers = {
      setInterval: (handler) => {
        const id = nextId++;
        handlers.set(id, handler);
        return id;
      },
      clearInterval: (id) => {
        handlers.delete(id);
      },
      now: () => now,
    };
    return {
      timers,
      advance(ms: number) {
        now += ms;
        for (const h of [...handlers.values()]) h();
      },
    };
  }

  async function melting() {
    const store = freshStore();
    const { ports, calls } = makeBlendPorts();
    const clock = manualTimers();
    const controller = new BlendController({
      store,
      resolveBlendAdapter: (s) => (s === "youtube" ? ports : null),
      getCrossfadeSec: () => 8,
      timers: clock.timers,
      rampMs: 50,
    });
    controller.start();
    await store.play(yt("one"));
    store.setQueue([yt("b"), yt("c")]);
    store.reportPosition(40, 200);
    expect(controller.startManualBlend()).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toContain("beginBlend:b");
    return { store, controller, calls, clock };
  }

  // ADAPTED FROM B: B's version of this fix also rewired nextWithBlend() to a HARD CUT and
  // called a new controller.abandonForManualAdvance() here. main deliberately melts on a
  // manual Next (owner fix 8), so that rewiring was NOT ported and neither was the method.
  // The double-play is still killed, by the guard alone: main's nextWithBlend sees a blend
  // already running, startManualBlend() returns false, and it falls through to store.next()
  // — which is exactly what this test now drives.
  it("cancels the in-flight blend rather than letting it promote on top", async () => {
    const { store, calls, clock } = await melting();

    // The listener presses Next again while "b" is melting in.
    await store.next();

    expect(calls).toContain("cancelBlend");
    expect(store.getState().current?.nativeId).toBe("b");
    // Running the clock past the full crossfade must NOT promote anything — the blend is
    // genuinely dead, not merely ignored.
    clock.advance(20000);
    expect(calls).not.toContain("completeBlend");
    // And "b" was consumed exactly once: it is not still sitting up next.
    expect(ids(store)).toEqual(["c"]);
  });

  it("cancels a blend even when something else plays the very track melting in", async () => {
    const { store, calls, clock } = await melting();

    // A second Next that did NOT go through the manual-skip path (a shortcut, a media key,
    // a queue row tap): the store plays "b" itself. The blend guard used to see "current is
    // my incoming track" and carry on regardless.
    await store.play(yt("b"));

    expect(calls).toContain("cancelBlend");
    clock.advance(20000);
    expect(calls).not.toContain("completeBlend");
  });

  // ADAPTED FROM B: B used this to pin a hard cut all the way up to the Next BUTTON. On main
  // the button (nextWithBlend) deliberately melts — owner fix 8 — so this now pins only what
  // is still true and still worth guarding: store.next() itself changes track immediately and
  // never waits out a crossfade, which is what every other caller (media keys, shortcuts,
  // queue-row taps, end-of-queue radio) depends on.
  it("store.next() changes track immediately — it does not wait out a crossfade", async () => {
    const store = freshStore();
    await store.play(yt("one"));
    store.setQueue([yt("b")]);
    store.reportPosition(40, 200);

    await store.next();
    // The track has already changed, with no ramp to sit through.
    expect(store.getState().current?.nativeId).toBe("b");
  });
});

// ── F ─────────────────────────────────────────────────────────────────────────────
// WHAT THE LISTENER SAW: reload the page, drag the scrub bar to 2:00, press play — and the
// bar jumped straight back to wherever they had left off. seek() no-oped because no engine
// was loaded yet, and play() then applied the stale saved resume position over the top.
describe("scrubbing before pressing play after a reload is honoured (fix F)", () => {
  function seek(spy: ReturnType<typeof vi.fn>) {
    const registry = createAdapterRegistry();
    const adapter = fakeAdapter();
    adapter.seek = spy as unknown as SourceAdapter["seek"];
    registry.register(adapter);
    return new PlayerStore({ registry });
  }

  it("play() resumes from where the listener scrubbed to, not the saved position", async () => {
    const spy = vi.fn();
    const store = seek(spy);
    store.rehydrate({ current: yt("a"), positionSec: 30, durationSec: 200 });
    expect(store.getState().positionSec).toBe(30);

    store.seek(120);
    expect(store.getState().positionSec).toBe(120);

    await store.play();
    // The bar does not jump backwards, and the engine was pointed at the scrubbed spot.
    expect(store.getState().positionSec).toBe(120);
    expect(spy).toHaveBeenCalledWith(120);
    expect(spy).not.toHaveBeenCalledWith(30);
  });

  it("the last scrub before play wins, not the first", async () => {
    const spy = vi.fn();
    const store = seek(spy);
    store.rehydrate({ current: yt("a"), positionSec: 30, durationSec: 200 });
    store.seek(120);
    store.seek(60);
    await store.play();
    expect(store.getState().positionSec).toBe(60);
    expect(spy).toHaveBeenCalledWith(60);
  });

  it("a pre-engine scrub never leaks onto a DIFFERENT track the listener picks instead", async () => {
    const spy = vi.fn();
    const store = seek(spy);
    store.rehydrate({ current: yt("a"), positionSec: 30, durationSec: 200 });
    store.seek(120);

    await store.play(yt("b"));
    // A fresh track starts at the beginning — the offset was tied to track "a".
    expect(store.getState().positionSec).toBe(0);
    expect(spy).not.toHaveBeenCalledWith(120);
  });
});
