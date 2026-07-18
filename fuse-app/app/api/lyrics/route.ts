// Lyrics API route (U9, R6/R7, KTD-3, AE2).
//
// Cache-first LRCLIB proxy. On a request it: normalizes the track identity, reads
// the shared LyricsCache (a confirmed MISS is a real cache hit — the honest "no
// lyrics" state is served without re-hitting LRCLIB), and only on a cache miss calls
// LRCLIB. Definitive results (hits AND confirmed misses) are cached; transient
// failures are not, so a temporary outage never poisons the honest empty state.
//
// KEYLESS / DB-LESS SAFE: LRCLIB needs no API key, so lyrics work with no secrets
// set. With no DATABASE_URL the cache read/write degrade to no-ops (every lookup
// hits LRCLIB) rather than 500-ing — the route always answers with an honest payload.

import { NextResponse } from "next/server";
import {
  readLyricsCache,
  writeLyricsCache,
  LYRICS_CACHE_TTL_MS,
  type CachedLyrics,
} from "@/lib/repos/lyrics-cache";
import { fetchLyricsFromLrclib, toLyricsPayload, type LyricsPayload } from "@/lib/lyrics";

// LRCLIB fetch runs server-side (Node runtime), and the cache uses Prisma/Neon.
export const runtime = "nodejs";

// A confirmed miss is cached with a SHORTER TTL than a hit: a song may gain lyrics
// on LRCLIB later, so we re-check misses sooner (a day) than hits (30 days default).
const MISS_TTL_MS = 24 * 60 * 60 * 1000;

const realFetch = ((input: string, init?: RequestInit) =>
  fetch(input, init)) as unknown as Parameters<typeof fetchLyricsFromLrclib>[1]["fetch"];

type LyricsResponse = LyricsPayload & { cached: boolean };

const HONEST_EMPTY: LyricsResponse = { found: false, synced: null, plain: null, cached: false };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const title = (url.searchParams.get("title") ?? "").trim();
  const artist = (url.searchParams.get("artist") ?? "").trim() || null;
  const durationRaw = url.searchParams.get("duration");
  const durationSec = durationRaw != null && durationRaw !== "" && Number.isFinite(Number(durationRaw))
    ? Number(durationRaw)
    : null;

  // Nothing to look up → honest empty state, no external call.
  if (title === "") return NextResponse.json(HONEST_EMPTY);

  try {
    // 1) Cache-first. A cached miss (found:false) is a real hit — return it honestly.
    const cached = await safeReadCache(title, artist, durationSec);
    if (cached) {
      return NextResponse.json({ ...toLyricsPayload(cached), cached: true });
    }

    // 2) Miss → query LRCLIB.
    const outcome = await fetchLyricsFromLrclib({ title, artist, durationSec }, { fetch: realFetch });
    if (!outcome.ok) {
      // Transient failure: do NOT cache. Answer honestly without lyrics this time.
      return NextResponse.json(HONEST_EMPTY);
    }

    // 3) Cache the definitive result (hit or confirmed miss), then return it.
    await safeWriteCache(
      title,
      artist,
      durationSec,
      outcome.data,
      outcome.data.found ? LYRICS_CACHE_TTL_MS : MISS_TTL_MS,
    );
    return NextResponse.json({ ...toLyricsPayload(outcome.data), cached: false });
  } catch {
    // Last-resort honesty: never leak a stack, never freeze the panel (R18).
    return NextResponse.json(HONEST_EMPTY);
  }
}

// Cache reads/writes are best-effort: a missing/broken DATABASE_URL must degrade to
// "no cache" (every lookup hits LRCLIB) rather than failing the request.
async function safeReadCache(title: string, artist: string | null, durationSec: number | null) {
  try {
    return await readLyricsCache(title, artist, durationSec);
  } catch {
    return null;
  }
}

async function safeWriteCache(
  title: string,
  artist: string | null,
  durationSec: number | null,
  data: CachedLyrics,
  ttlMs: number,
) {
  try {
    await writeLyricsCache(title, artist, durationSec, data, undefined, ttlMs);
  } catch {
    // best-effort — a failed cache write must not fail the request
  }
}
