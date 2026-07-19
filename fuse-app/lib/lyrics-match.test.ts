import { describe, expect, it } from "vitest";
import { parseLyricsQuery, normalizeForMatch, fetchLyricsFromLrclib } from "@/lib/lyrics";
import type { FetchLike } from "@/lib/youtube";

// Owner fix 5a: wrong lyrics. The "Karan Aujla - Boyfriend" report showed someone else's
// words. Two guards prove it here: (1) the noisy YouTube title is parsed into a clean
// artist/title, and (2) a search candidate that is NOT confidently the same song is
// rejected in favour of an honest "No lyrics".

describe("parseLyricsQuery — clean artist/title from a noisy YouTube title (owner fix 5a)", () => {
  it("splits '<Artist> - <Title>' and strips marketing junk", () => {
    expect(parseLyricsQuery("Karan Aujla - Boyfriend (Official Video)", "Some Label")).toEqual({
      artist: "Karan Aujla",
      title: "Boyfriend",
    });
  });

  it("prefers a '- Topic' channel as the clean artist and drops feat. clauses", () => {
    const out = parseLyricsQuery("Boyfriend (Official Audio) feat. Someone", "Karan Aujla - Topic");
    expect(out.artist).toBe("Karan Aujla");
    expect(out.title).toBe("Boyfriend");
  });

  it("strips pipes / lyric-video noise", () => {
    const out = parseLyricsQuery("Song Name | Lyrical Video | Big Label", null);
    expect(normalizeForMatch(out.title)).toBe("song name");
  });
});

// A tiny fake fetch: 404 the exact get, return the given records from search.
function fakeFetch(searchRecords: unknown[]): FetchLike {
  return (async (url: string) => {
    if (String(url).includes("/api/get")) {
      return { ok: false, status: 404, json: async () => null } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => searchRecords } as unknown as Response;
  }) as unknown as FetchLike;
}

describe("fetchLyricsFromLrclib — confident match gate (owner fix 5a)", () => {
  it("REJECTS a wrong-song search hit and returns an honest miss", async () => {
    // The search returns a fully-synced record, but it is a DIFFERENT song (wrong title AND
    // artist). The old behaviour showed it; the fix returns found:false instead.
    const out = await fetchLyricsFromLrclib(
      { title: "Boyfriend", artist: "Karan Aujla", durationSec: 180 },
      {
        fetch: fakeFetch([
          {
            trackName: "Someone Else's Song",
            artistName: "A Different Artist",
            syncedLyrics: "[00:01.00]not your song",
            plainLyrics: "not your song",
            instrumental: false,
            duration: 179,
          },
        ]),
      },
    );
    expect(out.ok).toBe(true);
    expect(out.ok && out.data.found).toBe(false);
  });

  it("REJECTS a same-title hit whose duration is wildly off", async () => {
    const out = await fetchLyricsFromLrclib(
      { title: "Boyfriend", artist: "Karan Aujla", durationSec: 180 },
      {
        fetch: fakeFetch([
          {
            trackName: "Boyfriend",
            artistName: "Karan Aujla",
            syncedLyrics: "[00:01.00]x",
            plainLyrics: "x",
            instrumental: false,
            duration: 320, // 140s off — not the same recording
          },
        ]),
      },
    );
    expect(out.ok && out.data.found).toBe(false);
  });

  it("ACCEPTS a confident same-song hit (title + artist + close duration)", async () => {
    const out = await fetchLyricsFromLrclib(
      { title: "Boyfriend", artist: "Karan Aujla", durationSec: 180 },
      {
        fetch: fakeFetch([
          {
            trackName: "Boyfriend",
            artistName: "Karan Aujla",
            syncedLyrics: "[00:01.00]real line",
            plainLyrics: "real line",
            instrumental: false,
            duration: 182,
          },
        ]),
      },
    );
    expect(out.ok && out.data.found).toBe(true);
    expect(out.ok && out.data.syncedLyrics).toBe("[00:01.00]real line");
  });
});
