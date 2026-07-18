// Spotify connect — PKCE start (U15, R16).
//
// Leg 1 of Authorization Code + PKCE: mint a code_verifier, stash it (and a CSRF
// `state`) in short-lived httpOnly cookies, then redirect the user to Spotify's
// authorize page with the S256 code_challenge. Leg 2 is app/api/spotify/callback.
//
// HONESTY / KEYLESS SAFE (R17): with no public client id or base URL configured there
// is nothing to connect to, so we bounce home with `?spotify=unconfigured` instead of
// building a broken redirect. The profile-sheet Connect control is likewise disabled
// in that state, so this route is normally only reached when configured — the guard is
// defence-in-depth. Secrets never touch logs; the verifier lives only in an httpOnly
// cookie (never localStorage), and its value is never logged.

import { NextResponse } from "next/server";
import {
  buildSpotifyAuthorizeUrl,
  codeChallengeS256,
  generateCodeVerifier,
  hasSpotifyConnectConfig,
  spotifyPublicClientId,
  spotifyRedirectUri,
} from "@/lib/spotify";

// Web Crypto (SubtleCrypto for the S256 challenge) needs the Node runtime.
export const runtime = "nodejs";

const TEN_MINUTES = 60 * 10;

export async function GET(request: Request) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  const clientId = spotifyPublicClientId();

  if (!hasSpotifyConnectConfig() || !baseUrl || !clientId) {
    return NextResponse.redirect(new URL("/?spotify=unconfigured", request.url));
  }

  const verifier = generateCodeVerifier();
  const challenge = await codeChallengeS256(verifier);
  const state = generateCodeVerifier(32);

  const authorizeUrl = buildSpotifyAuthorizeUrl({
    clientId,
    redirectUri: spotifyRedirectUri(baseUrl),
    codeChallenge: challenge,
    state,
  });

  const res = NextResponse.redirect(authorizeUrl);
  const secure = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: TEN_MINUTES };
  res.cookies.set("sp_pkce_verifier", verifier, secure);
  res.cookies.set("sp_pkce_state", state, secure);
  return res;
}
