// Search orchestration core (U6, R1/R5, KTD-8).
//
// This is the cache-first logic the /api/search route runs, extracted as a pure
// function over injected dependencies so it is fully unit-testable with no DB and
// no network (the route wires the real cache + source calls; tests wire fakes).
//
// The quota-defence flow (KTD-8): normalize → read the shared SearchCache → on a
// HIT return immediately WITHOUT touching YouTube (the 100-unit search.list call
// is the expensive thing we are protecting) → on a MISS query the sources, then
// cache the combined payload so the next identical query is a hit.

import type { TrackRef } from "@/lib/repos/track";
import type { SourceOutcome } from "@/lib/youtube";

// Why a source contributed nothing, in plain English (null = it worked). Drives
// the honest per-source messaging in the results UI (R17).
export type SourceStatus = { available: boolean; reason: string | null };

// The full search payload — what the route returns and what gets cached (so a
// cache hit reproduces the exact same combined output, statuses included).
export type SearchPayload = {
  results: TrackRef[];
  sources: { youtube: SourceStatus; spotify: SourceStatus };
};

export type SearchResponse = SearchPayload & {
  query: string;
  cached: boolean;
};

// The seams the core needs. Each is injected so tests control it precisely and
// the route binds the real cache + source calls.
export type SearchDeps = {
  // Cached payload for this query, or null on a miss / expiry / cache error.
  readCache: (query: string) => Promise<SearchPayload | null>;
  // Persist the combined payload under this query (best-effort; may no-op).
  writeCache: (query: string, payload: SearchPayload) => Promise<void>;
  searchYouTube: (query: string) => Promise<SourceOutcome>;
  searchSpotify: (query: string) => Promise<SourceOutcome>;
};

function toStatus(outcome: SourceOutcome): SourceStatus {
  return outcome.ok ? { available: true, reason: null } : { available: false, reason: outcome.reason };
}

// Run a search. Empty/whitespace queries short-circuit to an empty payload with
// no external calls. Otherwise: cache-first, then both sources in parallel.
export async function runSearch(rawQuery: string, deps: SearchDeps): Promise<SearchResponse> {
  const query = rawQuery.trim();
  if (query === "") {
    return {
      query,
      cached: false,
      results: [],
      sources: {
        youtube: { available: false, reason: "Type to search" },
        spotify: { available: false, reason: "Type to search" },
      },
    };
  }

  const hit = await deps.readCache(query);
  if (hit) {
    // HIT: return the cached combined payload — crucially WITHOUT calling YouTube,
    // so a repeated query spends zero search.list quota (KTD-8).
    return { query, cached: true, ...hit };
  }

  // MISS: query both sources concurrently. Each independently reports success or
  // an honest reason; one failing never blanks the other.
  const [yt, sp] = await Promise.all([deps.searchYouTube(query), deps.searchSpotify(query)]);

  // Interleave YouTube and Spotify results so both sources are visible near the
  // top rather than one source burying the other.
  const ytTracks = yt.ok ? yt.tracks : [];
  const spTracks = sp.ok ? sp.tracks : [];
  const results: TrackRef[] = [];
  for (let i = 0; i < Math.max(ytTracks.length, spTracks.length); i++) {
    if (ytTracks[i]) results.push(ytTracks[i]);
    if (spTracks[i]) results.push(spTracks[i]);
  }

  const payload: SearchPayload = {
    results,
    sources: { youtube: toStatus(yt), spotify: toStatus(sp) },
  };

  // Only cache when at least one source actually returned — never cache a purely
  // "unconfigured" empty, or a first search after keys are provisioned would keep
  // serving that stale emptiness for the whole TTL.
  if (yt.ok || sp.ok) {
    await deps.writeCache(query, payload);
  }

  return { query, cached: false, ...payload };
}
