import { describe, it, expect, vi } from "vitest";
import { runSearch, type SearchDeps, type CachedSearch, type SourceStatuses } from "./orchestrate";
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

// The fresh config-derived source status the route recomputes on every request. Both
// available by default here; individual tests override to prove the P1 fix.
const FRESH_OK: SourceStatuses = {
  youtube: { available: true, reason: null },
  spotify: { available: true, reason: null },
};

// Build deps with spy-able source calls and an in-memory cache.
function makeDeps(over: Partial<SearchDeps> = {}) {
  const store = new Map<string, CachedSearch>();
  const searchYouTube = vi.fn(async (): Promise<SourceOutcome> => ({ ok: true, tracks: [yt("a"), yt("b")] }));
  const searchSpotify = vi.fn(async (): Promise<SourceOutcome> => ({ ok: true, tracks: [sp("1")] }));
  const readCache = vi.fn(async (q: string) => store.get(q.trim().toLowerCase()) ?? null);
  const writeCache = vi.fn(async (q: string, cached: CachedSearch) => {
    store.set(q.trim().toLowerCase(), cached);
  });
  const freshStatus = vi.fn((): SourceStatuses => FRESH_OK);
  const deps: SearchDeps = { readCache, writeCache, searchYouTube, searchSpotify, freshStatus, ...over };
  return { deps, store, searchYouTube, searchSpotify, readCache, writeCache, freshStatus };
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

describe("runSearch — source status is NEVER cached (P1: no stale 'try again')", () => {
  it("caches RESULTS ONLY — no reason/availability fields are ever written to the store", async () => {
    const { deps, writeCache, store } = makeDeps({
      // Spotify is down at miss-time with a reason string. That string must NOT be cached.
      searchSpotify: async () => ({ ok: false, reason: "Spotify search is unavailable right now — try again" }),
    });
    await runSearch("paper cities", deps);

    // The value handed to writeCache is results-only: no `sources`, no reason strings.
    expect(writeCache).toHaveBeenCalledTimes(1);
    const [, cached] = writeCache.mock.calls[0];
    expect(Object.keys(cached)).toEqual(["results"]);
    expect(JSON.stringify(cached)).not.toContain("try again");
    // And the same holds for what actually landed in the store.
    const stored = store.get("paper cities")!;
    expect(stored).not.toHaveProperty("sources");
    expect(JSON.stringify(stored)).not.toContain("try again");
  });

  it("a cache HIT recomputes source status fresh — a reworded notice is served immediately", async () => {
    // First miss populates the cache while Spotify is unavailable with the OLD wording.
    const { deps, store } = makeDeps({
      searchSpotify: async () => ({ ok: false, reason: "OLD stale wording — try again" }),
    });
    const miss = await runSearch("paper cities", deps);
    expect(miss.sources.spotify.reason).toContain("OLD stale wording"); // live miss uses the live reason
    expect(store.get("paper cities")).toBeDefined();

    // Deploy reworded copy: freshStatus now returns the NEW wording. Because the hit path
    // recomputes status (never reads it from cache), the next identical query shows the new
    // string — the old one can never resurface (the P1 class fix).
    const NEW_WORDING = "Spotify search isn't available here right now — these results are from YouTube";
    const hit = await runSearch("paper cities", {
      ...deps,
      freshStatus: () => ({
        youtube: { available: true, reason: null },
        spotify: { available: false, reason: NEW_WORDING },
      }),
    });
    expect(hit.cached).toBe(true);
    expect(hit.sources.spotify.reason).toBe(NEW_WORDING);
    expect(hit.sources.spotify.reason).not.toContain("try again");
  });

  it("even a legacy-shaped cached entry with a stale `sources` block is ignored on read", async () => {
    const { deps, readCache } = makeDeps();
    // Simulate a pre-fix entry that still carries a frozen reason string. The orchestrator
    // must only ever read `.results` from it and recompute `sources` fresh.
    const legacy = {
      results: [yt("a")],
      sources: { spotify: { available: false, reason: "Spotify search is unavailable right now — try again" } },
    } as unknown as CachedSearch;
    (readCache as unknown as { mockResolvedValueOnce: (v: CachedSearch) => void }).mockResolvedValueOnce(legacy);

    const res = await runSearch("paper cities", deps);
    expect(res.cached).toBe(true);
    expect(res.sources).toEqual(FRESH_OK); // fresh, not the frozen legacy strings
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
