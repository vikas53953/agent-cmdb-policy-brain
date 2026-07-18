// YouTube Data API v3 + keyless oEmbed helpers (U6, R1/R5, KTD-8).
//
// Two jobs: turn a typed query into playable search results (search.list) and
// resolve a KNOWN video id cheaply (videos.list at 1 unit, or keyless oEmbed at
// 0 units). Everything here is pure over an injected `fetch`, so the search route
// wires the real global fetch and unit tests pass a fake — no network in CI.
//
// KEYLESS-SAFE: every function guards on the API key. With YOUTUBE_API_KEY unset
// (the default on this machine — secrets never touch this repo), search.list and
// videos.list return an honest `{ ok: false, reason }` instead of throwing, and
// the UI degrades to a plain "not set up yet" message (R17). The keyless oEmbed
// path needs no key at all.
//
// ── KTD-8 QUOTA REALITY (verified inline 2026-07-17) ───────────────────────────
// `search.list` costs 100 units against the default 10,000 units/day project
// budget — about 100 searches/day before the project is throttled. That single
// fact is the whole reason U6 is cache-first (lib/repos/search-cache.ts) and
// prefers `videos.list` (1 unit) and keyless oEmbed (0 units) for known ids.
// The rumored June-2026 "~100 searches/day HARD cap" (flagged UNVERIFIED in the
// plan) could NOT be confirmed live from this environment: confirming it needs a
// provisioned YOUTUBE_API_KEY plus that project's Google Cloud quota page, and no
// key exists here. What WAS verified live: the keyless oEmbed endpoint
// (https://www.youtube.com/oembed?url=…&format=json) returns `title`,
// `author_name`, and an `i.ytimg.com/vi/{id}/hqdefault.jpg` `thumbnail_url` for a
// known id at zero quota cost — so `resolveYouTubeVideoById()` leans on it. The
// design is quota-defensive whether or not the cap is real: cache-first, 1-unit
// videos.list for known ids, keyless oEmbed fallback, and a debounced input.

import type { TrackRef } from "@/lib/repos/track";

// Injected fetch so the route uses the real one and tests use a fake. Matches the
// global fetch signature closely enough for our narrow use.
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

// A source call either produces tracks or explains, in plain English, why it
// produced none. The union makes "empty because unconfigured" impossible to
// confuse with "empty because no matches".
export type SourceOutcome =
  | { ok: true; tracks: TrackRef[] }
  | { ok: false; reason: string };

const YT_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const YT_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const YT_OEMBED_URL = "https://www.youtube.com/oembed";

// Plain-English reasons surfaced to the UI (R17). No jargon, no key hints.
export const YT_NOT_CONFIGURED = "YouTube search isn't set up on this server yet";
const YT_REQUEST_FAILED = "YouTube search is unavailable right now — try again";

export function hasYouTubeApiKey(): boolean {
  return !!process.env.YOUTUBE_API_KEY;
}

// The i.ytimg.com thumbnail for a video id. hqdefault always exists for a real
// video (maxresdefault does not), so it is the safe default; higher qualities are
// listed for callers that want to try-then-fallback client-side.
export const YT_THUMB_QUALITIES = [
  "maxresdefault",
  "sddefault",
  "hqdefault",
  "mqdefault",
] as const;

export function youtubeThumbnailUrl(
  videoId: string,
  quality: (typeof YT_THUMB_QUALITIES)[number] = "hqdefault",
): string {
  return `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`;
}

type YtSearchListResponse = {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      channelTitle?: string;
      thumbnails?: Record<string, { url?: string } | undefined>;
    };
  }>;
};

// Pull the best available thumbnail url from a snippet, falling back to the
// deterministic i.ytimg.com url so a result ALWAYS has real cover art (R5).
function snippetArt(
  videoId: string,
  thumbnails: Record<string, { url?: string } | undefined> | undefined,
): string {
  return (
    thumbnails?.high?.url ??
    thumbnails?.medium?.url ??
    thumbnails?.default?.url ??
    youtubeThumbnailUrl(videoId)
  );
}

// search.list → TrackRef[]. Costs 100 quota units, so callers MUST come through
// the cache first (the route does). `max` bounds the result count (default 8).
export async function searchYouTube(
  query: string,
  opts: { fetch: FetchLike; apiKey?: string; max?: number },
): Promise<SourceOutcome> {
  const apiKey = opts.apiKey ?? process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { ok: false, reason: YT_NOT_CONFIGURED };

  const params = new URLSearchParams({
    key: apiKey,
    q: query,
    part: "snippet",
    type: "video",
    videoEmbeddable: "true", // only embeddable videos — the visible-player rule (KTD-7)
    maxResults: String(opts.max ?? 8),
  });

  try {
    const res = await opts.fetch(`${YT_SEARCH_URL}?${params.toString()}`);
    if (!res.ok) return { ok: false, reason: YT_REQUEST_FAILED };
    const body = (await res.json()) as YtSearchListResponse;
    const tracks: TrackRef[] = (body.items ?? [])
      .map((item): TrackRef | null => {
        const videoId = item.id?.videoId;
        if (!videoId) return null;
        return {
          source: "youtube",
          nativeId: videoId,
          title: item.snippet?.title ?? "Untitled",
          artist: item.snippet?.channelTitle ?? null,
          artUrl: snippetArt(videoId, item.snippet?.thumbnails),
          durationSec: null, // search.list omits duration; videos.list has it if needed
        };
      })
      .filter((t): t is TrackRef => t !== null);
    return { ok: true, tracks };
  } catch {
    return { ok: false, reason: YT_REQUEST_FAILED };
  }
}

type YtVideosListResponse = {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      channelTitle?: string;
      thumbnails?: Record<string, { url?: string } | undefined>;
    };
    contentDetails?: { duration?: string };
  }>;
};

type OEmbedResponse = {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
};

// Parse an ISO-8601 duration (e.g. "PT4M13S") to whole seconds, or null if absent.
export function parseIso8601Duration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const [h, min, s] = [m[1], m[2], m[3]].map((v) => (v ? parseInt(v, 10) : 0));
  const total = h * 3600 + min * 60 + s;
  return total > 0 ? total : null;
}

// Resolve a KNOWN video id to a TrackRef WITHOUT paying the 100-unit search cost.
// Prefers `videos.list` (1 unit, gives real duration) when a key exists; otherwise
// falls back to the keyless oEmbed endpoint (0 units — verified live, see header).
// Returns null only when neither path yields a usable title.
export async function resolveYouTubeVideoById(
  videoId: string,
  opts: { fetch: FetchLike; apiKey?: string },
): Promise<TrackRef | null> {
  const apiKey = opts.apiKey ?? process.env.YOUTUBE_API_KEY;

  if (apiKey) {
    const params = new URLSearchParams({
      key: apiKey,
      id: videoId,
      part: "snippet,contentDetails",
    });
    try {
      const res = await opts.fetch(`${YT_VIDEOS_URL}?${params.toString()}`);
      if (res.ok) {
        const body = (await res.json()) as YtVideosListResponse;
        const item = body.items?.[0];
        if (item) {
          return {
            source: "youtube",
            nativeId: videoId,
            title: item.snippet?.title ?? "Untitled",
            artist: item.snippet?.channelTitle ?? null,
            artUrl: snippetArt(videoId, item.snippet?.thumbnails),
            durationSec: parseIso8601Duration(item.contentDetails?.duration),
          };
        }
      }
    } catch {
      // fall through to the keyless path below
    }
  }

  // Keyless oEmbed (0 quota). Verified live 2026-07-17 (see file header).
  try {
    const url = `${YT_OEMBED_URL}?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`,
    )}&format=json`;
    const res = await opts.fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as OEmbedResponse;
    if (!body.title) return null;
    return {
      source: "youtube",
      nativeId: videoId,
      title: body.title,
      artist: body.author_name ?? null,
      artUrl: body.thumbnail_url ?? youtubeThumbnailUrl(videoId),
      durationSec: null, // oEmbed carries no duration
    };
  } catch {
    return null;
  }
}
