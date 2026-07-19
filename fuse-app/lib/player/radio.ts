// Radio continuation provider (Wave 1) — the app's real "similar tracks" seed.
//
// When the queue runs out and the user has consented (the "Autoplay similar when queue
// ends" setting), the player asks for more tracks like the last one. This module is that
// provider: it REUSES the existing search engine (the same /api/search the Search screen
// hits, so it is cache-friendly and needs no new backend) seeded from the finished track's
// artist (or its title when there is no artist), and hands back the playable results.
//
// HONESTY: it never invents tracks. It returns exactly what search returns for the seed
// (minus the seed itself), and an empty list when search finds nothing — the store then
// stops honestly rather than faking an endless stream. Only genuinely playable sources are
// returned (YouTube, and Spotify which plays as its matched YouTube version); anything the
// app cannot actually play is filtered out so radio never queues a dead track.

import type { TrackRef } from "@/lib/repos/track";
import type { SearchResponse } from "@/lib/search/orchestrate";

function sameTrack(a: TrackRef, b: TrackRef): boolean {
  return a.source === b.source && a.nativeId === b.nativeId;
}

// Build the seed query from a track: prefer the artist (radio = more from this vibe), fall
// back to the title. Trimmed; empty when neither is usable (the caller then finds nothing).
export function radioSeedQuery(seed: TrackRef): string {
  const artist = (seed.artist ?? "").trim();
  if (artist) return artist;
  return (seed.title ?? "").trim();
}

// The provider the store calls. `fetchImpl` is injectable so this is unit-testable without a
// network; the app passes the real window.fetch. Returns up to `limit` similar tracks.
export function createRadioProvider(
  fetchImpl: typeof fetch = fetch,
  limit = 12,
): (seed: TrackRef) => Promise<TrackRef[]> {
  return async (seed: TrackRef) => {
    const query = radioSeedQuery(seed);
    if (query === "") return [];
    let res: Response;
    try {
      res = await fetchImpl(`/api/search?q=${encodeURIComponent(query)}`);
    } catch {
      return []; // network failure → stop honestly, no fake continuation
    }
    if (!res.ok) return [];
    let payload: SearchResponse;
    try {
      payload = (await res.json()) as SearchResponse;
    } catch {
      return [];
    }
    const results = Array.isArray(payload.results) ? payload.results : [];
    // Drop the seed itself and any non-playable source (local never appears in search, but
    // guard anyway) so radio only ever queues tracks the player can actually stream.
    return results
      .filter((t) => !sameTrack(t, seed) && (t.source === "youtube" || t.source === "spotify"))
      .slice(0, limit);
  };
}
