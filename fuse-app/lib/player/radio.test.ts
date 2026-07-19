import { describe, expect, it } from "vitest";
import { createRadioProvider, radioSeedQuery } from "@/lib/player/radio";
import type { TrackRef } from "@/lib/repos/track";

const t = (source: TrackRef["source"], id: string, over: Partial<TrackRef> = {}): TrackRef => ({
  source,
  nativeId: id,
  title: `Track ${id}`,
  artist: "Aurora Skies",
  artUrl: null,
  durationSec: 200,
  ...over,
});

function fakeFetch(payload: unknown, ok = true): typeof fetch {
  return (async () =>
    ({ ok, json: async () => payload }) as unknown as Response) as unknown as typeof fetch;
}

describe("radio provider (Wave 1)", () => {
  it("seeds the query from the artist, else the title", () => {
    expect(radioSeedQuery(t("youtube", "a"))).toBe("Aurora Skies");
    expect(radioSeedQuery(t("youtube", "a", { artist: null, title: "Paper Cities" }))).toBe(
      "Paper Cities",
    );
    expect(radioSeedQuery(t("youtube", "a", { artist: "   ", title: "  " }))).toBe("");
  });

  it("returns search results minus the seed, only playable sources", async () => {
    const seed = t("youtube", "seed");
    const provider = createRadioProvider(
      fakeFetch({
        query: "Aurora Skies",
        cached: false,
        results: [
          t("youtube", "seed"), // the seed itself — dropped
          t("youtube", "sim1"),
          t("spotify", "sp1"),
          t("local", "file1"), // not playable from radio — dropped
        ],
        sources: { youtube: { available: true, reason: null }, spotify: { available: true, reason: null } },
      }),
    );
    const out = await provider(seed);
    expect(out.map((x) => `${x.source}:${x.nativeId}`)).toEqual(["youtube:sim1", "spotify:sp1"]);
  });

  it("returns [] when the seed has no usable query", async () => {
    const provider = createRadioProvider(fakeFetch({ results: [] }));
    expect(await provider(t("youtube", "a", { artist: null, title: "" }))).toEqual([]);
  });

  it("returns [] honestly on a failed request", async () => {
    const provider = createRadioProvider(fakeFetch({}, false));
    expect(await provider(t("youtube", "seed"))).toEqual([]);
  });
});
