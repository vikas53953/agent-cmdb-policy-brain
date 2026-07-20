import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_DECK_SESSION,
  EMPTY_DJ_SESSION,
  clearDjSession,
  fileAgainNotice,
  loadDjSession,
  needsFileAgain,
  saveDjSession,
  type DjDeckSession,
  type DjSession,
} from "@/lib/dj/session-state";

// A minimal in-memory sessionStorage so the node unit run exercises the REAL persistence
// logic (the module reads window.sessionStorage lazily, so installing this per test is
// enough). Same harness the player's session-state tests use.
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

const deck = (over: Partial<DjDeckSession> = {}): DjDeckSession => ({
  ...EMPTY_DECK_SESSION,
  ...over,
});

const session = (over: Partial<DjSession> = {}): DjSession => ({
  ...EMPTY_DJ_SESSION,
  ...over,
});

describe("F-6 — the DJ console survives a trip to another tab", () => {
  it("nothing saved yet reads as nothing to restore (a first visit is untouched)", () => {
    expect(loadDjSession()).toBeNull();
  });

  it("round-trips the whole console: both decks, crossfader position and curve", () => {
    const saved = session({
      a: deck({ source: "youtube", youtubeId: "dQw4w9WgXcQ", rate: 1.25 }),
      b: deck({
        source: "local",
        localFileName: "set-opener.wav",
        eq: { low: 6, mid: -3, high: 2 },
        kills: { low: false, mid: true, high: false },
        filterAmt: -0.4,
        trim: 0.8,
        echo: true,
      }),
      position: 0.82,
      curve: "sharp",
    });
    saveDjSession(saved);

    const restored = loadDjSession();
    expect(restored).toEqual(saved);
  });

  it("restores the crossfader position and curve, the two things the console itself owns", () => {
    saveDjSession(session({ position: 0.17, curve: "linear" }));
    const restored = loadDjSession();
    expect(restored?.position).toBeCloseTo(0.17);
    expect(restored?.curve).toBe("linear");
  });

  it("clearing really clears", () => {
    saveDjSession(session({ position: 0.9 }));
    clearDjSession();
    expect(loadDjSession()).toBeNull();
  });
});

describe("F-6 — a corrupt or hostile snapshot degrades honestly, it never throws", () => {
  it("unparseable JSON reads as nothing to restore", () => {
    win.window!.sessionStorage.setItem("fuse:dj:v1", "{not json");
    expect(() => loadDjSession()).not.toThrow();
    expect(loadDjSession()).toBeNull();
  });

  it("a half-written entry restores field by field rather than losing the console", () => {
    win.window!.sessionStorage.setItem(
      "fuse:dj:v1",
      JSON.stringify({ a: { source: "youtube", youtubeId: "abc" }, position: 0.3 }),
    );
    const restored = loadDjSession();
    expect(restored?.a.source).toBe("youtube");
    expect(restored?.a.youtubeId).toBe("abc");
    // Missing knobs fall back to the honest defaults, not undefined.
    expect(restored?.a.rate).toBe(1);
    expect(restored?.a.eq).toEqual({ low: 0, mid: 0, high: 0 });
    expect(restored?.b).toEqual(EMPTY_DECK_SESSION);
    expect(restored?.position).toBeCloseTo(0.3);
  });

  it("rejects a source that is not a real source", () => {
    win.window!.sessionStorage.setItem(
      "fuse:dj:v1",
      JSON.stringify({ a: { source: "soundcloud" } }),
    );
    expect(loadDjSession()?.a.source).toBeNull();
  });

  it("rejects a curve that is not a real curve", () => {
    win.window!.sessionStorage.setItem("fuse:dj:v1", JSON.stringify({ curve: "wobble" }));
    expect(loadDjSession()?.curve).toBe("smooth");
  });

  it("clamps out-of-range numbers instead of handing the engine a nonsense value", () => {
    win.window!.sessionStorage.setItem(
      "fuse:dj:v1",
      JSON.stringify({
        a: { rate: 9999, filterAmt: -50, trim: -3, eq: { low: 900, mid: NaN, high: 2 } },
        position: 42,
      }),
    );
    const a = loadDjSession()!.a;
    expect(a.rate).toBe(2); // the deck's real maximum
    expect(a.filterAmt).toBe(-1);
    expect(a.trim).toBe(0);
    expect(a.eq.low).toBe(30);
    expect(a.eq.mid).toBe(0); // NaN is not a number worth restoring
    expect(loadDjSession()!.position).toBe(1);
  });
});

describe("F-6 — SSR / locked-down browsers", () => {
  it("does nothing and returns null when there is no window at all (SSR)", () => {
    delete win.window;
    expect(() => saveDjSession(session())).not.toThrow();
    expect(loadDjSession()).toBeNull();
    expect(() => clearDjSession()).not.toThrow();
  });

  it("a storage that throws on write never breaks the decks", () => {
    win.window = {
      sessionStorage: {
        ...fakeStorage(),
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      } as Storage,
    };
    expect(() => saveDjSession(session({ position: 0.4 }))).not.toThrow();
  });
});

describe("F-6 — the one thing a snapshot honestly cannot bring back", () => {
  it("a My Files deck that had a file needs it picked again", () => {
    expect(needsFileAgain(deck({ source: "local", localFileName: "mix.wav" }))).toBe(true);
  });

  it("a My Files deck that never had a file does not nag", () => {
    expect(needsFileAgain(deck({ source: "local" }))).toBe(false);
  });

  it("a YouTube deck never asks for a file — its video really is restored", () => {
    expect(needsFileAgain(deck({ source: "youtube", youtubeId: "abc" }))).toBe(false);
  });

  it("the notice names the file, says the settings survived, and gives the reason in plain words", () => {
    const notice = fileAgainNotice("late-night-set.mp3");
    expect(notice).toContain("late-night-set.mp3");
    expect(notice).toContain("stays on your device");
    // No dev jargon: this is copy a non-technical owner reads.
    expect(notice).not.toMatch(/sessionStorage|serialis|buffer|blob|cache/i);
  });

  it("the audio itself is never in the persisted shape — only the file's name", () => {
    const keys = Object.keys(EMPTY_DECK_SESSION);
    expect(keys).toContain("localFileName");
    expect(keys).not.toContain("file");
    expect(keys).not.toContain("bytes");
    expect(keys).not.toContain("buffer");
  });
});
