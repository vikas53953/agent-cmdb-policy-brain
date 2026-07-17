// Spotify search + metadata helpers (U6 scope: SEARCH ONLY, R1/R5).
//
// U6 uses Spotify purely for search results and cover art, which works for EVERY
// user via APP credentials (the Client Credentials flow) — no per-user login. The
// user-facing PKCE connect flow and real Spotify PLAYBACK land in U15; nothing
// here plays anything.
//
// CREDENTIALS NOTE: the Client Credentials flow needs BOTH a client id and a
// client secret (unlike the browser PKCE flow, which is secret-less). So
// server-side search requires SPOTIFY_CLIENT_SECRET in addition to the id. It is
// added to .env.example and read only here on the server, never shipped to the
// browser. With either value unset, search returns an honest `{ ok: false }` and
// the UI says Spotify search isn't set up — it never throws (R17, keyless-safe).
//
// Everything is pure over an injected `fetch`, so CI needs no network and no keys.

import type { TrackRef } from "@/lib/repos/track";
import type { FetchLike, SourceOutcome } from "@/lib/youtube";

const SP_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SP_SEARCH_URL = "https://api.spotify.com/v1/search";

// Plain-English reasons for the UI (R17).
export const SP_NOT_CONFIGURED = "Spotify search isn't set up on this server yet";
const SP_REQUEST_FAILED = "Spotify search is unavailable right now — try again";

export function hasSpotifyAppCredentials(): boolean {
  return !!process.env.SPOTIFY_CLIENT_ID && !!process.env.SPOTIFY_CLIENT_SECRET;
}

type SpotifyTokenResponse = { access_token?: string };

// Fetch an app-level access token via Client Credentials. Returns null when the
// credentials are missing or the exchange fails — callers treat that as "Spotify
// search unavailable" rather than an error.
export async function getSpotifyAppToken(opts: {
  fetch: FetchLike;
  clientId?: string;
  clientSecret?: string;
}): Promise<string | null> {
  const clientId = opts.clientId ?? process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = opts.clientSecret ?? process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    // btoa is available in the Node/Edge runtimes Next uses; encodes id:secret.
    const basic =
      typeof btoa === "function"
        ? btoa(`${clientId}:${clientSecret}`)
        : Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await opts.fetch(SP_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as SpotifyTokenResponse;
    return body.access_token ?? null;
  } catch {
    return null;
  }
}

type SpotifySearchResponse = {
  tracks?: {
    items?: Array<{
      id?: string;
      uri?: string;
      name?: string;
      duration_ms?: number;
      artists?: Array<{ name?: string }>;
      album?: { images?: Array<{ url?: string }> };
    }>;
  };
};

// Search Spotify tracks with an app token. `getToken` is injected so tests skip
// the token round-trip; the route supplies one that calls getSpotifyAppToken.
export async function searchSpotify(
  query: string,
  opts: {
    fetch: FetchLike;
    getToken?: () => Promise<string | null>;
    max?: number;
  },
): Promise<SourceOutcome> {
  const getToken =
    opts.getToken ?? (() => getSpotifyAppToken({ fetch: opts.fetch }));
  const token = await getToken();
  if (!token) return { ok: false, reason: SP_NOT_CONFIGURED };

  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: String(opts.max ?? 8),
  });

  try {
    const res = await opts.fetch(`${SP_SEARCH_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, reason: SP_REQUEST_FAILED };
    const body = (await res.json()) as SpotifySearchResponse;
    const tracks: TrackRef[] = (body.tracks?.items ?? [])
      .map((item): TrackRef | null => {
        const nativeId = item.uri ?? item.id;
        if (!nativeId) return null;
        return {
          source: "spotify",
          nativeId,
          title: item.name ?? "Untitled",
          artist: item.artists?.map((a) => a.name).filter(Boolean).join(", ") || null,
          artUrl: item.album?.images?.[0]?.url ?? null,
          durationSec:
            typeof item.duration_ms === "number"
              ? Math.round(item.duration_ms / 1000)
              : null,
        };
      })
      .filter((t): t is TrackRef => t !== null);
    return { ok: true, tracks };
  } catch {
    return { ok: false, reason: SP_REQUEST_FAILED };
  }
}
