import { describe, it, expect } from "vitest";
import { makeModel, makePrisma } from "./__fixtures__/fake-prisma";
import { lyricsKey, readLyricsCache, writeLyricsCache } from "./lyrics-cache";

describe("lyrics cache key", () => {
  it("normalizes title/artist and buckets duration", () => {
    expect(lyricsKey("  Paper  Cities ", "The Band", 214)).toBe("paper cities|the band|214");
    expect(lyricsKey("Paper Cities", null, null)).toBe("paper cities||");
  });
});

describe("lyrics cache read/write (KTD-3)", () => {
  it("a cached hit within TTL is served without re-querying LRCLIB", async () => {
    const model = makeModel();
    const prisma = makePrisma({ lyricsCache: model.model });
    const now = new Date("2026-07-17T00:00:00Z");

    expect(await readLyricsCache("Song", "Artist", 200, prisma, now)).toBeNull();

    await writeLyricsCache(
      "Song",
      "Artist",
      200,
      { found: true, syncedLyrics: "[00:01.00]line", plainLyrics: "line" },
      prisma,
      60_000,
      now,
    );

    const hit = await readLyricsCache("Song", "Artist", 200, prisma, new Date(now.getTime() + 1000));
    expect(hit).toEqual({ found: true, syncedLyrics: "[00:01.00]line", plainLyrics: "line" });
    expect(model.rows).toHaveLength(1);
  });

  it("caches a confirmed MISS so the honest empty state (R7/AE2) is served from cache", async () => {
    const model = makeModel();
    const prisma = makePrisma({ lyricsCache: model.model });
    const now = new Date("2026-07-17T00:00:00Z");

    await writeLyricsCache(
      "No Lyrics Song",
      "Artist",
      180,
      { found: false, syncedLyrics: null, plainLyrics: null },
      prisma,
      60_000,
      now,
    );

    const hit = await readLyricsCache("No Lyrics Song", "Artist", 180, prisma, now);
    expect(hit).not.toBeNull();
    expect(hit!.found).toBe(false); // a real hit — no re-query, honest "no lyrics"
  });
});
