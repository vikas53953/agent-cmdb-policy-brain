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
import { searchYouTube } from "@/lib/youtube";
import { searchSpotify } from "@/lib/spotify";
import { runSearch, type SearchDeps, type SearchPayload } from "@/lib/search/orchestrate";

// Prisma (Neon) needs the Node runtime, not Edge.
export const runtime = "nodejs";

// The real global fetch, typed to the narrow FetchLike our helpers expect.
const realFetch = ((input: string, init?: RequestInit) =>
  fetch(input, init)) as unknown as Parameters<typeof searchYouTube>[1]["fetch"];

// Cache reads/writes are best-effort: a missing/broken DATABASE_URL must degrade
// to "no cache" (every query hits the sources) rather than 500 the search.
const deps: SearchDeps = {
  readCache: async (query) => {
    try {
      const cached = await readSearchCache(query);
      return (cached as SearchPayload | null) ?? null;
    } catch {
      return null; // treat a cache failure as a miss
    }
  },
  writeCache: async (query, payload) => {
    try {
      await writeSearchCache(query, payload as unknown as Parameters<typeof writeSearchCache>[1]);
    } catch {
      // best-effort — a failed cache write must not fail the request
    }
  },
  searchYouTube: (query) => searchYouTube(query, { fetch: realFetch }),
  searchSpotify: (query) => searchSpotify(query, { fetch: realFetch }),
};

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const response = await runSearch(query, deps);
    return NextResponse.json(response);
  } catch {
    // Last-resort honesty: never leak a stack, never freeze the UI (R18).
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
