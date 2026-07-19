import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  savePlayerSession,
  loadPlayerSession,
  clearPlayerSession,
  saveSearchQuery,
  loadSearchQuery,
} from "@/lib/session-state";
import type { TrackRef } from "@/lib/repos/track";

// A minimal in-memory sessionStorage so the node unit run can exercise the real persistence
// logic (the module reads window.sessionStorage lazily, so installing this before each call
// is enough). Mirrors the browser API surface the module touches.
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const win = globalThis as unknown as { window?: { sessionStorage: Storage } };

beforeEach(() => {
  win.window = { sessionStorage: fakeStorage() };
});
afterEach(() => {
  delete win.window;
});

const track = (nativeId: string): TrackRef => ({
  source: "youtube",
  nativeId,
  title: `Track ${nativeId}`,
  artist: "Someone",
  artUrl: null,
  durationSec: 200,
});

describe("player session persistence (FIX 2)", () => {
  it("round-trips the current track, queue, position and duration", () => {
    savePlayerSession({
      current: track("abc"),
      queue: [track("b"), track("c")],
      positionSec: 42.5,
      durationSec: 200,
    });
    const loaded = loadPlayerSession();
    expect(loaded?.current.nativeId).toBe("abc");
    expect(loaded?.queue.map((t) => t.nativeId)).toEqual(["b", "c"]);
    expect(loaded?.positionSec).toBe(42.5);
    expect(loaded?.durationSec).toBe(200);
  });

  it("saving null clears the snapshot (nothing to restore)", () => {
    savePlayerSession({ current: track("abc"), queue: [], positionSec: 1, durationSec: 2 });
    expect(loadPlayerSession()).not.toBeNull();
    savePlayerSession(null);
    expect(loadPlayerSession()).toBeNull();
  });

  it("clearPlayerSession removes the snapshot", () => {
    savePlayerSession({ current: track("abc"), queue: [], positionSec: 1, durationSec: 2 });
    clearPlayerSession();
    expect(loadPlayerSession()).toBeNull();
  });

  it("a corrupt entry reads as null instead of throwing", () => {
    win.window!.sessionStorage.setItem("fuse:player:v1", "{not json");
    expect(loadPlayerSession()).toBeNull();
  });

  it("an entry missing a valid track (no source/nativeId) reads as null", () => {
    win.window!.sessionStorage.setItem(
      "fuse:player:v1",
      JSON.stringify({ current: { title: "orphan" }, queue: [], positionSec: 5 }),
    );
    expect(loadPlayerSession()).toBeNull();
  });

  it("is SSR-safe: with no window, save is a no-op and load returns null", () => {
    delete win.window;
    expect(() => savePlayerSession({ current: track("abc"), queue: [], positionSec: 0, durationSec: 0 })).not.toThrow();
    expect(loadPlayerSession()).toBeNull();
  });
});

describe("search query persistence (FIX 2)", () => {
  it("round-trips the query", () => {
    saveSearchQuery("lofi hip hop");
    expect(loadSearchQuery()).toBe("lofi hip hop");
  });

  it("an empty/whitespace query clears the stored value", () => {
    saveSearchQuery("something");
    saveSearchQuery("   ");
    expect(loadSearchQuery()).toBe("");
  });

  it("defaults to an empty string when nothing is stored", () => {
    expect(loadSearchQuery()).toBe("");
  });
});
