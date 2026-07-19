// Search API route (U6, R1/R5, KTD-8).
//
// Thin wrapper that binds the REAL dependencies (Postgres SearchCache + the
// YouTube/Spotify source calls) to the pure `runSearch` core in
// lib/search/orchestrate.ts. All the interesting logic and all the tests live
// there; this file's job is wiring + graceful degradation.
//
// QUOTA REALITY (KTD-8): the live-verified finding is recorded inline at the top
// of lib/youtube.ts. In short — search.list costs 100 units (~100 searches/day on
// the default budget), so this route is cache-first: it never calls YouTube on a
// cache hit. See that file for the full note.
//
// KEYLESS / DB-LESS SAFE: with no YOUTUBE_API_KEY / Spotify creds / DATABASE_URL,
// this route still responds 200 with an honest empty payload and per-source
// reasons — it never crashes the Search screen (R17, R18).

import { NextResponse } from "next/server";
import { readSearchCache, writeSearchCache } from "@/lib/repos/search-cache";
import { searchYouTube, hasYouTubeApiKey, YT_NOT_CONFIGURED } from "@/lib/youtube";
import { searchSpotify, hasSpotifyAppCredentials, SP_NOT_CONFIGURED } from "@/lib/spotify";
import { runSearch, type SearchDeps, type CachedSearch, type SourceStatuses } from "@/lib/search/orchestrate";
import { getUser } from "@/lib/auth-session";
import { getPreferAudio } from "@/lib/repos/settings";
import type { TrackRef } from "@/lib/repos/track";
import { logActivity } from "@/lib/activity-log";

// Prisma (Neon) needs the Node runtime, not Edge.
export const runtime = "nodejs";

// The real global fetch, typed to the narrow FetchLike our helpers expect.
const realFetch = ((input: string, init?: RequestInit) =>
  fetch(input, init)) as unknown as Parameters<typeof searchYouTube>[1]["fetch"];

// Fresh, no-network per-source availability from the CURRENT server config, using the
// live reason CONSTANTS. This is what makes the P1 fix real: on a cache hit the notice is
// re-derived here, so rewording SP_NOT_CONFIGURED / YT_NOT_CONFIGURED ships instantly and
// no stale string can ever be served from a cache entry.
function freshStatus(): SourceStatuses {
  return {
    youtube: hasYouTubeApiKey()
      ? { available: true, reason: null }
      : { available: false, reason: YT_NOT_CONFIGURED },
    spotify: hasSpotifyAppCredentials()
      ? { available: true, reason: null }
      : { available: false, reason: SP_NOT_CONFIGURED },
  };
}

// Cache reads/writes are best-effort: a missing/broken DATABASE_URL must degrade
// to "no cache" (every query hits the sources) rather than 500 the search.
const deps: SearchDeps = {
  readCache: async (query) => {
    try {
      const cached = await readSearchCache(query);
      // Results ONLY — defensively ignore anything else a legacy entry may carry (e.g.
      // a v1 `sources` block), so a stale reason string can never be read back even if
      // the version prefix somehow lets an old entry through.
      if (!cached || typeof cached !== "object") return null;
      const results = (cached as { results?: unknown }).results;
      return Array.isArray(results) ? { results: results as TrackRef[] } : null;
    } catch {
      return null; // treat a cache failure as a miss
    }
  },
  writeCache: async (query, cached: CachedSearch) => {
    try {
      await writeSearchCache(query, cached as unknown as Parameters<typeof writeSearchCache>[1]);
    } catch {
      // best-effort — a failed cache write must not fail the request
    }
  },
  searchYouTube: (query) => searchYouTube(query, { fetch: realFetch }),
  searchSpotify: (query) => searchSpotify(query, { fetch: realFetch }),
  freshStatus,
};

// Read the caller's "prefer audio versions" setting (Complaint 1). Guarded like every
// other read in this route: a signed-out / keyless / no-DATABASE_URL environment degrades
// to the ON default (music-first) rather than throwing — search must never 500 over a
// preference lookup. Never logs or exposes any secret.
async function resolvePreferAudio(): Promise<boolean> {
  try {
    const user = await getUser();
    if (!user) return true;
    return await getPreferAudio(user.id);
  } catch {
    return true;
  }
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const preferAudio = await resolvePreferAudio();
    const response = await runSearch(query, deps, { preferAudio });
    return NextResponse.json(response);
  } catch {
    // Last-resort honesty: never leak a stack, never freeze the UI (R18).
    // AUDIT 28: also RECORD it, so a search outage is diagnosable from evidence instead
    // of guessed at. The query's LENGTH only — never the text the user typed, and never
    // any key.
    logActivity({
      level: "error",
      type: "search-api",
      message: "Search couldn't be completed",
      detail: { queryLength: query.trim().length },
    });
    return NextResponse.json({
      query: query.trim(),
      cached: false,
      results: [],
      sources: {
        youtube: { available: false, reason: "Search hit a snag — try again" },
        spotify: { available: false, reason: "Search hit a snag — try again" },
      },
    });
  }
}
