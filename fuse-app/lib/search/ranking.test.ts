import { describe, expect, it } from "vitest";
import { rankResults, relevanceLevel, officialTier } from "@/lib/search/ranking";
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
