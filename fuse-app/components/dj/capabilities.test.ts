import { describe, expect, it } from "vitest";
import {
  DECK_CAPABILITY_CHIPS,
  DECK_SOURCE_ORDER,
  DJ_ENGINE_READY,
  crossfadeGains,
  parseYouTubeId,
  resolveDeckControls,
  resolveDeckSourceOption,
  resolveDeckSourceOptions,
  type DeckEngineReadiness,
} from "@/components/dj/deck-model";
import { REASONS } from "@/lib/player/capabilities";
import type { CapabilityKey } from "@/lib/player/types";

// Readiness that mirrors a fully-shipped app (all engines wired) — used to prove the
// gating is driven by readiness data, not hard-coded to today's state.
const ALL_READY: DeckEngineReadiness = { youtube: true, spotify: true, local: true };

// Honesty invariant asserted everywhere: enabled ⇒ no reason; disabled ⇒ a real reason.
function assertHonest(state: { available: boolean; reason: string | null }) {
  if (state.available) {
    expect(state.reason).toBeNull();
  } else {
    expect(state.reason).toBeTruthy();
    expect(state.reason?.trim().length).toBeGreaterThan(0);
  }
}

describe("U13 engine readiness reflects what is wired in THIS commit", () => {
  it("ships YouTube decks; local (U14) and Spotify playback (U15) are not ready yet", () => {
    expect(DJ_ENGINE_READY.youtube).toBe(true);
    expect(DJ_ENGINE_READY.local).toBe(false);
    expect(DJ_ENGINE_READY.spotify).toBe(false);
  });
});

describe("deck source picker — My Files honestly disabled until U14", () => {
  it("renders My Files not selectable with the local-engine reason (R17)", () => {
    const opt = resolveDeckSourceOption("local", { deck: "A" });
    expect(opt.selectable).toBe(false);
    expect(opt.reason).toBe(REASONS.localEngineSoon);
  });

  it("flips My Files selectable once its engine is ready (U14 forward-check)", () => {
    const opt = resolveDeckSourceOption("local", { deck: "A", ready: ALL_READY });
    expect(opt.selectable).toBe(true);
    expect(opt.reason).toBeNull();
  });

  it("always offers YouTube as a selectable source (its engine ships in U13)", () => {
    const opt = resolveDeckSourceOption("youtube", { deck: "A" });
    expect(opt.selectable).toBe(true);
    expect(opt.reason).toBeNull();
  });
});

describe("AE4 — Spotify one deck at a time", () => {
  it("Spotify is selectable on an empty deck (so it can occupy a deck for the lock)", () => {
    const opt = resolveDeckSourceOption("spotify", { deck: "A", otherDeckSource: null });
    expect(opt.selectable).toBe(true);
  });

  it("locks Deck B's Spotify option while Deck A already holds Spotify", () => {
    const opt = resolveDeckSourceOption("spotify", {
      deck: "B",
      otherDeckSource: "spotify",
    });
    expect(opt.selectable).toBe(false);
    expect(opt.reason).toBe(REASONS.spOneDeck);
  });

  it("leaves Deck B's Spotify option open when the other deck is YouTube", () => {
    const opt = resolveDeckSourceOption("spotify", {
      deck: "B",
      otherDeckSource: "youtube",
    });
    expect(opt.selectable).toBe(true);
  });

  it("resolveDeckSourceOptions returns all three sources in display order", () => {
    const opts = resolveDeckSourceOptions({ deck: "A" });
    expect(opts.map((o) => o.source)).toEqual(DECK_SOURCE_ORDER);
  });
});

describe("AE3 — a YouTube deck greys the full engine, keeps speed live", () => {
  it("EQ/loops/FX/scratch are off with the YouTube reason; rate + volume stay on", () => {
    const m = resolveDeckControls("youtube", { deck: "A" });
    for (const key of ["eq", "loops", "fx", "scratch"] as const) {
      expect(m[key].available).toBe(false);
      expect(m[key].reason).toBe(REASONS.ytNotAvailable);
    }
    expect(m.rate.available).toBe(true);
    expect(m.volume.available).toBe(true);
    for (const key of Object.keys(m) as CapabilityKey[]) assertHonest(m[key]);
  });
});

describe("a Spotify deck is fully honest — no control works until U15", () => {
  it("disables every control; load/volume cite the Spotify-playback reason", () => {
    const m = resolveDeckControls("spotify", { deck: "A" });
    // Matrix would allow load + volume, but the engine is not wired → engine reason.
    expect(m.load.available).toBe(false);
    expect(m.load.reason).toBe(REASONS.spPlaybackSoon);
    expect(m.volume.available).toBe(false);
    expect(m.volume.reason).toBe(REASONS.spPlaybackSoon);
    // Matrix-disallowed controls keep their more specific reason.
    expect(m.rate.reason).toBe(REASONS.spNoSpeed);
    expect(m.eq.reason).toBe(REASONS.spNotAvailable);
    for (const key of Object.keys(m) as CapabilityKey[]) assertHonest(m[key]);
  });

  it("a ready Spotify engine (U15 forward-check) restores load + volume", () => {
    const m = resolveDeckControls("spotify", { deck: "A", ready: ALL_READY });
    expect(m.load.available).toBe(true);
    expect(m.volume.available).toBe(true);
    // Speed is still off — Spotify genuinely has no speed control (matrix, not engine).
    expect(m.rate.available).toBe(false);
    expect(m.rate.reason).toBe(REASONS.spNoSpeed);
  });
});

describe("a ready local deck lights the full engine (U14 forward-check)", () => {
  it("every capability is available with no reason", () => {
    const m = resolveDeckControls("local", { deck: "A", ready: ALL_READY });
    for (const { key } of DECK_CAPABILITY_CHIPS) {
      expect(m[key].available).toBe(true);
      expect(m[key].reason).toBeNull();
    }
    expect(m.rate.available).toBe(true);
  });
});

describe("equal-power crossfade curve", () => {
  it("is full-A at 0, full-B at 1, and equal at the midpoint", () => {
    expect(crossfadeGains(0)).toEqual({ a: 1, b: expect.closeTo(0, 10) });
    expect(crossfadeGains(1)).toEqual({ a: expect.closeTo(0, 10), b: 1 });
    const mid = crossfadeGains(0.5);
    expect(mid.a).toBeCloseTo(Math.SQRT1_2, 10);
    expect(mid.b).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("clamps out-of-range positions instead of producing junk gains", () => {
    expect(crossfadeGains(-1)).toEqual({ a: 1, b: expect.closeTo(0, 10) });
    expect(crossfadeGains(2)).toEqual({ a: expect.closeTo(0, 10), b: 1 });
  });
});

describe("parseYouTubeId accepts real ids and URLs, rejects junk", () => {
  it("takes a bare 11-char id", () => {
    expect(parseYouTubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts the id from common URL shapes", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("returns null for empty or non-YouTube input", () => {
    expect(parseYouTubeId("")).toBeNull();
    expect(parseYouTubeId("   ")).toBeNull();
    expect(parseYouTubeId("not a link")).toBeNull();
  });
});
