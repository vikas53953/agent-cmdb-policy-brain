import { describe, expect, it } from "vitest";
import {
  adaptedCrossfadeSec,
  isLongForm,
  meltClass,
  meltReason,
  SHORT_MELT_MAX_SEC,
  SHORT_MELT_MIN_SEC,
} from "@/lib/player/adaptive-crossfade";
import type { TrackRef } from "@/lib/repos/track";

// F-0 item 4: the slider is the MAX; the engine clamps the melt PER PAIR — long for two
// ambient/long-form uploads, SHORT (2–4s) whenever a typical vocal song is involved so two
// voices never overlap for long. These pin the clamp rules with real, honest inputs.

const song = (title: string, durationSec: number | null = 200): TrackRef => ({
  source: "youtube",
  nativeId: title,
  title,
  artist: "Someone",
  artUrl: null,
  durationSec,
});

describe("isLongForm — duration OR an honest long-form title", () => {
  it("treats a very long upload (>= 20 min) as long-form regardless of title", () => {
    expect(isLongForm(song("Some Song", 25 * 60))).toBe(true);
    expect(isLongForm(song("Some Song", 19 * 60))).toBe(false);
  });

  it("treats streams / mixes / lofi titles as long-form", () => {
    expect(isLongForm(song("lofi hip hop radio - beats to relax", 300))).toBe(true);
    expect(isLongForm(song("Deep House DJ Mix 2026", 300))).toBe(true);
    expect(isLongForm(song("24/7 chillhop stream", 300))).toBe(true);
    expect(isLongForm(song("Ambient study music", 300))).toBe(true);
  });

  it("treats an ordinary vocal song as NOT long-form (and never trips on 'remix')", () => {
    expect(isLongForm(song("Softly", 195))).toBe(false);
    expect(isLongForm(song("Blinding Lights", 200))).toBe(false);
    // "remix" must NOT match the long-form "mix" token (word-boundary safety).
    expect(isLongForm(song("Some Song (Remix)", 210))).toBe(false);
  });

  it("meltClass names the two classes in plain words", () => {
    expect(meltClass(song("lofi radio", 300))).toBe("long-form");
    expect(meltClass(song("Softly", 195))).toBe("song");
  });
});

describe("adaptedCrossfadeSec — the setting is the ceiling, clamped per pair", () => {
  const lofiA = song("lofi hip hop radio", 3600);
  const lofiB = song("chillhop stream 24/7", 3600);
  const vocalA = song("Softly", 195);
  const vocalB = song("Blinding Lights", 200);

  it("allows the FULL configured melt when BOTH tracks are long-form", () => {
    expect(adaptedCrossfadeSec({ maxSec: 12, current: lofiA, next: lofiB })).toBe(12);
    expect(adaptedCrossfadeSec({ maxSec: 6, current: lofiA, next: lofiB })).toBe(6);
  });

  it("clamps to a SHORT melt (2–4s) when two vocal songs meet — avoids vocal-on-vocal mush", () => {
    expect(adaptedCrossfadeSec({ maxSec: 12, current: vocalA, next: vocalB })).toBe(
      SHORT_MELT_MAX_SEC,
    );
    // A small setting stays small (never raised above the ceiling).
    expect(adaptedCrossfadeSec({ maxSec: 3, current: vocalA, next: vocalB })).toBe(3);
  });

  it("clamps SHORT when only ONE side is long-form (a vocal is still involved)", () => {
    expect(adaptedCrossfadeSec({ maxSec: 15, current: lofiA, next: vocalB })).toBe(
      SHORT_MELT_MAX_SEC,
    );
    expect(adaptedCrossfadeSec({ maxSec: 15, current: vocalA, next: lofiB })).toBe(
      SHORT_MELT_MAX_SEC,
    );
  });

  it("never exceeds the ceiling and never drops below the 2s floor", () => {
    expect(adaptedCrossfadeSec({ maxSec: 999, current: lofiA, next: lofiB })).toBe(15); // ceiling
    expect(
      adaptedCrossfadeSec({ maxSec: 1, current: vocalA, next: vocalB }),
    ).toBeGreaterThanOrEqual(SHORT_MELT_MIN_SEC);
  });

  it("gives an honest reason string for each melt length", () => {
    expect(meltReason({ maxSec: 8, current: lofiA, next: lofiB })).toMatch(/long melt/i);
    expect(meltReason({ maxSec: 8, current: vocalA, next: vocalB })).toMatch(/short melt/i);
  });
});
