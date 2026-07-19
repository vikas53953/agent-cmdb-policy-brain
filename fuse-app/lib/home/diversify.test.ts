import { describe, expect, it } from "vitest";
import { diversifyHomeRows } from "@/lib/home/diversify";
import { trackKey } from "@/lib/home/recommend";
import type { TrackRef } from "@/lib/repos/track";

// F-0 item 3: the same track must never appear in more than one home row. Recently played
// keeps it; Trending and More-like exclude what is already shown and backfill from their
// pools.

const t = (id: string): TrackRef => ({
  source: "youtube",
  nativeId: id,
  title: `Track ${id}`,
  artist: "Someone",
  artUrl: null,
  durationSec: 200,
});

describe("diversifyHomeRows — no track in more than one row", () => {
  it("keeps a track in Recently played and removes it from Trending / More-like", () => {
    const recentlyPlayed = [t("A"), t("B")];
    const trendingPool = [t("A"), t("C"), t("D")]; // A overlaps Recently played
    const recommendedPool = [t("B"), t("C"), t("E")]; // B & C overlap earlier rows

    const out = diversifyHomeRows({
      recentlyPlayed,
      trendingPool,
      recommendedPool,
      trendingLimit: 2,
      recommendedLimit: 2,
    });

    expect(out.recentlyPlayed.map((x) => x.nativeId)).toEqual(["A", "B"]);
    // Trending drops A (in Recently played), backfills C, D.
    expect(out.trending.map((x) => x.nativeId)).toEqual(["C", "D"]);
    // More-like drops B (recent) and C (trending), backfills E.
    expect(out.recommended.map((x) => x.nativeId)).toEqual(["E"]);
  });

  it("produces three rows whose tracks are globally unique", () => {
    const out = diversifyHomeRows({
      recentlyPlayed: [t("A"), t("B"), t("C")],
      trendingPool: [t("A"), t("C"), t("D"), t("E"), t("F")],
      recommendedPool: [t("B"), t("D"), t("F"), t("G"), t("H")],
      trendingLimit: 3,
      recommendedLimit: 3,
    });
    const allKeys = [...out.recentlyPlayed, ...out.trending, ...out.recommended].map(trackKey);
    expect(new Set(allKeys).size).toBe(allKeys.length); // no duplicates across rows
  });

  it("backfills a row up to its limit from the pool after exclusions", () => {
    const out = diversifyHomeRows({
      recentlyPlayed: [t("A")],
      trendingPool: [t("A"), t("B"), t("C"), t("D")], // A excluded → still 3 available
      recommendedPool: [t("B"), t("E"), t("F"), t("G")],
      trendingLimit: 3,
      recommendedLimit: 3,
    });
    expect(out.trending.map((x) => x.nativeId)).toEqual(["B", "C", "D"]); // filled to 3
    // More-like excludes B (trending), backfills to 3 from the rest.
    expect(out.recommended.map((x) => x.nativeId)).toEqual(["E", "F", "G"]);
  });

  it("respects the Recently-played limit and de-dupes within it via the pool", () => {
    const out = diversifyHomeRows({
      recentlyPlayed: [t("A"), t("B"), t("C")],
      trendingPool: [],
      recommendedPool: [],
      recentLimit: 2,
    });
    expect(out.recentlyPlayed.map((x) => x.nativeId)).toEqual(["A", "B"]);
  });
});
