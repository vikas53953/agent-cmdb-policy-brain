import { describe, it, expect, vi } from "vitest";
import { runSearch, type SearchDeps, type SearchPayload } from "./orchestrate";
import type { SourceOutcome } from "@/lib/youtube";
import type { TrackRef } from "@/lib/repos/track";

const yt = (id: string): TrackRef => ({
  source: "youtube",
  nativeId: id,
  title: `YT ${id}`,
  artist: "Chan",
  artUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  durationSec: null,
});
const sp = (id: string): TrackRef => ({
  source: "spotify",
  nativeId: `spotify:track:${id}`,
  title: `SP ${id}`,
  artist: "Artist",
  artUrl: "https://i.scdn.co/image/abc",
  durationSec: 200,
});

// Build deps with spy-able source calls and an in-memory cache.
function makeDeps(over: Partial<SearchDeps> = {}) {
  const store = new Map<string, SearchPayload>();
  const searchYouTube = vi.fn(async (): Promise<SourceOutcome> => ({ ok: true, tracks: [yt("a"), yt("b")] }));
  const searchSpotify = vi.fn(async (): Promise<SourceOutcome> => ({ ok: true, tracks: [sp("1")] }));
  const readCache = vi.fn(async (q: string) => store.get(q.trim().toLowerCase()) ?? null);
  const writeCache = vi.fn(async (q: string, payload: SearchPayload) => {
    store.set(q.trim().toLowerCase(), payload);
  });
  const deps: SearchDeps = { readCache, writeCache, searchYouTube, searchSpotify, ...over };
  return { deps, store, searchYouTube, searchSpotify, readCache, writeCache };
}

describe("runSearch — combined sources (R1/R5)", () => {
  it("interleaves YouTube and Spotify results, each keeping its own source", async () => {
    const { deps } = makeDeps();
    const res = await runSearch("paper cities", deps);

    expect(res.cached).toBe(false);
    const sources = res.results.map((r) => r.source);
    // Interleaved: yt, sp, yt (spotify list is shorter, so the tail is yt only).
    expect(sources).toEqual(["youtube", "spotify", "youtube"]);
    expect(res.sources.youtube).toEqual({ available: true, reason: null });
    expect(res.sources.spotify).toEqual({ available: true, reason: null });
  });
});

describe("runSearch — cache-first quota defence (KTD-8)", () => {
  it("a second identical query is served from cache WITHOUT calling YouTube", async () => {
    const { deps, searchYouTube, searchSpotify } = makeDeps();

    await runSearch("paper cities", deps); // miss → populates cache
    expect(searchYouTube).toHaveBeenCalledTimes(1);

    const second = await runSearch("paper cities", deps); // hit
    expect(second.cached).toBe(true);
    // The whole point of the cache: no extra external search.list spend.
    expect(searchYouTube).toHaveBeenCalledTimes(1);
    expect(searchSpotify).toHaveBeenCalledTimes(1);
    // Same payload as the first call.
    expect(second.results).toHaveLength(3);
  });

  it("does NOT cache when every source is unconfigured (avoids stale-empty)", async () => {
    const { deps, writeCache } = makeDeps({
      searchYouTube: async () => ({ ok: false, reason: "not set up" }),
      searchSpotify: async () => ({ ok: false, reason: "not set up" }),
    });
    const res = await runSearch("nothing works", deps);
    expect(res.results).toEqual([]);
    expect(res.sources.youtube.available).toBe(false);
    expect(writeCache).not.toHaveBeenCalled();
  });

  it("caches when at least one source succeeds even if the other fails", async () => {
    const { deps, writeCache } = makeDeps({
      searchSpotify: async () => ({ ok: false, reason: "Spotify search isn't set up" }),
    });
    const res = await runSearch("half up", deps);
    expect(res.results.every((r) => r.source === "youtube")).toBe(true);
    expect(res.sources.spotify.available).toBe(false);
    expect(writeCache).toHaveBeenCalledTimes(1);
  });
});

describe("runSearch — empty query", () => {
  it("short-circuits with no external calls", async () => {
    const { deps, searchYouTube, searchSpotify, readCache } = makeDeps();
    const res = await runSearch("   ", deps);
    expect(res.results).toEqual([]);
    expect(searchYouTube).not.toHaveBeenCalled();
    expect(searchSpotify).not.toHaveBeenCalled();
    expect(readCache).not.toHaveBeenCalled();
  });
});
