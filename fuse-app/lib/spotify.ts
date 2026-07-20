// Spotify helpers — search/metadata (U6) + user connect via PKCE (U15).
//
// U6 uses Spotify purely for search results and cover art, which works for EVERY
// user via APP credentials (the Client Credentials flow) — no per-user login. U15
// adds the user-facing Authorization-Code-with-PKCE CONNECT flow (so a user can link
// their own account) and the honest playback story: allowlisted Premium users can
// stream via the Web Playback SDK; everyone else automatically hears the matched
// YouTube version, labelled honestly (KTD-2, AE5). The PKCE helpers below are pure
// and unit-tested; the routes (app/api/spotify/*) wire them to real cookies + fetch.
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
import { providerTextOrNull } from "@/lib/text/provider-text";

const SP_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SP_SEARCH_URL = "https://api.spotify.com/v1/search";
const SP_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";

// Plain-English reasons for the UI (R17). Both are HONEST and CALM — neither promises that
// retrying will help, because when Spotify search is down on a deployment it stays down
// (a missing/blocked app credential, not a transient hiccup). "try again" here misled every
// searcher into re-running a query that could never succeed, so it is gone (the P1 fix).
export const SP_NOT_CONFIGURED = "Spotify search isn't set up on this server yet";
// App-credential search reached Spotify but was refused (invalid credentials, or Spotify
// blocking the server's datacenter IP). Persistent, not transient — so we say so plainly and
// point the user at what still works, rather than inviting a pointless retry.
export const SP_UNAVAILABLE =
  "Spotify search isn't available here right now — these results are from YouTube";

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
    if (!res.ok) return { ok: false, reason: SP_UNAVAILABLE };
    const body = (await res.json()) as SpotifySearchResponse;
    const tracks: TrackRef[] = (body.tracks?.items ?? [])
      .map((item): TrackRef | null => {
        const nativeId = item.uri ?? item.id;
        if (!nativeId) return null;
        return {
          source: "spotify",
          nativeId,
          // Decoded at the boundary (P3) — the same one-place contract as the YouTube
          // adapter. Spotify rarely escapes, so this is an idempotent safety net that keeps
          // the rule ("every provider adapter decodes once") true without exception.
          title: providerTextOrNull(item.name) ?? "Untitled",
          artist: providerTextOrNull(item.artists?.map((a) => a.name).filter(Boolean).join(", ")),
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
    return { ok: false, reason: SP_UNAVAILABLE };
  }
}

// ── User connect via Authorization Code + PKCE (U15, R16) ──────────────────────
//
// PKCE lets the BROWSER-public client id start an OAuth flow with no client secret:
// we generate a random `code_verifier`, send its SHA-256 hash (`code_challenge`) to
// Spotify's authorize page, and later prove possession by sending the raw verifier to
// the token endpoint. The verifier is held in an httpOnly cookie between the two legs
// (never in localStorage, never logged — owner standing rule). Everything below is
// pure over injected inputs so it unit-tests with no network and no env.

// Scopes the connect flow requests. `streaming` + the two `user-read-*` scopes are
// what the Web Playback SDK needs for allowlisted Premium playback; without Premium
// Spotify simply won't hand out a usable device, and we fall back to YouTube (KTD-2).
export const SPOTIFY_CONNECT_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
] as const;

// The PKCE connect flow needs a PUBLIC client id (NEXT_PUBLIC_) and a base URL to
// build the redirect URI. With either unset the Connect control renders disabled with
// an honest reason (R17) — this guard is what the profile sheet and the route read.
export function spotifyPublicClientId(): string | undefined {
  return process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID || process.env.SPOTIFY_CLIENT_ID;
}

export function hasSpotifyConnectConfig(): boolean {
  return !!spotifyPublicClientId() && !!process.env.NEXT_PUBLIC_BASE_URL;
}

// The redirect URI Spotify sends the user back to. Must EXACTLY match one registered
// in the Spotify dashboard, so it is derived from the single configured base URL.
export function spotifyRedirectUri(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/spotify/callback`;
}

const PKCE_UNRESERVED =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

// A high-entropy `code_verifier` (RFC 7636 recommends 43–128 unreserved chars).
// `randomBytes` is injected so tests are deterministic; the routes pass a real CSPRNG.
export function generateCodeVerifier(
  length = 64,
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes,
): string {
  const len = Math.max(43, Math.min(128, length));
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += PKCE_UNRESERVED[bytes[i] % PKCE_UNRESERVED.length];
  return out;
}

function defaultRandomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

// base64url with no padding — the encoding PKCE and Spotify expect for the challenge.
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 =
    typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The S256 `code_challenge` = base64url(SHA-256(verifier)). Async because it uses the
// Web Crypto SubtleCrypto (present in the Node and Edge runtimes Next uses).
export async function codeChallengeS256(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

// Build the Spotify authorize URL the user is redirected to (pure, unit-tested).
export function buildSpotifyAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: "code",
    redirect_uri: opts.redirectUri,
    code_challenge_method: "S256",
    code_challenge: opts.codeChallenge,
    state: opts.state,
    scope: (opts.scopes ?? SPOTIFY_CONNECT_SCOPES).join(" "),
  });
  return `${SP_AUTHORIZE_URL}?${params.toString()}`;
}

// The token payload we keep from a successful exchange. Access + refresh tokens are
// SECRETS — callers store them in httpOnly cookies and never log their values.
export type SpotifyTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number;
};

type SpotifyTokenExchangeResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

// Exchange the authorization `code` (+ the stored verifier) for tokens. Returns null on
// any failure so the callback route degrades to an honest "couldn't connect" rather than
// throwing. Pure over injected `fetch` — tests pass a fake, the route passes real fetch.
export async function exchangeSpotifyCode(opts: {
  fetch: FetchLike;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<SpotifyTokens | null> {
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      code_verifier: opts.codeVerifier,
    }).toString();
    const res = await opts.fetch(SP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as SpotifyTokenExchangeResponse;
    if (!json.access_token) return null;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expiresInSec: typeof json.expires_in === "number" ? json.expires_in : 3600,
    };
  } catch {
    return null;
  }
}
