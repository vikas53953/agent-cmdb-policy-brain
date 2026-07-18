import { describe, it, expect } from "vitest";
import {
  searchSpotify,
  SP_NOT_CONFIGURED,
  base64UrlEncode,
  buildSpotifyAuthorizeUrl,
  codeChallengeS256,
  exchangeSpotifyCode,
  generateCodeVerifier,
  spotifyRedirectUri,
} from "./spotify";
import type { FetchLike } from "@/lib/youtube";

function fakeFetch(body: unknown, ok = true): FetchLike {
  return async () => ({ ok, status: ok ? 200 : 500, json: async () => body });
}

describe("searchSpotify — credential guard (keyless-safe, R17)", () => {
  it("returns an honest 'not configured' outcome when no app token is available", async () => {
    const out = await searchSpotify("paper cities", {
      fetch: fakeFetch({}),
      getToken: async () => null, // simulates missing SPOTIFY_CLIENT_ID/SECRET
    });
    expect(out).toEqual({ ok: false, reason: SP_NOT_CONFIGURED });
  });
});

describe("searchSpotify — parsing (R1/R5)", () => {
  it("maps track items to TrackRefs with album art, artist, and duration", async () => {
    const out = await searchSpotify("paper cities", {
      fetch: fakeFetch({
        tracks: {
          items: [
            {
              id: "t1",
              uri: "spotify:track:t1",
              name: "Paper Cities",
              duration_ms: 213000,
              artists: [{ name: "Some Band" }, { name: "Feat" }],
              album: { images: [{ url: "https://i.scdn.co/image/abc" }] },
            },
            { name: "no id — dropped" },
          ],
        },
      }),
      getToken: async () => "app-token",
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.tracks).toHaveLength(1);
      expect(out.tracks[0]).toEqual({
        source: "spotify",
        nativeId: "spotify:track:t1",
        title: "Paper Cities",
        artist: "Some Band, Feat",
        artUrl: "https://i.scdn.co/image/abc",
        durationSec: 213,
      });
    }
  });
});

describe("PKCE connect helpers (U15, R16)", () => {
  it("generates a verifier of unreserved chars within the RFC length window", () => {
    const v = generateCodeVerifier(64, (n) => new Uint8Array(n).fill(200));
    expect(v).toHaveLength(64);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    // Length is clamped to 43..128 even when asked for less/more.
    expect(generateCodeVerifier(10, (n) => new Uint8Array(n))).toHaveLength(43);
    expect(generateCodeVerifier(500, (n) => new Uint8Array(n))).toHaveLength(128);
  });

  it("base64url-encodes without +, / or = padding", () => {
    const encoded = base64UrlEncode(new Uint8Array([251, 255, 191, 0]));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("derives a deterministic S256 challenge (RFC 7636 test vector)", async () => {
    // The canonical RFC 7636 Appendix B example.
    const challenge = await codeChallengeS256(
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    );
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("builds an authorize URL with S256, redirect, state and scopes", () => {
    const url = new URL(
      buildSpotifyAuthorizeUrl({
        clientId: "abc",
        redirectUri: "https://fuse.app/api/spotify/callback",
        codeChallenge: "chal",
        state: "st",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(url.searchParams.get("client_id")).toBe("abc");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("scope")).toContain("streaming");
  });

  it("derives the redirect URI from the base URL, trimming a trailing slash", () => {
    expect(spotifyRedirectUri("https://fuse.app/")).toBe(
      "https://fuse.app/api/spotify/callback",
    );
  });

  it("exchanges a code for tokens and returns null on failure", async () => {
    const ok = await exchangeSpotifyCode({
      fetch: fakeFetch({ access_token: "AT", refresh_token: "RT", expires_in: 3600 }),
      clientId: "abc",
      code: "code",
      redirectUri: "https://fuse.app/api/spotify/callback",
      codeVerifier: "verifier",
    });
    expect(ok).toEqual({ accessToken: "AT", refreshToken: "RT", expiresInSec: 3600 });

    const bad = await exchangeSpotifyCode({
      fetch: fakeFetch({}, false),
      clientId: "abc",
      code: "code",
      redirectUri: "https://fuse.app/api/spotify/callback",
      codeVerifier: "verifier",
    });
    expect(bad).toBeNull();
  });
});
