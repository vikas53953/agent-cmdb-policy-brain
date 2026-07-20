import { describe, expect, it } from "vitest";
import { rankResults, relevanceLevel, officialTier, queryIsPrimarySubject } from "@/lib/search/ranking";
import { classifyYouTubeKind } from "@/lib/search/audio-kind";
import type { TrackRef } from "@/lib/repos/track";

// F-0 item 2, the owner's exact case: searching "Softly" (Karan Aujla), a lyrics upload
// titled "Chunni Meri Rang De …" — which merely CONTAINS the word Softly — outranked the
// real official "SOFTLY" video AND was mislabelled Audio. These pin both the ranking and
// the classifier truth.

const yt = (nativeId: string, title: string, artist: string | null): TrackRef => ({
  source: "youtube",
  nativeId,
  title,
  artist,
  artUrl: null,
  durationSec: null,
});

describe("relevanceLevel — the query-title relevance that beats keyword-stuffing", () => {
  it("scores an exact title match highest, a coincidence lowest", () => {
    expect(relevanceLevel("Softly", "Softly")).toBe(3); // title IS the query
    expect(relevanceLevel("Softly", "Softly (Official Video)")).toBe(2); // starts with query
    // A single query word appearing anywhere is a contiguous run → still a solid match (2).
    expect(relevanceLevel("Softly", "Chunni Meri Rang De Softly Wargi")).toBe(2);
    // Multi-word query whose words are all present but SCATTERED (not contiguous) → 1.
    expect(relevanceLevel("Softly Karan", "Karan sings Softly tonight")).toBe(1);
    // Only SOME query words present → a keyword coincidence (0), the thing we push down.
    expect(relevanceLevel("Softly Karan Aujla", "Some Song feat Softly")).toBe(0);
  });
});

describe("officialTier — Topic/official-audio first, junk last", () => {
  it("ranks Topic / official audio above official video above lyrics", () => {
    expect(officialTier(yt("a", "Softly", "Karan Aujla - Topic"))).toBe(4);
    expect(officialTier(yt("b", "Softly (Official Audio)", "Karan Aujla"))).toBe(4);
    expect(officialTier(yt("c", "Softly (Official Video)", "Karan Aujla"))).toBe(3);
    expect(officialTier(yt("d", "Softly Lyrics", "RandomFan"))).toBe(0);
  });
});

describe("rankResults — the owner's Softly case", () => {
  it("floats the official SOFTLY above a keyword-coincidence lyrics upload", () => {
    // The BAD result the owner saw first: a lyrics upload merely containing the word.
    const coincidence = yt(
      "bad",
      "Chunni Meri Rang De Softly Wargi (Lyrics)",
      "Punjabi Lyrics World",
    );
    // The RIGHT result: the official "SOFTLY" (Topic / official audio).
    const official = yt("good", "Softly", "Karan Aujla - Topic");
    const officialVideo = yt("vid", "Softly (Official Video)", "Karan Aujla");

    // Feed them in the WRONG order (coincidence first, as the owner saw).
    const ranked = rankResults("Softly", [coincidence, officialVideo, official]);
    // The exact-title Topic upload wins; the official video is next; the coincidence is LAST.
    expect(ranked.map((r) => r.nativeId)).toEqual(["good", "vid", "bad"]);
  });

  it("the classifier NEVER labels the coincidence lyrics upload as Audio (title keyword alone)", () => {
    // "Chunni … Softly … (Lyrics)" is a fan lyrics upload — must be Video, not Audio.
    expect(
      classifyYouTubeKind("Chunni Meri Rang De Softly Wargi (Lyrics)", "Punjabi Lyrics World"),
    ).toBe("video");
    // Only a real Topic upload or an explicit "Official Audio" is Audio.
    expect(classifyYouTubeKind("Softly", "Karan Aujla - Topic")).toBe("audio");
    expect(classifyYouTubeKind("Softly (Official Audio)", "Karan Aujla")).toBe("audio");
  });

  it("is stable — rows that tie on relevance and tier keep their original order", () => {
    const a = yt("a", "Nonmatch One", "Chan A");
    const b = yt("b", "Nonmatch Two", "Chan B");
    expect(rankResults("zzz", [a, b]).map((r) => r.nativeId)).toEqual(["a", "b"]);
  });

  it("preferAudio only breaks a FULL tie (never overrides relevance or tier)", () => {
    const video = yt("v", "Song X (Official Video)", "Band");
    const audio = yt("au", "Song X (Official Audio)", "Band");
    // Same relevance (both start with the query); official audio (tier 4) already beats
    // official video (tier 3), so audio leads regardless of the flag.
    expect(rankResults("Song X", [video, audio]).map((r) => r.nativeId)).toEqual(["au", "v"]);
  });
});

// The overnight QA: across four real searches the OFFICIAL artist upload was ranked 2nd–4th
// under lyrics/aggregator re-uploads. Each case is pinned with the real-world channel + title
// SHAPES the QA observed — a re-upload that keyword-stuffs the artist into its TITLE, and an
// official upload whose title is clean/decorated. The official row must be FIRST.
// The stuffing defence, stated as a general rule and guarded by counter-examples. Nothing
// here (or in ranking.ts) knows any particular song, artist or channel.
describe("queryIsPrimarySubject — 'IS the song' vs 'merely CONTAINS the words'", () => {
  it("rejects a title whose head names a different work and only trails the query words", () => {
    expect(
      queryIsPrimarySubject(
        "Softly Karan Aujla",
        yt(
          "x",
          "Chunni Meri Rang De Lalariya (Official Video) Softly Karan Aujla Song | Chuni Meri Rangde Full Song",
          "Vital Music",
        ),
      ),
    ).toBe(false);
    // Same shape, entirely different words — the rule is about structure, not vocabulary.
    expect(
      queryIsPrimarySubject(
        "Blinding Lights",
        yt("y", "Some Other Track (Official Video) Blinding Lights Song | Best Hits", "Random Uploads"),
      ),
    ).toBe(false);
  });

  it("does NOT demote legitimate titles", () => {
    const legit: TrackRef[] = [
      yt("a", "SOFTLY - Karan Aujla (Lyrics)", "SomeChannel"),
      yt("b", "SOFTLY (Official Music Video)", "Karan Aujla"),
      yt("c", "Karan Aujla - Softly (Full Song) | Latest Punjabi Song 2024", "PRABXDEEP"),
      yt("d", "Softly - Karan Aujla | New Punjabi Song", "Indie India"),
      yt("e", "Karan Aujla Softly Lyrics", "Musicgenree"),
    ];
    for (const t of legit) {
      expect(queryIsPrimarySubject("Softly Karan Aujla", t)).toBe(true);
    }
    // Generic "Artist - Song (Official Music Video)" shape.
    expect(
      queryIsPrimarySubject("Some Artist Some Song", yt("f", "Some Artist - Some Song (Official Music Video)", "Some Artist")),
    ).toBe(true);
    // Decorated official whose head is the song and whose extras are pipe-separated.
    expect(
      queryIsPrimarySubject("Kesariya", yt("g", "Kesariya (Full Video) | Brahmastra | Ranbir | Alia", "SonyMusicIndiaVEVO")),
    ).toBe(true);
    // "Full Video: Song" — a colon is NOT a head break.
    expect(queryIsPrimarySubject("Kesariya", yt("h", "Full Video: Kesariya | Brahmastra", "T-Series"))).toBe(true);
  });

  it("never judges a row the CHANNEL already answers (artist-only queries stay safe)", () => {
    // Query is just the artist (exactly what radio seeds with): the artist's own upload of a
    // different song, with the artist trailing, must NOT be treated as stuffing.
    expect(
      queryIsPrimarySubject("Karan Aujla", yt("i", "Winning Speech (Official Video) | Karan Aujla", "Karan Aujla")),
    ).toBe(true);
    // A title that never mentions the query at all (matched purely via the channel) is untouched.
    expect(queryIsPrimarySubject("Karan Aujla", yt("j", "SOFTLY", "Karan Aujla - Topic"))).toBe(true);
    // ...but the same artist-only query still catches a stuffer on an unrelated channel.
    expect(
      queryIsPrimarySubject(
        "Karan Aujla",
        yt("k", "Chunni Meri Rang De Lalariya (Official Video) Karan Aujla Song | Full Song", "Vital Music"),
      ),
    ).toBe(false);
  });
});

describe("rankResults — overnight QA: the official artist is ALWAYS the first row", () => {
  it("Case 1 — 'Karan Aujla Softly': official 'SOFTLY' (channel 'Karan Aujla') beats the re-uploads", () => {
    const official = yt("official", "SOFTLY (Official Music Video)", "Karan Aujla");
    const prabxdeep = yt("prabx", "Karan Aujla - Softly (Full Song) | Latest Punjabi Song 2024", "PRABXDEEP");
    const indie = yt("indie", "Softly - Karan Aujla | New Punjabi Song", "Indie India");
    const genree = yt("genree", "Karan Aujla Softly Lyrics", "Musicgenree");
    // Fed in the WRONG order the QA saw (official last). preferAudio ON, as in production.
    const ranked = rankResults(
      "Karan Aujla Softly",
      [prabxdeep, indie, genree, official],
      { preferAudio: true },
    );
    expect(ranked[0].nativeId).toBe("official");
  });

  it("Case 2 — 'AP Dhillon Excuses': official beats a 'ChillPind (Official Audio)' re-upload", () => {
    const official = yt("official", "Excuses (Official Video)", "AP Dhillon");
    // The re-upload writes "Official Audio" into its own TITLE — it must NOT beat the real channel.
    const chillpind = yt("chill", "AP Dhillon - Excuses (Official Audio)", "ChillPind");
    const ranked = rankResults("AP Dhillon Excuses", [chillpind, official], { preferAudio: true });
    expect(ranked[0].nativeId).toBe("official");
  });

  it("Case 3 — 'Kesariya': official VEVO beats a 7clouds lyrics upload with a tighter title", () => {
    const official = yt("official", "Kesariya (Full Video) | Brahmastra | Ranbir | Alia", "SonyMusicIndiaVEVO");
    // 7clouds crafts a minimal, exact-ish title — a higher fine-relevance than the decorated
    // official — but it is a lyrics re-upload on an unverified channel, so it ranks below.
    const sevenclouds = yt("7c", "Kesariya (Lyrics) - Arijit Singh", "7clouds");
    const ranked = rankResults("Kesariya", [sevenclouds, official], { preferAudio: true });
    expect(ranked[0].nativeId).toBe("official");
  });

  it("Case 4 — 'Anti-Hero': the official 'Taylor Swift' upload beats a LatinHype lyrics video", () => {
    const official = yt("official", "Anti-Hero (Official Music Video)", "Taylor Swift");
    const latinhype = yt("latin", "Anti-Hero (Lyrics)", "LatinHype");
    const ranked = rankResults("Anti-Hero", [latinhype, official], { preferAudio: true });
    expect(ranked[0].nativeId).toBe("official");
  });

  it("Case 1b — the LIVE #2 bug: a keyword-stuffed unrelated track cannot sit under the official row", () => {
    // Observed in production on the owner's exact query. Head names a DIFFERENT song; the
    // query words are bolted on as a trailing keyword clause; the uploader self-labels
    // "(Official Video)" (tier 3) so it used to rank straight under the official track.
    const official = yt("official", "SOFTLY (Official Music Video)", "Karan Aujla");
    const stuffed = yt(
      "stuffed",
      "Chunni Meri Rang De Lalariya (Official Video) Softly Karan Aujla Song | Chuni Meri Rangde Full Song",
      "Vital Music",
    );
    const genuineRepost = yt("repost", "Softly - Karan Aujla | New Punjabi Song", "Indie India");
    const ranked = rankResults(
      "Softly Karan Aujla",
      [stuffed, genuineRepost, official],
      { preferAudio: true },
    );
    // Official first (unchanged), the genuine repost second, the stuffed title LAST.
    expect(ranked.map((r) => r.nativeId)).toEqual(["official", "repost", "stuffed"]);
  });

  it("still gates on relevance — a wrong-song official upload can never jump a right-song row", () => {
    // An official upload for a DIFFERENT song must not leapfrog the actual match just because
    // its channel is verified. `coversQuery` keeps authenticity from overriding relevance.
    const wrongOfficial = yt("wrong", "Winning Speech (Official Video)", "Karan Aujla");
    const rightRepost = yt("right", "Karan Aujla - Softly (Full Song)", "PRABXDEEP");
    const ranked = rankResults("Karan Aujla Softly", [wrongOfficial, rightRepost], { preferAudio: true });
    expect(ranked[0].nativeId).toBe("right");
  });
});
