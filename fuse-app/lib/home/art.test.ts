// Home cover-art resolution (R5). The bug these lock down: Home renders persisted rows
// whose artUrl column is nullable, so rows saved without art rendered a plain grey box
// while Search (live provider results) showed artwork for the same video.

import { describe, it, expect } from "vitest";
import type { TrackRef } from "@/lib/repos/track";
import {
  artCandidates,
  derivedArtUrl,
  withResolvedArt,
  withResolvedArtAll,
  youtubeArtUrl,
} from "@/lib/home/art";

function track(over: Partial<TrackRef> = {}): TrackRef {
  return {
    source: "youtube",
    nativeId: "dQw4w9WgXcQ",
    title: "A song",
    artist: "Someone",
    artUrl: null,
    durationSec: null,
    ...over,
  };
}

describe("youtubeArtUrl", () => {
  it("builds the keyless, CSP-allowed thumbnail URL for a video id", () => {
    expect(youtubeArtUrl("abc123")).toBe("https://i.ytimg.com/vi/abc123/hqdefault.jpg");
  });
});

describe("derivedArtUrl", () => {
  it("derives art for a YouTube track from its video id", () => {
    expect(derivedArtUrl(track())).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  });

  it("returns null for sources whose art cannot be derived from an id (never invents)", () => {
    expect(derivedArtUrl(track({ source: "spotify", nativeId: "s1" }))).toBeNull();
    expect(derivedArtUrl(track({ source: "local", nativeId: "f1" }))).toBeNull();
  });

  it("returns null when there is no usable native id", () => {
    expect(derivedArtUrl(track({ nativeId: "   " }))).toBeNull();
  });
});

describe("withResolvedArt", () => {
  it("fills in missing art for a YouTube row (the blank-cover bug)", () => {
    expect(withResolvedArt(track({ artUrl: null })).artUrl).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
  });

  it("treats a blank string as missing art", () => {
    expect(withResolvedArt(track({ artUrl: "  " })).artUrl).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
  });

  it("keeps a real stored art URL untouched", () => {
    const stored = track({ artUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" });
    expect(withResolvedArt(stored)).toBe(stored);
  });

  it("leaves a non-derivable source with null art rather than faking one", () => {
    const spotify = track({ source: "spotify", nativeId: "s1", artUrl: null });
    expect(withResolvedArt(spotify).artUrl).toBeNull();
  });

  it("changes nothing but the art URL", () => {
    const resolved = withResolvedArt(track({ title: "Hello", artist: "Adele" }));
    expect(resolved.title).toBe("Hello");
    expect(resolved.artist).toBe("Adele");
    expect(resolved.nativeId).toBe("dQw4w9WgXcQ");
    expect(resolved.source).toBe("youtube");
  });
});

describe("withResolvedArtAll", () => {
  it("resolves every row in a Home carousel", () => {
    const rows = withResolvedArtAll([
      track({ nativeId: "a1" }),
      track({ nativeId: "b2", artUrl: "https://cdn.example/x.jpg" }),
      track({ source: "spotify", nativeId: "s1" }),
    ]);
    expect(rows.map((r) => r.artUrl)).toEqual([
      "https://i.ytimg.com/vi/a1/hqdefault.jpg",
      "https://cdn.example/x.jpg",
      null,
    ]);
  });
});

describe("artCandidates", () => {
  it("offers the stored URL first, then the derived one as a fallback", () => {
    expect(artCandidates(track({ artUrl: "https://cdn.example/x.jpg" }))).toEqual([
      "https://cdn.example/x.jpg",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    ]);
  });

  it("does not repeat the same URL when stored and derived agree", () => {
    expect(artCandidates(track({ artUrl: youtubeArtUrl("dQw4w9WgXcQ") }))).toEqual([
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    ]);
  });

  it("is empty only when there is genuinely nothing real to show", () => {
    expect(artCandidates(track({ source: "local", nativeId: "f1", artUrl: null }))).toEqual([]);
  });
});
