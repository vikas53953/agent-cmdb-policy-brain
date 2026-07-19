import { describe, expect, it } from "vitest";
import { classifyYouTubeKind, isSongResult, filterByKind } from "@/lib/search/audio-kind";
import type { TrackRef } from "@/lib/repos/track";

// Owner fix 9: the "Songs" filter showed nothing. The classifier under-counted audio-first
// uploads, so the Songs pane was empty for real queries. These cases pin the broadened,
// still-honest hit-rate against realistic YouTube titles (kept THIN — the Song-identity layer
// will re-architect this area). The rule stays: a plain music video is NOT a "song" here.

const yt = (title: string, artist: string | null = "Some Channel"): TrackRef => ({
  source: "youtube",
  nativeId: title,
  title,
  artist,
  artUrl: null,
  durationSec: 200,
});

describe("audio-kind classifier hit-rate (owner fix 9)", () => {
  it("classifies common audio-first uploads as audio (songs)", () => {
    const audioTitles = [
      "Boyfriend (Official Audio)",
      "Boyfriend | Lyrical Video",
      "Some Song (Full Song)",
      "Some Song - Audio Song",
      "Album Name (Jukebox)",
      "Song Name [Audio]",
      "Song Name (Visualizer)",
    ];
    for (const t of audioTitles) {
      expect(classifyYouTubeKind(t, "Some Channel")).toBe("audio");
    }
  });

  it("still treats a plain music video as a video (Videos pane stays real)", () => {
    expect(classifyYouTubeKind("Boyfriend (Official Video)", "Some Channel")).toBe("video");
    expect(classifyYouTubeKind("Boyfriend (Official Music Video)", "Some Channel")).toBe("video");
  });

  it("a Topic-channel upload is always a song", () => {
    expect(isSongResult(yt("Boyfriend", "Karan Aujla - Topic"))).toBe(true);
  });

  it("the Songs filter is populated when audio-first results are present", () => {
    const results = [
      yt("Boyfriend (Official Video)"),
      yt("Boyfriend (Official Audio)"),
      yt("Boyfriend | Lyrical Video"),
      yt("Boyfriend", "Karan Aujla - Topic"),
    ];
    const songs = filterByKind(results, "songs");
    const videos = filterByKind(results, "videos");
    // Three of the four are songs; the plain video is the only "video".
    expect(songs).toHaveLength(3);
    expect(videos).toHaveLength(1);
  });
});
