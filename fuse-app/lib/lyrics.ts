// LRCLIB lyrics client (U9, R6/R7, KTD-3) — pure over an injected `fetch`.
//
// Turns a track (title + artist + optional duration) into either timed synced
// lyrics, plain lyrics, or an honest "no lyrics" result. Everything here is pure
// over an injected fetch (the same FetchLike the YouTube helpers use), so the API
// route wires the real global fetch and unit tests pass a fake — no network in CI.
//
// ── KTD-3 LRCLIB PARAMS (verified live 2026-07-18) ─────────────────────────────
// The plan flagged LRCLIB's exact parameter names UNVERIFIED. Verified live against
// https://lrclib.net from this environment:
//   • GET /api/get?artist_name=&track_name=&album_name=&duration=  (album_name and
//     duration optional). 200 → a record; 404 → not found. Duration is matched with
//     a small tolerance server-side; a mismatch 404s.
//   • GET /api/search?track_name=&artist_name=  → an ARRAY of candidate records
//     (used as a fallback when the exact /api/get 404s or no duration is known).
//   • Each record's fields (verified): `syncedLyrics` (LRC "[mm:ss.xx] text"),
//     `plainLyrics`, `instrumental` (boolean), `trackName`, `artistName`,
//     `duration`. An instrumental track carries no lyrics → honest "no lyrics".
// LRCLIB is FREE and KEYLESS — no env var is required, so this path works with no
// secrets set. We send a descriptive User-Agent as the service requests, and the
// route caches every result (hits AND confirmed misses) in Postgres so repeat plays
// never re-hit LRCLIB (lib/repos/lyrics-cache.ts).

import type { FetchLike } from "@/lib/youtube";
import type { CachedLyrics } from "@/lib/repos/lyrics-cache";

export const LRCLIB_BASE = "https://lrclib.net";

// A descriptive, non-identifying User-Agent (LRCLIB asks callers to identify their
// app). No secret, no personal data — just the app name and purpose.
export const LRCLIB_USER_AGENT = "Fuse/1.0 (music blend web app)";

// One time-stamped lyric line, parsed from LRC. `timeSec` is when the line begins.
export type LrcLine = { timeSec: number; text: string };

// The API payload the route returns and the lyrics panel consumes. `synced` is the
// parsed timed lines (null when there are none to sync against); `plain` is the
// unsynced fallback text. `found: false` is the honest "No lyrics" state (R7/AE2).
export type LyricsPayload = {
  found: boolean;
  synced: LrcLine[] | null;
  plain: string | null;
};

// The outcome of a live LRCLIB lookup. `ok: true` means we got a DEFINITIVE answer
// (a hit OR a confirmed 404 miss) that is safe to CACHE. `ok: false` means a
// TRANSIENT failure (network / 5xx) that must NOT be cached as a miss — the honest
// empty state must never be poisoned by a temporary outage.
export type LyricsFetchOutcome =
  | { ok: true; data: CachedLyrics }
  | { ok: false; reason: string };

// The shape of a single LRCLIB record (only the fields we read). trackName/artistName are
// read so a search-fallback candidate can be VERIFIED to actually be the requested song
// before its lyrics are trusted (owner fix 5a — never show confident-looking wrong lyrics).
type LrclibRecord = {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean | null;
  duration?: number | null;
  trackName?: string | null;
  artistName?: string | null;
};

// How close a candidate's duration must be to the track's for the match to be trusted, when
// a duration is known. LRCLIB's own /api/get uses a small server-side tolerance; we apply the
// same spirit to the broader /api/search fallback so a same-title different-song record with
// a very different length is rejected rather than shown (owner fix 5a).
const DURATION_TOLERANCE_SEC = 8;

// Normalize a string for fuzzy identity matching: lower-case, strip accents and punctuation,
// collapse whitespace. Used to compare a candidate record's title/artist to the query.
export function normalizeForMatch(value: string): string {
  // NFKD splits accented letters into base + combining mark; the [^a-z0-9] strip below then
  // drops the marks, so accents are normalized away without a dedicated (lint-flagged)
  // combining-mark character class.
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeForMatch(value).split(" ").filter(Boolean));
}

// Share of the query's tokens that appear in the candidate — a cheap, dependency-free
// confidence score in [0, 1]. 1 means every query word is present in the candidate.
function tokenOverlap(query: string, candidate: string): number {
  const q = tokenSet(query);
  if (q.size === 0) return 0;
  const c = tokenSet(candidate);
  let hit = 0;
  for (const t of q) if (c.has(t)) hit++;
  return hit / q.size;
}

// Parse a clean {artist, title} from a YouTube video title + channel name (owner fix 5a).
// YouTube titles carry a lot of noise ("Karan Aujla - Boyfriend (Official Video) | ...") that
// wrecks a lyrics lookup; a "<Artist> - Topic" channel is YouTube's own clean artist name.
// This trims the marketing junk and splits "Artist - Title" so the LRCLIB query is precise.
export function parseLyricsQuery(
  rawTitle: string,
  rawArtist: string | null,
): { title: string; artist: string | null } {
  // A "<Artist> - Topic" channel is YouTube's own clean artist name and the most reliable
  // signal, so it is trusted outright. An ordinary channel is often a LABEL / Vevo, not the
  // artist, so it is only a last resort — the artist named in the title wins over it.
  const trimmedChannel = (rawArtist ?? "").trim();
  const isTopic = /\s-\s*topic$/i.test(trimmedChannel);
  const channelArtist = trimmedChannel.replace(/\s-\s*topic$/i, "").trim() || null;
  let artist: string | null = isTopic ? channelArtist : null;

  let title = rawTitle
    // Drop anything after a pipe (feature lists, label tags) and bracketed junk.
    .replace(/\|.*$/g, " ")
    .replace(/[([][^)\]]*[)\]]/g, " ")
    // Common video-title noise words.
    .replace(
      /\b(official\s+(music\s+)?video|official\s+audio|lyric(al)?\s+video|full\s+(video|song|audio)|audio|video|visuali[sz]er|hd|4k|mv)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  // "Artist - Title": split the artist named in the title from the song name.
  let titleArtist: string | null = null;
  const dash = title.split(/\s[-–—]\s/);
  if (dash.length >= 2) {
    const left = dash[0].trim();
    const right = dash.slice(1).join(" - ").trim();
    if (left) titleArtist = left;
    if (right) title = right;
  }

  // Precedence: a Topic-channel artist (already set), else the artist from the title, else
  // the raw channel name (a label as a last resort).
  if (!artist) artist = titleArtist ?? channelArtist;

  // Drop a trailing "feat./ft. ..." clause from the title — it is not part of the song name.
  title = title.replace(/\b(feat|ft)\.?\s+.*$/i, "").replace(/\s+/g, " ").trim();

  return { title: title || rawTitle.trim(), artist };
}

// Parse LRC synced lyrics into sorted, timed lines. Handles multiple timestamp tags
// on one line (`[00:12.00][01:30.00] text` → two lines) and both centisecond and
// millisecond fractions. Lines without a valid timestamp are skipped (LRC metadata
// tags like `[ar:...]` carry no colon-separated mm:ss and are naturally ignored).
export function parseSyncedLyrics(lrc: string): LrcLine[] {
  const lines: LrcLine[] = [];
  const tagRe = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  for (const raw of lrc.split(/\r?\n/)) {
    tagRe.lastIndex = 0;
    const stamps: number[] = [];
    let lastTagEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(raw)) !== null) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const fracRaw = m[3];
      const frac = fracRaw ? parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length) : 0;
      stamps.push(min * 60 + sec + frac);
      lastTagEnd = tagRe.lastIndex;
    }
    if (stamps.length === 0) continue; // no timestamp on this line — skip
    const text = raw.slice(lastTagEnd).trim();
    for (const timeSec of stamps) lines.push({ timeSec, text });
  }

  return lines.sort((a, b) => a.timeSec - b.timeSec);
}

// The index of the line that should be highlighted at `positionSec`: the last line
// whose start time has been reached, or -1 before the first line begins. Pure so the
// lyrics panel's highlight logic is unit-tested here, not in a component timer.
export function activeLineIndex(lines: readonly LrcLine[], positionSec: number): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].timeSec <= positionSec) idx = i;
    else break;
  }
  return idx;
}

// Turn a definitive LRCLIB record into the cached-lyrics shape. An instrumental
// track, or one with neither synced nor plain lyrics, is an honest MISS (found:false)
// — never a fake or empty panel.
function recordToCached(record: LrclibRecord): CachedLyrics {
  const synced = typeof record.syncedLyrics === "string" && record.syncedLyrics.trim() !== ""
    ? record.syncedLyrics
    : null;
  const plain = typeof record.plainLyrics === "string" && record.plainLyrics.trim() !== ""
    ? record.plainLyrics
    : null;
  if (record.instrumental || (!synced && !plain)) {
    return { found: false, syncedLyrics: null, plainLyrics: null };
  }
  return { found: true, syncedLyrics: synced, plainLyrics: plain };
}

// Turn cached lyrics into the API payload the panel consumes (parsing the LRC once,
// on the server, so the client just renders timed lines).
export function toLyricsPayload(cached: CachedLyrics): LyricsPayload {
  if (!cached.found) return { found: false, synced: null, plain: null };
  const synced = cached.syncedLyrics ? parseSyncedLyrics(cached.syncedLyrics) : null;
  return {
    found: true,
    synced: synced && synced.length > 0 ? synced : null,
    plain: cached.plainLyrics ?? null,
  };
}

const NETWORK_REASON = "Lyrics service is unavailable right now";

// Look up lyrics for a track from LRCLIB. Tries the exact `/api/get` first (best
// precision when a duration is known), then falls back to `/api/search` when that
// 404s or no duration is available. Returns a DEFINITIVE outcome (cacheable) or a
// transient failure (not cacheable). Never throws.
export async function fetchLyricsFromLrclib(
  params: { title: string; artist: string | null; durationSec: number | null },
  opts: { fetch: FetchLike; base?: string },
): Promise<LyricsFetchOutcome> {
  const base = opts.base ?? LRCLIB_BASE;
  const headers = { "User-Agent": LRCLIB_USER_AGENT };
  const title = params.title.trim();
  if (title === "") return { ok: true, data: { found: false, syncedLyrics: null, plainLyrics: null } };
  const artist = (params.artist ?? "").trim();

  // 1) Exact get (with duration when known).
  try {
    const getParams = new URLSearchParams({ track_name: title });
    if (artist) getParams.set("artist_name", artist);
    if (params.durationSec != null) getParams.set("duration", String(Math.round(params.durationSec)));

    const res = await opts.fetch(`${base}/api/get?${getParams.toString()}`, { headers });
    if (res.ok) {
      const record = (await res.json()) as LrclibRecord;
      return { ok: true, data: recordToCached(record) };
    }
    if (res.status !== 404) {
      // A non-404 error (5xx, rate limit) is transient — do not cache it as a miss.
      return { ok: false, reason: NETWORK_REASON };
    }
    // 404 → fall through to the search fallback below.
  } catch {
    return { ok: false, reason: NETWORK_REASON };
  }

  // 2) Search fallback — broader match when the exact duration didn't line up.
  try {
    const searchParams = new URLSearchParams({ track_name: title });
    if (artist) searchParams.set("artist_name", artist);
    const res = await opts.fetch(`${base}/api/search?${searchParams.toString()}`, { headers });
    if (!res.ok) {
      // Search itself failing is transient (the get already 404'd, but we can't
      // confirm a true miss without a working search) — do not cache.
      return { ok: false, reason: NETWORK_REASON };
    }
    const records = (await res.json()) as LrclibRecord[];
    const best = pickBestMatch(records, { title, artist, durationSec: params.durationSec });
    if (!best) {
      // Search returned nothing we are CONFIDENT is the same song → a confirmed miss. Showing
      // an unverified near-match here is exactly the "wrong lyrics" bug (owner fix 5a): better
      // an honest "No lyrics" than someone else's words.
      return { ok: true, data: { found: false, syncedLyrics: null, plainLyrics: null } };
    }
    return { ok: true, data: recordToCached(best) };
  } catch {
    return { ok: false, reason: NETWORK_REASON };
  }
}

// Whether a candidate record is CONFIDENTLY the requested song (owner fix 5a). The record's
// title must strongly overlap the query title, its artist must match when we know one, and
// its duration must be within tolerance when we know it. This is the gate that turns a
// same-length, same-vibe-but-wrong record into an honest "No lyrics" instead of wrong words.
function isConfidentMatch(
  r: LrclibRecord,
  query: { title: string; artist: string | null; durationSec: number | null },
): boolean {
  const recTitle = typeof r.trackName === "string" ? r.trackName : "";
  // Require most of the query's title words to appear in the candidate's title.
  if (tokenOverlap(query.title, recTitle) < 0.6) return false;
  // When we know the artist, require a real overlap so a cover / different act is rejected.
  if (query.artist && query.artist.trim() !== "") {
    const recArtist = typeof r.artistName === "string" ? r.artistName : "";
    if (tokenOverlap(query.artist, recArtist) < 0.5) return false;
  }
  // When we know the duration, reject a candidate that is a very different length.
  if (query.durationSec != null && typeof r.duration === "number") {
    if (Math.abs(r.duration - query.durationSec) > DURATION_TOLERANCE_SEC) return false;
  }
  return true;
}

// Choose the best candidate from a search: only CONFIDENT matches are eligible (owner fix
// 5a), then prefer synced lyrics and the closest duration. Returns null when nothing is a
// confident match — the honest "No lyrics" outcome rather than an unverified near-miss.
function pickBestMatch(
  records: LrclibRecord[],
  query: { title: string; artist: string | null; durationSec: number | null },
): LrclibRecord | null {
  const eligible = records.filter(
    (r) =>
      ((typeof r.syncedLyrics === "string" && r.syncedLyrics.trim() !== "") ||
        (typeof r.plainLyrics === "string" && r.plainLyrics.trim() !== "")) &&
      isConfidentMatch(r, query),
  );
  if (eligible.length === 0) return null;

  const score = (r: LrclibRecord) => {
    const hasSynced = typeof r.syncedLyrics === "string" && r.syncedLyrics.trim() !== "";
    const durPenalty =
      query.durationSec != null && typeof r.duration === "number"
        ? Math.abs(r.duration - query.durationSec)
        : 0;
    // Synced beats plain decisively; duration closeness breaks ties.
    return (hasSynced ? 0 : 10_000) + durPenalty;
  };

  return eligible.reduce((best, r) => (score(r) < score(best) ? r : best), eligible[0]);
}
