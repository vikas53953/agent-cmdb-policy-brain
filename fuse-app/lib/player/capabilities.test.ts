import { describe, expect, it } from "vitest";
import {
  REASONS,
  SOURCE_CAPABILITIES,
  YOUTUBE_RATE_RANGE,
  canDo,
  resolveCapabilities,
} from "@/lib/player/capabilities";
import type { CapabilityKey } from "@/lib/player/types";

// The plan's DJ capability matrix, encoded as the expected availability per source
// with the deck otherwise empty. The resolver output must match this exactly.
const MATRIX: Record<CapabilityKey, Record<"local" | "youtube" | "spotify", boolean>> = {
  load: { local: true, youtube: true, spotify: true },
  volume: { local: true, youtube: true, spotify: true },
  rate: { local: true, youtube: true, spotify: false },
  eq: { local: true, youtube: false, spotify: false },
  loops: { local: true, youtube: false, spotify: false },
  fx: { local: true, youtube: false, spotify: false },
  scratch: { local: true, youtube: false, spotify: false },
  secondDeck: { local: true, youtube: true, spotify: false },
};

describe("resolveCapabilities matches the DJ capability matrix exactly", () => {
  for (const source of ["local", "youtube", "spotify"] as const) {
    it(`resolves every capability for ${source}`, () => {
      const matrix = resolveCapabilities({ source, deck: "A" });
      for (const key of Object.keys(MATRIX) as CapabilityKey[]) {
        expect(matrix[key].available).toBe(MATRIX[key][source]);
        // Honesty invariant: available => no reason; unavailable => a real reason.
        if (matrix[key].available) {
          expect(matrix[key].reason).toBeNull();
        } else {
          expect(matrix[key].reason).toBeTruthy();
          expect(matrix[key].reason?.trim().length).toBeGreaterThan(0);
        }
      }
    });
  }
});

describe("AE3 groundwork — YouTube deck greys the full engine, keeps crossfade + speed", () => {
  it("EQ/loops/FX/scratch are off with the YouTube reason; volume + rate stay on", () => {
    const m = resolveCapabilities({ source: "youtube", deck: "A" });
    for (const key of ["eq", "loops", "fx", "scratch"] as const) {
      expect(m[key].available).toBe(false);
      expect(m[key].reason).toBe(REASONS.ytNotAvailable);
    }
    expect(m.volume.available).toBe(true);
    expect(m.rate.available).toBe(true);
  });
});

describe("AE4 groundwork — Spotify one deck at a time", () => {
  it("locks loading Spotify on deck B when deck A already holds Spotify", () => {
    const m = resolveCapabilities({
      source: "spotify",
      deck: "B",
      otherDeckSource: "spotify",
    });
    expect(m.load.available).toBe(false);
    expect(m.load.reason).toBe(REASONS.spOneDeck);
  });

  it("allows loading Spotify on deck B when the other deck is not Spotify", () => {
    const m = resolveCapabilities({
      source: "spotify",
      deck: "B",
      otherDeckSource: "youtube",
    });
    expect(m.load.available).toBe(true);
  });

  it("always locks a second simultaneous Spotify deck", () => {
    const m = resolveCapabilities({ source: "spotify", deck: "A" });
    expect(m.secondDeck.available).toBe(false);
    expect(m.secondDeck.reason).toBe(REASONS.spOneDeck);
  });
});

describe("Spotify has no speed control", () => {
  it("rate is unavailable with a plain reason", () => {
    const m = resolveCapabilities({ source: "spotify", deck: "A" });
    expect(m.rate.available).toBe(false);
    expect(m.rate.reason).toBe(REASONS.spNoSpeed);
  });
});

describe("static source capabilities", () => {
  it("only local routes through the full Web Audio engine", () => {
    expect(SOURCE_CAPABILITIES.local.eq).toBe(true);
    expect(SOURCE_CAPABILITIES.youtube.eq).toBe(false);
    expect(SOURCE_CAPABILITIES.spotify.eq).toBe(false);
  });

  it("YouTube clamps rate to [0.25, 2]", () => {
    expect(SOURCE_CAPABILITIES.youtube.rateRange).toEqual(YOUTUBE_RATE_RANGE);
  });

  it("Spotify is the only single-deck-only source", () => {
    expect(SOURCE_CAPABILITIES.spotify.singleDeckOnly).toBe(true);
    expect(SOURCE_CAPABILITIES.youtube.singleDeckOnly).toBe(false);
    expect(SOURCE_CAPABILITIES.local.singleDeckOnly).toBe(false);
  });
});

describe("canDo narrows to one capability", () => {
  it("answers a single question without destructuring the matrix", () => {
    expect(canDo("scratch", { source: "youtube", deck: "A" }).available).toBe(false);
    expect(canDo("scratch", { source: "local", deck: "A" }).available).toBe(true);
  });
});
