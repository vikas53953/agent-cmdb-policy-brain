import { describe, expect, it } from "vitest";
import {
  DECK_CAPABILITY_CHIPS,
  DECK_SOURCE_ORDER,
  DJ_ENGINE_READY,
  DJ_SPOTIFY_NOTICE,
  FULL_ENGINE_POINTER,
  capabilityPointer,
  crossfadeGains,
  parseYouTubeId,
  resolveDeckControls,
  resolveDeckControlsFor,
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

describe("engine readiness reflects what is wired in THIS commit", () => {
  it("ships YouTube (U13) and local (U14) decks; Spotify playback (U15) is not ready yet", () => {
    expect(DJ_ENGINE_READY.youtube).toBe(true);
    expect(DJ_ENGINE_READY.local).toBe(true);
    expect(DJ_ENGINE_READY.spotify).toBe(false);
  });
});

describe("deck source picker — My Files goes live in U14", () => {
  it("renders My Files selectable now that its Web Audio engine is wired (R17)", () => {
    const opt = resolveDeckSourceOption("local", { deck: "A" });
    expect(opt.selectable).toBe(true);
    expect(opt.reason).toBeNull();
  });

  it("would honestly disable My Files if its engine were not ready (readiness-driven)", () => {
    const NO_LOCAL: DeckEngineReadiness = { youtube: true, spotify: false, local: false };
    const opt = resolveDeckSourceOption("local", { deck: "A", ready: NO_LOCAL });
    expect(opt.selectable).toBe(false);
    expect(opt.reason).toBe(REASONS.localEngineSoon);
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
    expect(m.load.reason).toBe(DJ_SPOTIFY_NOTICE);
    expect(m.volume.available).toBe(false);
    expect(m.volume.reason).toBe(DJ_SPOTIFY_NOTICE);
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

describe("crossfader curve setting (DJ-1)", () => {
  it("every curve honours the endpoints exactly (full A at 0, full B at 1)", () => {
    for (const curve of ["smooth", "linear", "sharp"] as const) {
      expect(crossfadeGains(0, curve).a).toBeCloseTo(1, 10);
      expect(crossfadeGains(0, curve).b).toBeCloseTo(0, 10);
      expect(crossfadeGains(1, curve).a).toBeCloseTo(0, 10);
      expect(crossfadeGains(1, curve).b).toBeCloseTo(1, 10);
    }
  });

  it("linear is a straight fade", () => {
    expect(crossfadeGains(0.25, "linear")).toEqual({ a: 0.75, b: 0.25 });
    expect(crossfadeGains(0.5, "linear")).toEqual({ a: 0.5, b: 0.5 });
  });

  it("sharp keeps both decks louder through the middle than smooth (a fast cut)", () => {
    // Just off-centre: the sharp curve holds the outgoing deck near full while smooth has
    // already pulled it well down — that is exactly what a cut curve does for scratching.
    const sharp = crossfadeGains(0.3, "sharp");
    const smooth = crossfadeGains(0.3, "smooth");
    expect(sharp.a).toBeGreaterThan(smooth.a);
    expect(sharp.a).toBe(1); // still fully on until past the plateau
  });

  it("defaults to the smooth equal-power curve when none is given", () => {
    expect(crossfadeGains(0.5)).toEqual(crossfadeGains(0.5, "smooth"));
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

// ── F-7: the "nothing is loaded" honesty axis ──────────────────────────────────────
//
// The CUE pads (and the loop buttons, EQ kills and TAP) on an empty My Files deck looked
// like live controls that did nothing. They were correctly disabled, but the reason lived
// only in a `title` tooltip — invisible on a touch screen. These assert that the reason is
// now resolved as DATA, in the same matrix the visible capability chips render from, so
// the deck cannot show a dead-looking control without also showing why.

describe("F-7 — an empty deck says so, in the capability matrix", () => {
  it("greys the full-engine powers on a My Files deck with no file, with a plain reason", () => {
    const controls = resolveDeckControlsFor("local", { deck: "A" }, false);
    for (const key of ["eq", "loops", "fx", "scratch", "rate"] as CapabilityKey[]) {
      expect(controls[key].available, `${key} should be off on an empty deck`).toBe(false);
      expect(controls[key].reason).toBe("Load a file first");
    }
  });

  it("lights them all up once a file IS loaded", () => {
    const controls = resolveDeckControlsFor("local", { deck: "A" }, true);
    for (const key of ["eq", "loops", "fx", "scratch", "rate"] as CapabilityKey[]) {
      expect(controls[key].available, `${key} should be live with a file loaded`).toBe(true);
      expect(controls[key].reason).toBeNull();
    }
  });

  it("never blocks LOADING on an empty deck — that is the one thing you must still do", () => {
    expect(resolveDeckControlsFor("local", { deck: "A" }, false).load.available).toBe(true);
    expect(resolveDeckControlsFor("youtube", { deck: "A" }, false).load.available).toBe(true);
  });

  it("leaves volume alone — the crossfader is a deck property, not a track control", () => {
    expect(resolveDeckControlsFor("local", { deck: "A" }, false).volume.available).toBe(true);
  });

  it("uses the source's own words: a YouTube deck asks for a track, not a file", () => {
    expect(resolveDeckControlsFor("youtube", { deck: "A" }, false).rate.reason).toBe(
      "Load a track first",
    );
  });

  it("the CAPABILITY reason always wins over the empty-deck reason", () => {
    // Loading a video would not give YouTube an EQ, so saying "Load a track first" there
    // would be a lie about what loading one would get you.
    const empty = resolveDeckControlsFor("youtube", { deck: "A" }, false);
    expect(empty.eq.available).toBe(false);
    expect(empty.eq.reason).toBe(REASONS.ytNotAvailable);
    const loaded = resolveDeckControlsFor("youtube", { deck: "A" }, true);
    expect(loaded.eq.reason).toBe(REASONS.ytNotAvailable);
  });

  it("every gated state stays honest: off ⇒ a real reason, on ⇒ none", () => {
    for (const source of DECK_SOURCE_ORDER) {
      for (const loaded of [true, false]) {
        const controls = resolveDeckControlsFor(source, { deck: "A" }, loaded);
        for (const key of Object.keys(controls) as CapabilityKey[]) {
          assertHonest(controls[key]);
        }
      }
    }
  });
});

describe("F-7 — the full-engine pointer only appears where it is true", () => {
  it("still points a YouTube deck at My Files (Complaint 3 must not regress)", () => {
    expect(capabilityPointer("youtube", { deck: "A" })).toBe(FULL_ENGINE_POINTER);
  });

  it("still points a Spotify deck at My Files", () => {
    expect(capabilityPointer("spotify", { deck: "A" })).toBe(FULL_ENGINE_POINTER);
  });

  it("says nothing on a My Files deck — it would be telling the DJ to use what they are on", () => {
    expect(capabilityPointer("local", { deck: "A" })).toBeNull();
  });
});
