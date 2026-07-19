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
import { fetchLyricsFromLrclib, parseLyricsQuery, toLyricsPayload, type LyricsPayload } from "@/lib/lyrics";
import { logActivity } from "@/lib/activity-log";

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
  const rawTitle = (url.searchParams.get("title") ?? "").trim();
  const rawArtist = (url.searchParams.get("artist") ?? "").trim() || null;
  const durationRaw = url.searchParams.get("duration");
  const durationSec = durationRaw != null && durationRaw !== "" && Number.isFinite(Number(durationRaw))
    ? Number(durationRaw)
    : null;

  // Parse a clean artist/title out of the noisy YouTube video title before looking up LRCLIB
  // (owner fix 5a) — "Karan Aujla - Boyfriend (Official Video)" becomes artist "Karan Aujla",
  // title "Boyfriend", so the lookup (and the cache key) target the real song.
  const { title, artist } = parseLyricsQuery(rawTitle, rawArtist);

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
      // AUDIT 28: record it (R18) so a run of LRCLIB failures is visible as evidence.
      // Lengths only — never the title or artist text, never any key.
      logActivity({
        level: "error",
        type: "lyrics-api",
        message: "Lyrics lookup couldn't be completed",
        detail: { titleLength: title.length, artistLength: artist ? artist.length : 0 },
      });
      // 503, not 200: a 200 with found:false is how the caller is told "this song has no
      // lyrics", and we do not know that. The status is the difference between the two.
      return NextResponse.json(HONEST_EMPTY, { status: 503 });
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
    // Last-resort honesty: never leak a stack, never freeze the panel (R18) — and, per
    // AUDIT 28, leave a record. Lengths only; no lyric text, no query text, no secret.
    logActivity({
      level: "error",
      type: "lyrics-api",
      message: "Lyrics request failed",
      detail: { titleLength: title.length, artistLength: artist ? artist.length : 0 },
    });
    // Same reasoning as above: we could not find out, so we must not answer as if we did.
    return NextResponse.json(HONEST_EMPTY, { status: 503 });
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
