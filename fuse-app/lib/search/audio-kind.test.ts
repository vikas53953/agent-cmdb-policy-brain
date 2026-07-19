import { describe, it, expect } from "vitest";
import {
  classifyYouTubeKind,
  trackKind,
  isAudioTrack,
  orderByAudioPreference,
  filterByKind,
  isSongResult,
  KIND_LABEL,
} from "./audio-kind";
import type { TrackRef } from "@/lib/repos/track";

const yt = (title: string, artist: string | null): TrackRef => ({
  source: "youtube",
  nativeId: "abc",
  title,
  artist,
  artUrl: null,
  durationSec: null,
});

describe("classifyYouTubeKind — Topic channels and audio titles are AUDIO", () => {
  it("treats a '<Artist> - Topic' channel as audio", () => {
    expect(classifyYouTubeKind("Paper Cities", "Aurora Skies - Topic")).toBe("audio");
    expect(classifyYouTubeKind("Paper Cities", "Aurora Skies - topic")).toBe("audio");
  });

  it("treats an explicit 'Official Audio' self-label as audio", () => {
    expect(classifyYouTubeKind("Paper Cities (Official Audio)", "Aurora Skies")).toBe("audio");
    expect(classifyYouTubeKind("Paper Cities [Official Audio]", "Aurora Skies")).toBe("audio");
    expect(classifyYouTubeKind("Paper Cities | Official Audio", "Aurora Skies")).toBe("audio");
  });

  it("NEVER labels audio from an incidental title keyword alone (F-0 item 2)", () => {
    // These were mislabelled Audio before F-0 — a bare "(Audio)", a lyric/visualizer, a
    // "Full Song" / "Jukebox". Title keywords alone are no longer enough: only "- Topic" or
    // an explicit "Official Audio" counts. All of these are now honestly Video.
    expect(classifyYouTubeKind("Paper Cities [Audio]", "Aurora Skies")).toBe("video");
    expect(classifyYouTubeKind("Paper Cities (Audio)", "Aurora Skies")).toBe("video");
    expect(classifyYouTubeKind("Paper Cities - Audio Only", "Aurora Skies")).toBe("video");
    expect(classifyYouTubeKind("Paper Cities (Visualizer)", "Aurora Skies")).toBe("video");
    expect(classifyYouTubeKind("Paper Cities (Lyric Video)", "Aurora Skies")).toBe("video");
    expect(classifyYouTubeKind("Paper Cities (Full Song)", "Aurora Skies")).toBe("video");
    expect(classifyYouTubeKind("Paper Cities (Jukebox)", "Aurora Skies")).toBe("video");
  });

  it("treats an ordinary music video as video (never over-labels audio)", () => {
    expect(classifyYouTubeKind("Paper Cities (Official Video)", "Aurora Skies")).toBe("video");
    expect(classifyYouTubeKind("Paper Cities (Official Music Video)", "Aurora Skies")).toBe("video");
    expect(classifyYouTubeKind("Paper Cities live at Wembley", "Aurora Skies VEVO")).toBe("video");
    // "audiobook" must not trip the audio matcher (word-boundary safety).
    expect(classifyYouTubeKind("The Great Audiobook chapter 1", "Some Reader")).toBe("video");
  });
});

describe("trackKind / isAudioTrack — only YouTube carries a kind", () => {
  it("returns null for non-YouTube sources", () => {
    const sp: TrackRef = {
      source: "spotify",
      nativeId: "spotify:track:1",
      title: "Anything (Official Audio)",
      artist: "Artist - Topic",
      artUrl: null,
      durationSec: null,
    };
    expect(trackKind(sp)).toBeNull();
    expect(isAudioTrack(sp)).toBe(false);
  });

  it("classifies YouTube tracks by title/channel", () => {
    expect(trackKind(yt("Song", "Band - Topic"))).toBe("audio");
    expect(isAudioTrack(yt("Song", "Band - Topic"))).toBe(true);
    expect(trackKind(yt("Song (Official Video)", "Band"))).toBe("video");
    expect(isAudioTrack(yt("Song (Official Video)", "Band"))).toBe(false);
  });

  it("exposes stable human labels", () => {
    expect(KIND_LABEL.audio).toBe("Audio");
    expect(KIND_LABEL.video).toBe("Video");
  });
});

describe("orderByAudioPreference — deterministic, stable audio-first partition", () => {
  const list: TrackRef[] = [
    yt("A (Official Video)", "Band"), // video
    yt("B", "Band - Topic"), // audio
    yt("C (Official Audio)", "Band"), // audio
    yt("D live", "Band"), // video
  ];

  it("returns the list unchanged when the user does NOT prefer audio", () => {
    const out = orderByAudioPreference(list, false);
    expect(out.map((t) => t.title)).toEqual([
      "A (Official Video)",
      "B",
      "C (Official Audio)",
      "D live",
    ]);
  });

  it("floats audio versions to the top, preserving relative order within each group", () => {
    const out = orderByAudioPreference(list, true);
    expect(out.map((t) => t.title)).toEqual([
      "B", // first audio, kept before C
      "C (Official Audio)",
      "A (Official Video)", // first video, kept before D
      "D live",
    ]);
  });

  it("does not mutate the input", () => {
    const before = list.map((t) => t.title);
    orderByAudioPreference(list, true);
    expect(list.map((t) => t.title)).toEqual(before);
  });
});

describe("filterByKind — the All / Songs / Videos result filter (Wave 1)", () => {
  const audioYt: TrackRef = { source: "youtube", nativeId: "a1", title: "Song (Official Audio)", artist: "X", artUrl: null, durationSec: null };
  const videoYt: TrackRef = { source: "youtube", nativeId: "v1", title: "Song (Official Video)", artist: "X", artUrl: null, durationSec: null };
  const spotify: TrackRef = { source: "spotify", nativeId: "s1", title: "Song", artist: "X", artUrl: null, durationSec: null };
  const list = [videoYt, audioYt, spotify];

  it("'all' returns the list unchanged", () => {
    expect(filterByKind(list, "all").map((t) => t.nativeId)).toEqual(["v1", "a1", "s1"]);
  });

  it("'videos' keeps only YouTube video-kind rows", () => {
    expect(filterByKind(list, "videos").map((t) => t.nativeId)).toEqual(["v1"]);
  });

  it("'songs' keeps audio YouTube AND non-YouTube (Spotify) rows — everything that is not a video", () => {
    expect(filterByKind(list, "songs").map((t) => t.nativeId)).toEqual(["a1", "s1"]);
    expect(isSongResult(spotify)).toBe(true);
    expect(isSongResult(videoYt)).toBe(false);
  });
});
