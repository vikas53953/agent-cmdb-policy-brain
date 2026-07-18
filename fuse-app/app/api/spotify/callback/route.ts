// Spotify connect — PKCE callback (U15, R16).
//
// Leg 2 of Authorization Code + PKCE: Spotify redirects the user back here with a
// `code` + `state`. We verify `state` against the httpOnly cookie set in leg 1, then
// exchange the code (+ the stored verifier) for tokens, and land the user back on the
// app with an honest `?spotify=...` status the profile sheet reads.
//
// TOKEN HANDLING (owner standing rule — secrets never touch logs/localStorage): the
// access + refresh tokens are stored in httpOnly, secure cookies (browser JS can never
// read them; their values are never logged). A separate NON-httpOnly `sp_connected`
// marker — a bare "1", not a secret — lets the client show the Connected state. On any
// failure we redirect with an honest status and set no tokens (R17/R18).

import { NextResponse } from "next/server";
import { exchangeSpotifyCode, spotifyPublicClientId, spotifyRedirectUri } from "@/lib/spotify";
import { logActivity } from "@/lib/activity-log";

// Prisma-free but keeps parity with sibling routes; token exchange runs server-side.
export const runtime = "nodejs";

const realFetch = ((input: string, init?: RequestInit) =>
  fetch(input, init)) as unknown as Parameters<typeof exchangeSpotifyCode>[0]["fetch"];

function landing(request: Request, status: string): URL {
  const base = process.env.NEXT_PUBLIC_BASE_URL || new URL(request.url).origin;
  const url = new URL("/", base);
  url.searchParams.set("spotify", status);
  return url;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const authError = url.searchParams.get("error");

  const cookies = request.headers.get("cookie") ?? "";
  const verifier = readCookie(cookies, "sp_pkce_verifier");
  const savedState = readCookie(cookies, "sp_pkce_state");
  const clientId = spotifyPublicClientId();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;

  // Clear the one-time PKCE cookies regardless of outcome.
  function clearPkce(res: NextResponse) {
    res.cookies.delete("sp_pkce_verifier");
    res.cookies.delete("sp_pkce_state");
    return res;
  }

  if (authError || !code) {
    logActivity({ level: "info", type: "spotify-connect", message: "Spotify connect was cancelled" });
    return clearPkce(NextResponse.redirect(landing(request, "denied")));
  }
  if (!verifier || !savedState || !returnedState || savedState !== returnedState || !clientId || !baseUrl) {
    logActivity({ level: "error", type: "spotify-connect", message: "Spotify connect couldn't be verified" });
    return clearPkce(NextResponse.redirect(landing(request, "error")));
  }

  const tokens = await exchangeSpotifyCode({
    fetch: realFetch,
    clientId,
    code,
    redirectUri: spotifyRedirectUri(baseUrl),
    codeVerifier: verifier,
  });

  if (!tokens) {
    logActivity({ level: "error", type: "spotify-connect", message: "Spotify sign-in couldn't be completed" });
    return clearPkce(NextResponse.redirect(landing(request, "error")));
  }

  logActivity({ level: "info", type: "spotify-connect", message: "Spotify connected" });
  const res = clearPkce(NextResponse.redirect(landing(request, "connected")));
  const httpOnly = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };
  res.cookies.set("sp_access_token", tokens.accessToken, { ...httpOnly, maxAge: tokens.expiresInSec });
  if (tokens.refreshToken) {
    res.cookies.set("sp_refresh_token", tokens.refreshToken, { ...httpOnly, maxAge: 60 * 60 * 24 * 30 });
  }
  // Readable marker only — a bare "1", never a token — so the client can show Connected.
  res.cookies.set("sp_connected", "1", {
    httpOnly: false,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

// Minimal cookie reader for the two PKCE cookies we own (avoids pulling next/headers
// into this route). Values are opaque tokens; never logged.
function readCookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
