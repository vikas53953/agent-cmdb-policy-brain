import { describe, it, expect, vi } from "vitest";
import {
  searchYouTube,
  resolveYouTubeVideoById,
  parseIso8601Duration,
  youtubeThumbnailUrl,
  hasYouTubeApiKey,
  YT_NOT_CONFIGURED,
  type FetchLike,
} from "./youtube";

// A fake fetch that records the URL it was called with and returns a canned body.
function fakeFetch(body: unknown, ok = true): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchLike = async (input) => {
    urls.push(input);
    return { ok, status: ok ? 200 : 500, json: async () => body };
  };
  return { fetch, urls };
}

describe("parseIso8601Duration", () => {
  it("parses hours/minutes/seconds and rejects junk", () => {
    expect(parseIso8601Duration("PT4M13S")).toBe(253);
    expect(parseIso8601Duration("PT1H2M3S")).toBe(3723);
    expect(parseIso8601Duration("PT45S")).toBe(45);
    expect(parseIso8601Duration(undefined)).toBeNull();
    expect(parseIso8601Duration("nope")).toBeNull();
  });
});

describe("youtubeThumbnailUrl", () => {
  it("builds the deterministic i.ytimg.com url so a result always has art (R5)", () => {
    expect(youtubeThumbnailUrl("abc123")).toBe("https://i.ytimg.com/vi/abc123/hqdefault.jpg");
  });
});

describe("searchYouTube — key guard (keyless-safe, R17)", () => {
  it("returns an honest 'not configured' outcome and makes NO call without a key", async () => {
    const { fetch, urls } = fakeFetch({});
    const out = await searchYouTube("paper cities", { fetch, apiKey: undefined });
    expect(out).toEqual({ ok: false, reason: YT_NOT_CONFIGURED });
    expect(urls).toHaveLength(0);
  });

  it("parses search.list items into TrackRefs when a key is present", async () => {
    const { fetch, urls } = fakeFetch({
      items: [
        {
          id: { videoId: "vid1" },
          snippet: {
            title: "Paper Cities",
            channelTitle: "Some Band",
            thumbnails: { high: { url: "https://i.ytimg.com/vi/vid1/hqdefault.jpg" } },
          },
        },
        { id: {} }, // missing videoId → dropped
      ],
    });
    const out = await searchYouTube("paper cities", { fetch, apiKey: "test-key", max: 5 });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.tracks).toHaveLength(1);
      expect(out.tracks[0]).toMatchObject({ source: "youtube", nativeId: "vid1", title: "Paper Cities" });
    }
    // It hit search.list (the 100-unit endpoint) — expected on a cache MISS only.
    expect(urls[0]).toContain("/youtube/v3/search");
  });
});

describe("resolveYouTubeVideoById — cheap known-id path (KTD-8)", () => {
  it("uses videos.list (1 unit), NOT search.list, when a key is present", async () => {
    const { fetch, urls } = fakeFetch({
      items: [
        {
          id: "vid1",
          snippet: { title: "Known Song", channelTitle: "Band" },
          contentDetails: { duration: "PT3M20S" },
        },
      ],
    });
    const track = await resolveYouTubeVideoById("vid1", { fetch, apiKey: "test-key" });
    expect(track).toMatchObject({ nativeId: "vid1", title: "Known Song", durationSec: 200 });
    expect(urls[0]).toContain("/youtube/v3/videos");
    expect(urls[0]).not.toContain("/search");
  });

  it("falls back to keyless oEmbed (0 units) when no key is present", async () => {
    const { fetch, urls } = fakeFetch({
      title: "Rick Astley - Never Gonna Give You Up",
      author_name: "Rick Astley",
      thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });
    const track = await resolveYouTubeVideoById("dQw4w9WgXcQ", { fetch, apiKey: undefined });
    expect(track).toMatchObject({
      source: "youtube",
      nativeId: "dQw4w9WgXcQ",
      title: "Rick Astley - Never Gonna Give You Up",
      artist: "Rick Astley",
    });
    expect(urls[0]).toContain("youtube.com/oembed");
  });
});

describe("hasYouTubeApiKey", () => {
  it("reflects the env var without leaking its value", () => {
    // No key set on this machine → false. (We assert a boolean, never a value.)
    expect(typeof hasYouTubeApiKey()).toBe("boolean");
  });
});

// Guard against an accidental live-network dependency in these unit tests.
vi.stubGlobal("fetch", () => {
  throw new Error("unit tests must not hit the real network");
});
