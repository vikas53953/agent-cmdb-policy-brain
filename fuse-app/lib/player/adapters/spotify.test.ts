import { describe, it, expect } from "vitest";
import {
  createSpotifyAdapter,
  SPOTIFY_FALLBACK_NOTICE,
  SPOTIFY_NO_MATCH_REASON,
} from "@/lib/player/adapters/spotify";
import type { TrackRef } from "@/lib/repos/track";

const spTrack: TrackRef = {
  source: "spotify",
  nativeId: "spotify:track:xyz",
  title: "Paper Cities",
  artist: "Some Band",
  artUrl: "https://i.scdn.co/image/abc",
  durationSec: 213,
};

const ytMatch: TrackRef = {
  source: "youtube",
  nativeId: "vid123",
  title: "Some Band - Paper Cities",
  artist: "Some Band",
  artUrl: "https://i.ytimg.com/vi/vid123/hqdefault.jpg",
  durationSec: 210,
};

describe("Spotify adapter — honest YouTube fallback (U15, AE5, KTD-2)", () => {
  it("substitutes the matched YouTube track and labels the swap honestly", async () => {
    const adapter = createSpotifyAdapter({ resolveMatch: async () => ytMatch });
    const resolution = await adapter.resolvePlayable!(spTrack);
    expect(resolution).toEqual({ track: ytMatch, notice: SPOTIFY_FALLBACK_NOTICE });
  });

  it("returns an honest failure (no fake playback) when no YouTube match exists", async () => {
    const adapter = createSpotifyAdapter({ resolveMatch: async () => null });
    const resolution = await adapter.resolvePlayable!(spTrack);
    expect(resolution).toEqual({ track: null, reason: SPOTIFY_NO_MATCH_REASON });
  });

  it("declares Spotify's capability column and never claims to be a native engine", () => {
    const adapter = createSpotifyAdapter({ resolveMatch: async () => ytMatch });
    expect(adapter.source).toBe("spotify");
    expect(adapter.capabilities.singleDeckOnly).toBe(true);
    // The transport methods are honest no-ops (the YouTube adapter is the real engine).
    expect(() => {
      adapter.pause();
      adapter.seek(1);
      adapter.setVolume(0.5);
      adapter.setRate(1);
      adapter.unload();
    }).not.toThrow();
  });
});
