import { describe, it, expect } from "vitest";
import {
  parseSyncedLyrics,
  activeLineIndex,
  toLyricsPayload,
  fetchLyricsFromLrclib,
  type LrcLine,
} from "./lyrics";
import type { FetchLike } from "./youtube";

// A tiny fake fetch that returns canned responses per URL substring, so no network
// is touched in CI (mirrors the youtube.ts / search test style).
function fakeFetch(
  routes: Array<{ match: string; status?: number; body: unknown }>,
): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetch: FetchLike = async (input) => {
    calls.push(input);
    const route = routes.find((r) => input.includes(r.match));
    const status = route?.status ?? (route ? 200 : 404);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route?.body ?? null,
    };
  };
  return { fetch, calls };
}

describe("parseSyncedLyrics", () => {
  it("parses [mm:ss.xx] timestamps into sorted timed lines", () => {
    const lrc = "[00:35.66] Look at the stars\n[00:38.46] Look how they shine for you";
    expect(parseSyncedLyrics(lrc)).toEqual<LrcLine[]>([
      { timeSec: 35.66, text: "Look at the stars" },
      { timeSec: 38.46, text: "Look how they shine for you" },
    ]);
  });

  it("expands multiple timestamps on one line and sorts by time", () => {
    const lines = parseSyncedLyrics("[01:30.00][00:10.00] repeated chorus");
    expect(lines).toEqual<LrcLine[]>([
      { timeSec: 10, text: "repeated chorus" },
      { timeSec: 90, text: "repeated chorus" },
    ]);
  });

  it("handles millisecond fractions and keeps blank-text timed lines", () => {
    const lines = parseSyncedLyrics("[00:40.360] \n[00:44.170] And everything you do");
    expect(lines[0]).toEqual({ timeSec: 40.36, text: "" });
    expect(lines[1]).toEqual({ timeSec: 44.17, text: "And everything you do" });
  });

  it("skips lines with no valid timestamp (e.g. metadata tags)", () => {
    expect(parseSyncedLyrics("[ar:Coldplay]\nplain line with no stamp")).toEqual([]);
  });
});

describe("activeLineIndex", () => {
  const lines: LrcLine[] = [
    { timeSec: 0, text: "a" },
    { timeSec: 10, text: "b" },
    { timeSec: 20, text: "c" },
  ];
  it("returns -1 before the first line begins", () => {
    expect(activeLineIndex(lines, -1)).toBe(-1);
  });
  it("returns the last line whose start has been reached", () => {
    expect(activeLineIndex(lines, 0)).toBe(0);
    expect(activeLineIndex(lines, 9.9)).toBe(0);
    expect(activeLineIndex(lines, 10)).toBe(1);
    expect(activeLineIndex(lines, 999)).toBe(2);
  });
});

describe("toLyricsPayload", () => {
  it("parses synced lyrics for the panel", () => {
    const payload = toLyricsPayload({
      found: true,
      syncedLyrics: "[00:01.00]one\n[00:02.00]two",
      plainLyrics: "one\ntwo",
    });
    expect(payload.found).toBe(true);
    expect(payload.synced).toEqual([
      { timeSec: 1, text: "one" },
      { timeSec: 2, text: "two" },
    ]);
    expect(payload.plain).toBe("one\ntwo");
  });

  it("falls back to plain when there are no synced timestamps", () => {
    const payload = toLyricsPayload({ found: true, syncedLyrics: null, plainLyrics: "just words" });
    expect(payload.synced).toBeNull();
    expect(payload.plain).toBe("just words");
  });

  it("reports the honest empty state for a miss (R7/AE2)", () => {
    expect(toLyricsPayload({ found: false, syncedLyrics: null, plainLyrics: null })).toEqual({
      found: false,
      synced: null,
      plain: null,
    });
  });
});

describe("fetchLyricsFromLrclib (KTD-3, verified params)", () => {
  it("returns a hit from /api/get with synced lyrics", async () => {
    const { fetch, calls } = fakeFetch([
      {
        match: "/api/get",
        body: { syncedLyrics: "[00:01.00]hi", plainLyrics: "hi", instrumental: false },
      },
    ]);
    const out = await fetchLyricsFromLrclib(
      { title: "Yellow", artist: "Coldplay", durationSec: 267 },
      { fetch },
    );
    expect(out).toEqual({
      ok: true,
      data: { found: true, syncedLyrics: "[00:01.00]hi", plainLyrics: "hi" },
    });
    // The exact-get path was used and carried the verified param names.
    expect(calls[0]).toContain("track_name=Yellow");
    expect(calls[0]).toContain("artist_name=Coldplay");
    expect(calls[0]).toContain("duration=267");
  });

  it("treats an instrumental track as an honest miss", async () => {
    const { fetch } = fakeFetch([
      { match: "/api/get", body: { syncedLyrics: null, plainLyrics: null, instrumental: true } },
    ]);
    const out = await fetchLyricsFromLrclib(
      { title: "Interlude", artist: "Someone", durationSec: 90 },
      { fetch },
    );
    expect(out).toEqual({ ok: true, data: { found: false, syncedLyrics: null, plainLyrics: null } });
  });

  it("falls back to /api/search when the exact get 404s, picking a synced match", async () => {
    const { fetch, calls } = fakeFetch([
      { match: "/api/get", status: 404, body: null },
      {
        match: "/api/search",
        body: [
          { syncedLyrics: null, plainLyrics: "plain only", instrumental: false, duration: 200, trackName: "Song", artistName: "Artist" },
          { syncedLyrics: "[00:03.00]synced", plainLyrics: "synced", instrumental: false, duration: 201, trackName: "Song", artistName: "Artist" },
        ],
      },
    ]);
    const out = await fetchLyricsFromLrclib(
      { title: "Song", artist: "Artist", durationSec: 201 },
      { fetch },
    );
    expect(out.ok).toBe(true);
    expect(out.ok && out.data.found).toBe(true);
    expect(out.ok && out.data.syncedLyrics).toBe("[00:03.00]synced");
    expect(calls.some((c) => c.includes("/api/search"))).toBe(true);
  });

  it("confirms a MISS (cacheable) when search returns nothing usable", async () => {
    const { fetch } = fakeFetch([
      { match: "/api/get", status: 404, body: null },
      { match: "/api/search", body: [] },
    ]);
    const out = await fetchLyricsFromLrclib(
      { title: "Obscure", artist: null, durationSec: null },
      { fetch },
    );
    expect(out).toEqual({ ok: true, data: { found: false, syncedLyrics: null, plainLyrics: null } });
  });

  it("does NOT confirm a miss on a transient 5xx (must not poison the empty state)", async () => {
    const { fetch } = fakeFetch([{ match: "/api/get", status: 503, body: null }]);
    const out = await fetchLyricsFromLrclib(
      { title: "Song", artist: "Artist", durationSec: 200 },
      { fetch },
    );
    expect(out.ok).toBe(false);
  });
});
