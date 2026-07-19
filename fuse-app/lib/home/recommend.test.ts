import { describe, it, expect } from "vitest";
import type { TrackRef } from "@/lib/repos/track";
import {
  recommend,
  chooseTrending,
  dedupeTracks,
  trackKey,
  trendingRowLabel,
  isRealTrending,
  TRENDING_GRADUATE_MIN,
} from "./recommend";

function t(nativeId: string, artist: string | null, source: TrackRef["source"] = "youtube"): TrackRef {
  return { source, nativeId, title: nativeId, artist, artUrl: null, durationSec: null };
}

describe("home recommend — starts generic (R11)", () => {
  it("with no likes or plays, returns the pool in its given order (a sensible non-empty set)", () => {
    const pool = [t("a", "Alpha"), t("b", "Beta"), t("c", "Gamma")];
    const out = recommend({ likes: [], recent: [], pool });
    expect(out.map((x) => x.nativeId)).toEqual(["a", "b", "c"]);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("home recommend — gets personal (R11)", () => {
  it("liking several tracks by one artist pulls that artist's other pool tracks to the top", () => {
    // Pool has one Aurora track sitting last; the rest are unrelated.
    const pool = [t("x1", "Nova"), t("x2", "Orbit"), t("x3", "Pulse"), t("aur2", "Aurora")];
    // The user has liked two Aurora tracks (not the same ids as the pool candidate).
    const likes = [t("aurA", "Aurora"), t("aurB", "Aurora")];
    const out = recommend({ likes, recent: [], pool });
    // The Aurora pool track is now ranked first — the row visibly shifted toward it.
    expect(out[0].nativeId).toBe("aur2");
  });

  it("recent plays are a weaker signal than likes but still shift ranking", () => {
    const pool = [t("n", "Nova"), t("o", "Orbit"), t("aur2", "Aurora")];
    const out = recommend({ likes: [], recent: [t("aurA", "Aurora")], pool });
    expect(out[0].nativeId).toBe("aur2");
  });
});

describe("home trending graduation (KTD-4)", () => {
  it("shows the curated seed until aggregate counts reach the threshold", () => {
    const seed = [t("s1", "S1"), t("s2", "S2")];
    const counts = Array.from({ length: TRENDING_GRADUATE_MIN - 1 }, (_, i) => t(`c${i}`, `C${i}`));
    expect(chooseTrending(seed, counts).map((x) => x.nativeId)).toEqual(["s1", "s2"]);
  });

  it("graduates to aggregate counts once enough distinct tracks have plays", () => {
    const seed = [t("s1", "S1")];
    const counts = Array.from({ length: TRENDING_GRADUATE_MIN }, (_, i) => t(`c${i}`, `C${i}`));
    const out = chooseTrending(seed, counts);
    expect(out.map((x) => x.nativeId)).toEqual(counts.map((x) => x.nativeId));
  });
});

// Audit 8: the seeded row must NOT call itself "Trending". It is a hand-picked
// starter list, and only real aggregated play data earns the trending name.
describe("home trending row label is honest (audit 8, R17)", () => {
  const seed = [t("s1", "S1"), t("s2", "S2")];

  it("calls the row Starter picks while it is still showing the seed", () => {
    const counts = Array.from({ length: TRENDING_GRADUATE_MIN - 1 }, (_, i) => t(`c${i}`, `C${i}`));
    expect(isRealTrending(counts)).toBe(false);

    const label = trendingRowLabel(isRealTrending(counts));
    expect(label.title).toBe("Starter picks");
    expect(label.title).not.toMatch(/trending/i);
    // And the shown tracks really are the seed, so label and contents agree.
    expect(chooseTrending(seed, counts).map((x) => x.nativeId)).toEqual(["s1", "s2"]);
  });

  it("calls the row Trending only once real play counts back it", () => {
    const counts = Array.from({ length: TRENDING_GRADUATE_MIN }, (_, i) => t(`c${i}`, `C${i}`));
    expect(isRealTrending(counts)).toBe(true);

    const label = trendingRowLabel(isRealTrending(counts));
    expect(label.title).toBe("Trending");
    expect(chooseTrending(seed, counts).map((x) => x.nativeId)).toEqual(counts.map((x) => x.nativeId));
  });

  it("defaults to the modest label when we do not know (never claims Trending)", () => {
    expect(trendingRowLabel(false).title).toBe("Starter picks");
  });
});

// Audit 36: the row must use a second, real signal — not just "more by artists you
// already played".
describe("home recommend — co-play is a real second signal (audit 36)", () => {
  it("surfaces a NEW artist that people listen to alongside what the user loves", () => {
    // The user loves Aurora. Nothing in the pool is by Aurora, so artist affinity
    // alone would leave the pool in its given order.
    const likes = [t("aurA", "Aurora")];
    const pool = [t("n", "Nova"), t("o", "Orbit"), t("p", "Pulse")];

    const withoutCoPlay = recommend({ likes, recent: [], pool });
    expect(withoutCoPlay[0].nativeId).toBe("n");

    // But other people keep playing Pulse in the same sitting as Aurora.
    const coPlay = new Map([[trackKey(t("p", "Pulse")), 3]]);
    const withCoPlay = recommend({ likes, recent: [], pool, coPlay });
    expect(withCoPlay[0].nativeId).toBe("p");
  });

  it("does not let co-play outvote a strongly loved artist", () => {
    // Two likes by Aurora = artist score 2 x 10 = 20. Co-play of 3 = 12. Artist wins.
    const likes = [t("aurA", "Aurora"), t("aurB", "Aurora")];
    const pool = [t("n", "Nova"), t("aur2", "Aurora")];
    const coPlay = new Map([[trackKey(t("n", "Nova")), 3]]);
    expect(recommend({ likes, recent: [], pool, coPlay })[0].nativeId).toBe("aur2");
  });

  it("changes nothing when there is no co-play data", () => {
    const pool = [t("a", "A"), t("b", "B")];
    const out = recommend({ likes: [], recent: [], pool, coPlay: new Map() });
    expect(out.map((x) => x.nativeId)).toEqual(["a", "b"]);
  });
});

describe("home dedupeTracks", () => {
  it("keeps the first occurrence and original order across lists", () => {
    const a = [t("1", "A"), t("2", "B")];
    const b = [t("2", "B"), t("3", "C")];
    const out = dedupeTracks([a, b]);
    expect(out.map((x) => x.nativeId)).toEqual(["1", "2", "3"]);
  });

  it("treats the same nativeId from different sources as distinct", () => {
    const out = dedupeTracks([[t("x", "A", "youtube"), t("x", "A", "spotify")]]);
    expect(out.map(trackKey)).toEqual(["youtube:x", "spotify:x"]);
  });
});
