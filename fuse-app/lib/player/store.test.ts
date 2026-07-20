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

  it("resume() re-issues play on the SAME loaded adapter — never a reload/restart (P1 DJ)", async () => {
    // The DJ console pauses the main track on entry and resumes it on leave. Resume must
    // continue from where it was, not restart from 0 — so it must NOT call load() again
    // (loadVideoById restarts the video). It re-issues play() on the still-loaded adapter.
    const registry = createAdapterRegistry();
    const { adapter, calls } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "abc"));
    store.pause();
    expect(calls).toEqual(["load", "play", "pause"]);

    const resumed = await store.resume();
    expect(resumed).toBe(true);
    expect(store.getState().isPlaying).toBe(true);
    expect(store.getState().status).toBe("playing");
    // One extra "play", and crucially NO second "load" — the track was not reloaded.
    expect(calls).toEqual(["load", "play", "pause", "play"]);
    expect(calls.filter((c) => c === "load")).toHaveLength(1);
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

describe("user intent — the R1/R3/R4 gate (only the user's commands move intent)", () => {
  it("play sets intent 'play'; pause sets intent 'pause' and clears any engine error", async () => {
    const registry = createAdapterRegistry();
    const { adapter } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "a"));
    expect(store.getState().intent).toBe("play");

    store.reportError({ message: "hiccup", kind: "soft", code: 5 });
    expect(store.currentErrorKind()).toBe("soft");

    store.pause();
    expect(store.getState().intent).toBe("pause");
    // Pausing drops the error flag so recovery can never re-arm the ladder on a paused track.
    expect(store.currentErrorKind()).toBe("none");
  });

  it("next and previous keep intent 'play' (a user-driven advance still wants sound)", async () => {
    const registry = createAdapterRegistry();
    registry.register(makeFakeAdapter("youtube").adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "a"));
    store.setQueue([track("youtube", "b")]);
    await store.next();
    expect(store.getState().intent).toBe("play");
    await store.previous();
    expect(store.getState().intent).toBe("play");
  });

  it("no adapter / unplayable resolution leaves intent 'idle' — never a manufactured play", async () => {
    const store = new PlayerStore({ registry: createAdapterRegistry() }); // no engines
    await store.play(track("spotify", "sp-1"));
    expect(store.getState().intent).toBe("idle");
  });

  it("mirrors the engine state reported by the adapter", () => {
    const store = new PlayerStore({ registry: createAdapterRegistry() });
    store.reportEngineState("buffering");
    expect(store.currentEngineState()).toBe("buffering");
    store.reportEngineState("playing");
    expect(store.currentEngineState()).toBe("playing");
  });
});

describe("rehydrate — restore paused after a reload, then resume from the saved spot (FIX 2)", () => {
  it("restores the track PAUSED at the saved position — never auto-plays", () => {
    const registry = createAdapterRegistry();
    registry.register(makeFakeAdapter("youtube").adapter);
    const store = new PlayerStore({ registry });

    store.rehydrate({
      current: track("youtube", "abc"),
      queue: [track("youtube", "b")],
      positionSec: 42,
      durationSec: 200,
    });

    const s = store.getState();
    expect(s.current?.nativeId).toBe("abc");
    expect(s.queue.map((t) => t.nativeId)).toEqual(["b"]);
    expect(s.positionSec).toBe(42);
    expect(s.durationSec).toBe(200);
    // The no-uninvited-music law: restored means PAUSED, not playing.
    expect(s.isPlaying).toBe(false);
    expect(s.intent).toBe("idle");
    expect(s.status).toBe("idle");
  });

  it("the first play after rehydrate seeks to the saved position, then plays from there", async () => {
    const registry = createAdapterRegistry();
    const { adapter, calls } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    store.rehydrate({ current: track("youtube", "abc"), positionSec: 42, durationSec: 200 });
    // The user taps play (resume with no live adapter falls through to a fresh load).
    const ok = await store.resume();
    expect(ok).toBe(true);
    // Load, THEN seek to the saved spot, THEN play — position continues from 42, not 0:00.
    expect(calls).toEqual(["load", "seek", "play"]);
    expect(store.getState().isPlaying).toBe(true);
  });

  it("the resume offset applies once and never leaks to a later, different track", async () => {
    const registry = createAdapterRegistry();
    const { adapter, calls } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    store.rehydrate({ current: track("youtube", "abc"), positionSec: 42 });
    // A fresh play of a DIFFERENT track must NOT inherit the 42s offset (no seek).
    await store.play(track("youtube", "other"));
    expect(calls).toEqual(["load", "play"]); // no "seek"
    expect(store.getState().current?.nativeId).toBe("other");
  });

  it("does not clobber a live in-memory session", () => {
    const registry = createAdapterRegistry();
    registry.register(makeFakeAdapter("youtube").adapter);
    const store = new PlayerStore({ registry });
    store.rehydrate({ current: track("youtube", "live") });
    // A second rehydrate (e.g. a late-arriving snapshot) is ignored once a track is loaded.
    store.rehydrate({ current: track("youtube", "stale"), positionSec: 99 });
    expect(store.getState().current?.nativeId).toBe("live");
  });
});

describe("visible queue actions — play next / add to queue / remove / reorder (Wave 1)", () => {
  function freshStore() {
    const registry = createAdapterRegistry();
    registry.register(makeFakeAdapter("youtube").adapter);
    return new PlayerStore({ registry });
  }

  it("addToQueue appends, playNext inserts at the front", () => {
    const store = freshStore();
    store.setQueue([track("youtube", "a")]);
    store.addToQueue(track("youtube", "b"));
    store.playNext(track("youtube", "z"));
    expect(store.getState().queue.map((t) => t.nativeId)).toEqual(["z", "a", "b"]);
  });

  it("removeFromQueue drops a row and moveInQueue reorders", () => {
    const store = freshStore();
    store.setQueue([track("youtube", "a"), track("youtube", "b"), track("youtube", "c")]);
    store.removeFromQueue(1);
    expect(store.getState().queue.map((t) => t.nativeId)).toEqual(["a", "c"]);
    store.moveInQueue(0, 1);
    expect(store.getState().queue.map((t) => t.nativeId)).toEqual(["c", "a"]);
  });
});

describe("true previous — history back-stack, restart when >3s in (Wave 1)", () => {
  function freshStore() {
    const registry = createAdapterRegistry();
    registry.register(makeFakeAdapter("youtube").adapter);
    return new PlayerStore({ registry });
  }

  it("Next builds history; Previous (near the start) goes back a song", async () => {
    const store = freshStore();
    await store.play(track("youtube", "a"));
    store.setQueue([track("youtube", "b")]);
    await store.next(); // now on b, a is in history
    expect(store.getState().current?.nativeId).toBe("b");
    expect(store.getState().history.map((t) => t.nativeId)).toEqual(["a"]);

    await store.previous(); // position 0 → go back to a
    expect(store.getState().current?.nativeId).toBe("a");
    // The track we left (b) is at the front of the queue so Next returns to it.
    expect(store.getState().queue[0]?.nativeId).toBe("b");
    expect(store.getState().history).toHaveLength(0);
  });

  it("Previous RESTARTS the current track when more than 3s in (does not pop history)", async () => {
    const store = freshStore();
    await store.play(track("youtube", "a"));
    store.setQueue([track("youtube", "b")]);
    await store.next(); // on b, history [a]
    store.reportPosition(42, 200); // deep into b
    expect(store.canGoBack()).toBe(false); // deep-in → Previous would restart, not go back

    await store.previous(); // restart b, not go back to a
    expect(store.getState().current?.nativeId).toBe("b");
    expect(store.getState().positionSec).toBe(0);
    expect(store.getState().history.map((t) => t.nativeId)).toEqual(["a"]); // untouched
  });

  it("Previous restarts honestly when there is nothing to go back to", async () => {
    const store = freshStore();
    await store.play(track("youtube", "solo"));
    const ok = await store.previous();
    expect(ok).toBe(true);
    expect(store.getState().current?.nativeId).toBe("solo");
  });
});

describe("radio continuation — the one sanctioned, consented auto-play (Wave 1)", () => {
  function radioStore(provider: (seed: TrackRef) => Promise<TrackRef[]>, autoplay = true) {
    const registry = createAdapterRegistry();
    registry.register(makeFakeAdapter("youtube").adapter);
    const store = new PlayerStore({ registry });
    store.setAutoplaySimilar(autoplay);
    store.setRadioProvider(provider);
    return store;
  }

  it("continues with similar tracks when the queue ends and the setting is ON", async () => {
    const store = radioStore(async () => [track("youtube", "sim1"), track("youtube", "sim2")]);
    await store.play(track("youtube", "seed"));
    expect(store.getState().queue).toHaveLength(0);

    const advanced = await store.next(); // queue empty → radio
    expect(advanced).toBe(true);
    expect(store.getState().current?.nativeId).toBe("sim1");
    expect(store.getState().queue.map((t) => t.nativeId)).toEqual(["sim2"]);
    expect(store.getState().radioActive).toBe(true);
  });

  it("does NOT continue when the setting is OFF — stops honestly", async () => {
    const store = radioStore(async () => [track("youtube", "sim1")], false);
    await store.play(track("youtube", "seed"));
    const advanced = await store.next();
    expect(advanced).toBe(false);
    expect(store.getState().radioActive).toBe(false);
    expect(store.getState().current?.nativeId).toBe("seed");
  });

  it("stops honestly when the provider finds nothing similar", async () => {
    const store = radioStore(async () => []);
    await store.play(track("youtube", "seed"));
    expect(await store.next()).toBe(false);
    expect(store.getState().radioActive).toBe(false);
  });

  it("a fresh row tap (setQueue) ends the radio stream", async () => {
    const store = radioStore(async () => [track("youtube", "sim1")]);
    await store.play(track("youtube", "seed"));
    await store.next();
    expect(store.getState().radioActive).toBe(true);
    store.setQueue([track("youtube", "picked")]); // user chose a new context
    expect(store.getState().radioActive).toBe(false);
  });
});

describe("sleep timer — stop at end of track (Wave 1)", () => {
  function freshStore() {
    const registry = createAdapterRegistry();
    registry.register(makeFakeAdapter("youtube").adapter);
    return new PlayerStore({ registry });
  }

  it("a genuine end-of-track advance pauses instead of advancing when armed", async () => {
    const store = freshStore();
    await store.play(track("youtube", "a"));
    store.setQueue([track("youtube", "b")]);
    store.setStopAfterTrack(true);

    const advanced = await store.next("ended"); // engine ended
    expect(advanced).toBe(false);
    expect(store.getState().current?.nativeId).toBe("a"); // did NOT advance to b
    expect(store.getState().isPlaying).toBe(false); // paused honestly
    expect(store.getState().sleepStopAfterTrack).toBe(false); // consumed once
  });

  it("a MANUAL next ignores the end-of-track flag (the user wants the next track)", async () => {
    const store = freshStore();
    await store.play(track("youtube", "a"));
    store.setQueue([track("youtube", "b")]);
    store.setStopAfterTrack(true);

    const advanced = await store.next("user");
    expect(advanced).toBe(true);
    expect(store.getState().current?.nativeId).toBe("b");
    expect(store.getState().sleepStopAfterTrack).toBe(true); // still armed for b's end
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

// ── Owner fix 3: volume + mute are real, applied to the adapter, and persist ─────────
describe("PlayerStore volume + mute (owner fix 3)", () => {
  it("setVolume records the level, applies a reduced level to the active adapter, and unmutes", async () => {
    const registry = createAdapterRegistry();
    const { adapter, calls } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });
    await store.play(track("youtube", "abc"));

    store.setVolume(0.5);
    expect(store.getState().volume).toBe(0.5);
    expect(store.effectiveVolume()).toBe(0.5);
    // A reduced level is pushed to the live adapter immediately (real control, not cosmetic).
    expect(calls).toContain("setVolume");

    // Dragging up off zero is an implicit unmute.
    store.setMuted(true);
    expect(store.effectiveVolume()).toBe(0);
    store.setVolume(0.8);
    expect(store.getState().muted).toBe(false);
    expect(store.effectiveVolume()).toBe(0.8);
  });

  it("toggleMute drives the effective volume to 0 without losing the chosen level", () => {
    const store = new PlayerStore({ registry: createAdapterRegistry() });
    store.setVolume(0.6);
    store.toggleMute();
    expect(store.getState().muted).toBe(true);
    expect(store.effectiveVolume()).toBe(0);
    store.toggleMute();
    expect(store.getState().muted).toBe(false);
    expect(store.effectiveVolume()).toBe(0.6); // restored, never lost
  });

  it("re-applies a reduced volume onto a freshly-loaded track (persists across changes)", async () => {
    const registry = createAdapterRegistry();
    const { adapter, calls } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });
    store.setVolume(0.3);
    calls.length = 0;
    await store.play(track("youtube", "next"));
    // The new player is brought to the user's level, not left at full.
    expect(calls).toContain("setVolume");
  });
});

// ── Owner fix 2: autoplay up-next seeding — "Up next" is never empty ─────────────────
describe("PlayerStore autoplay up-next seeding (owner fix 2)", () => {
  const registryWith = () => {
    const registry = createAdapterRegistry();
    registry.register(makeFakeAdapter("youtube").adapter);
    return registry;
  };

  it("seeds radio-continuation picks into an EMPTY queue and marks them as autoplay", async () => {
    const store = new PlayerStore({ registry: registryWith() });
    store.setRadioProvider(async () => [track("youtube", "b"), track("youtube", "c")]);
    await store.play(track("youtube", "a"));
    expect(store.getState().queue).toHaveLength(0);

    await store.seedAutoplayQueue();
    expect(store.getState().queue.map((t) => t.nativeId)).toEqual(["b", "c"]);
    expect(store.getState().autoplayQueued).toBe(true);
  });

  it("does nothing without consent, and never overwrites a queue the user built", async () => {
    const store = new PlayerStore({ registry: registryWith() });
    store.setRadioProvider(async () => [track("youtube", "b")]);

    // Consent off → no seeding.
    store.setAutoplaySimilar(false);
    await store.play(track("youtube", "a"));
    await store.seedAutoplayQueue();
    expect(store.getState().queue).toHaveLength(0);
    expect(store.getState().autoplayQueued).toBe(false);

    // Consent on but a real queue exists → left untouched.
    store.setAutoplaySimilar(true);
    store.setQueue([track("youtube", "manual")]);
    await store.seedAutoplayQueue();
    expect(store.getState().queue.map((t) => t.nativeId)).toEqual(["manual"]);
    expect(store.getState().autoplayQueued).toBe(false);
  });

  it("a fresh row tap (setQueue) clears the autoplay label", async () => {
    const store = new PlayerStore({ registry: registryWith() });
    store.setRadioProvider(async () => [track("youtube", "b")]);
    await store.play(track("youtube", "a"));
    await store.seedAutoplayQueue();
    expect(store.getState().autoplayQueued).toBe(true);
    store.setQueue([track("youtube", "x")]);
    expect(store.getState().autoplayQueued).toBe(false);
  });
});

// ── Notice lifetime is tied to the track it is ABOUT (the leaking-banner class fix) ──
//
// THE BUG THIS PINS: after skipping away from a track that would not play, the old
// "This track won't play right now" warning was still on screen over a track that WAS
// playing. A message about track A must never survive onto track B — and the fix is
// structural (the store stamps every notice with its track and drops it the moment that
// track is no longer current), not a special case for this one message.
describe("PlayerStore notice lifetime (a message belongs to what it describes)", () => {
  it("drops the 'won't play' warning as soon as a different track becomes current", async () => {
    const registry = createAdapterRegistry();
    const { adapter } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    store.setQueue([track("youtube", "b")]);
    await store.play(track("youtube", "a"));
    store.failStalled();
    expect(store.getState().notice).toMatch(/won't play/i);

    await store.next(); // the user takes the offered Skip
    expect(store.getState().current?.nativeId).toBe("b");
    expect(store.getState().notice).toBeNull(); // the warning stayed with track a
  });

  it("drops a notice across a blend promotion too (no route leaks it)", async () => {
    const registry = createAdapterRegistry();
    const { adapter } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    const b = track("youtube", "b");
    store.setQueue([b]);
    await store.play(track("youtube", "a"));
    store.failStalled();
    expect(store.getState().notice).not.toBeNull();

    store.promoteBlended(b);
    expect(store.getState().notice).toBeNull();
  });

  it("keeps a notice while its own track is still current", async () => {
    const registry = createAdapterRegistry();
    const { adapter } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "a"));
    store.failStalled();
    store.reportPosition(0); // ordinary ticks must not wipe an honest warning
    store.seek(0);
    expect(store.getState().notice).toMatch(/won't play/i);
  });

  it("ignores a health verdict that was reached for a track that is no longer playing", async () => {
    const registry = createAdapterRegistry();
    const { adapter } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    store.setQueue([track("youtube", "b")]);
    await store.play(track("youtube", "a"));
    await store.next();
    expect(store.getState().current?.nativeId).toBe("b");

    // A late tick from the monitor, computed while track a was current, lands now.
    store.setRecovery("error", true, "youtube:a");
    store.failStalled("youtube:a");

    const s = store.getState();
    expect(s.recovery.phase).toBe("ok"); // track b is judged on its own playback
    expect(s.notice).toBeNull();
    expect(s.isPlaying).toBe(true); // and it was not paused by a stale verdict
  });
});

// ── The transport can never claim to pause silence (one reading drives icon + action) ──
describe("PlayerStore toggle honours the one playback reading", () => {
  it("a stuck track's toggle tries to PLAY rather than 'pause' sound that is not there", async () => {
    const registry = createAdapterRegistry();
    const { adapter, calls } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "a"));
    store.setRecovery("error", false);
    calls.length = 0;

    await store.toggle();
    expect(calls).toContain("play");
    expect(calls).not.toContain("pause");
  });

  it("a genuinely playing track still pauses on toggle", async () => {
    const registry = createAdapterRegistry();
    const { adapter, calls } = makeFakeAdapter("youtube");
    registry.register(adapter);
    const store = new PlayerStore({ registry });

    await store.play(track("youtube", "a"));
    calls.length = 0;
    await store.toggle();
    expect(calls).toContain("pause");
    expect(store.getState().isPlaying).toBe(false);
    expect(store.getState().intent).toBe("pause");
  });
});
