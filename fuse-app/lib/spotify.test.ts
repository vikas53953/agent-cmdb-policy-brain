import { describe, it, expect } from "vitest";
import { searchSpotify, SP_NOT_CONFIGURED } from "./spotify";
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
