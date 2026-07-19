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

export type SourceStatuses = { youtube: SourceStatus; spotify: SourceStatus };

// The full search payload — what the ROUTE returns. `sources` is ALWAYS computed
// fresh (never read from cache), so a reworded availability notice ships the instant
// it deploys and no customer is ever served a stale reason string (the P1 fix).
export type SearchPayload = {
  results: TrackRef[];
  sources: SourceStatuses;
};

export type SearchResponse = SearchPayload & {
  query: string;
  cached: boolean;
};

// What actually goes INTO the cache: results ONLY. Per-source status/reason strings
// are deliberately absent — they describe the live availability of a source at request
// time, not the (query-stable) result rows, so caching them was the P1 bug. Keeping the
// cached shape results-only makes that class of bug impossible: there is no reason
// string in the store to go stale.
export type CachedSearch = {
  results: TrackRef[];
};

// The seams the core needs. Each is injected so tests control it precisely and
// the route binds the real cache + source calls.
export type SearchDeps = {
  // Cached results for this query, or null on a miss / expiry / cache error. Results
  // ONLY — never source statuses (those are recomputed fresh below).
  readCache: (query: string) => Promise<CachedSearch | null>;
  // Persist the results under this query (best-effort; may no-op). Results ONLY.
  writeCache: (query: string, cached: CachedSearch) => Promise<void>;
  searchYouTube: (query: string) => Promise<SourceOutcome>;
  searchSpotify: (query: string) => Promise<SourceOutcome>;
  // Fresh, no-network per-source availability from the CURRENT server config, using the
  // live reason CONSTANTS. Called on every cache HIT so the notice a customer sees is
  // always the current wording — never a string that was frozen into a cache entry.
  freshStatus: () => SourceStatuses;
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
    // HIT: return the cached RESULT ROWS — crucially WITHOUT calling YouTube, so a
    // repeated query spends zero search.list quota (KTD-8). Source statuses are computed
    // FRESH from current config (never read from the cache), so the availability notice
    // is always today's wording and a stale "…try again" string can never resurface (P1).
    return { query, cached: true, results: hit.results, sources: deps.freshStatus() };
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

  const sources: SourceStatuses = { youtube: toStatus(yt), spotify: toStatus(sp) };

  // Only cache when at least one source actually returned — never cache a purely
  // "unconfigured" empty, or a first search after keys are provisioned would keep
  // serving that stale emptiness for the whole TTL. We cache RESULTS ONLY: the source
  // statuses above are the live outcome for THIS miss and are returned now, but they are
  // never written to the store (the P1 class fix — no reason string can ever go stale).
  if (yt.ok || sp.ok) {
    await deps.writeCache(query, { results });
  }

  return { query, cached: false, results, sources };
}
