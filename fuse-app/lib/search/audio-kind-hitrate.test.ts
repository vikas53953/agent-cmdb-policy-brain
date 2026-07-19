import { describe, expect, it } from "vitest";
import { classifyYouTubeKind, isSongResult, filterByKind } from "@/lib/search/audio-kind";
import type { TrackRef } from "@/lib/repos/track";

// F-0 item 2 CORRECTS owner fix 9. Fix 9 broadened the classifier to call many title
// keywords ("Lyrical Video", "Full Song", "Jukebox", "[Audio]", "Visualizer") Audio so the
// Songs filter looked full — but that MISLABELLED fan/lyrics uploads as Audio (the owner's
// Softly case). The honest rule is stricter: Audio ONLY for a "- Topic" channel or an
// explicit "Official Audio". Under-labelling a real song as Video is far better than
// confidently calling a lyrics upload Audio. These pin the corrected behaviour.

const yt = (title: string, artist: string | null = "Some Channel"): TrackRef => ({
  source: "youtube",
  nativeId: title,
  title,
  artist,
  artUrl: null,
  durationSec: 200,
});

describe("audio-kind classifier — the tightened, honest rule (F-0 item 2)", () => {
  it("classifies ONLY Topic uploads and explicit 'Official Audio' as audio", () => {
    expect(classifyYouTubeKind("Boyfriend (Official Audio)", "Some Channel")).toBe("audio");
    expect(classifyYouTubeKind("Boyfriend", "Karan Aujla - Topic")).toBe("audio");
  });

  it("no longer mislabels lyric / visualizer / jukebox / bare-audio titles as audio", () => {
    const nowVideo = [
      "Boyfriend | Lyrical Video",
      "Some Song (Full Song)",
      "Some Song - Audio Song",
      "Album Name (Jukebox)",
      "Song Name [Audio]",
      "Song Name (Visualizer)",
    ];
    for (const t of nowVideo) {
      expect(classifyYouTubeKind(t, "Some Channel")).toBe("video");
    }
  });

  it("still treats a plain music video as a video", () => {
    expect(classifyYouTubeKind("Boyfriend (Official Video)", "Some Channel")).toBe("video");
    expect(classifyYouTubeKind("Boyfriend (Official Music Video)", "Some Channel")).toBe("video");
  });

  it("a Topic-channel upload is always a song", () => {
    expect(isSongResult(yt("Boyfriend", "Karan Aujla - Topic"))).toBe(true);
  });

  it("the Songs filter keeps ONLY genuinely-official audio + non-YouTube rows", () => {
    const results = [
      yt("Boyfriend (Official Video)"), // video
      yt("Boyfriend (Official Audio)"), // audio (song)
      yt("Boyfriend | Lyrical Video"), // now video (was wrongly audio under fix 9)
      yt("Boyfriend", "Karan Aujla - Topic"), // audio (song)
    ];
    const songs = filterByKind(results, "songs");
    const videos = filterByKind(results, "videos");
    // Two genuine songs (Official Audio + Topic); the lyrical upload is now honestly a video.
    expect(songs.map((t) => t.nativeId)).toEqual([
      "Boyfriend (Official Audio)",
      "Boyfriend",
    ]);
    expect(videos).toHaveLength(2);
  });
});
