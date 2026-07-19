// Audio-vs-video honesty for search results (Complaint 1 — audio-first).
//
// YouTube's terms require the playing video stay visible, so true hidden-audio is
// impossible. But YouTube Music's own catalog already lives on YouTube AS "audio
// tracks": the auto-generated "<Artist> - Topic" channel uploads and art-tracks
// (a static album cover over the audio). This module decides, from a result's plain
// fields, whether a YouTube result is one of those audio-first uploads or an ordinary
// video — so the UI can (a) label the row honestly AUDIO vs VIDEO, (b) present an
// audio track art-forward in Now Playing, and (c) let the orchestrator boost audio
// versions when the user prefers them.
//
// Pure and framework-free (no DOM, no network) so it is unit-tested in node and reused
// by the search orchestrator, the result row, and Now Playing without duplication.

import type { TrackRef } from "@/lib/repos/track";

// How a track is presented. "audio" = an official audio upload (Topic channel or an
// "official audio" / art-track title); "video" = an ordinary music video.
export type TrackKind = "audio" | "video";

// Human-facing labels for the two kinds (shown verbatim on rows, so a copy change that
// would break a contract fails a test rather than slipping through).
export const KIND_LABEL: Record<TrackKind, string> = {
  audio: "Audio",
  video: "Video",
};

// A channel that is an auto-generated "<Artist> - Topic" channel — YouTube's own
// art-track uploads, which are audio with a static cover. Matched case-insensitively
// on the trimmed channel/artist name.
function isTopicChannel(artist: string | null): boolean {
  if (!artist) return false;
  return /\s-\s*topic$/i.test(artist.trim());
}

// The ONLY title marker trusted as audio: an explicit "Official Audio" (in parentheses,
// brackets, or as a bare phrase). This is the F-0 item-2 correction to the owner's Softly
// case — a lyrics/fan upload whose title merely CONTAINS a word like "Audio", "Lyrical",
// "Full Song", "Visualizer" or "Jukebox" was being MISLABELLED Audio. Title keywords alone
// are never enough now: only a genuine "Official Audio" self-label counts, and the far
// stronger signal is the "- Topic" channel. Everything else is a Video until proven
// otherwise — honest under-labelling beats confident mislabelling.
const OFFICIAL_AUDIO_TITLE_RE = /(?:^|[\s([\[|])official\s+audio(?:$|[\s)\]|])/i;

function isOfficialAudioTitle(title: string): boolean {
  return OFFICIAL_AUDIO_TITLE_RE.test(title);
}

// Classify a YouTube result from its title + channel name. This is the single decision
// point; the higher-level `trackKind` narrows by source. Audio ONLY for a "- Topic" channel
// upload (YouTube's own art-track catalogue) or an explicit "Official Audio" self-label —
// NEVER from an incidental title keyword (F-0 item 2).
export function classifyYouTubeKind(title: string, artist: string | null): TrackKind {
  return isTopicChannel(artist) || isOfficialAudioTitle(title) ? "audio" : "video";
}

// The presented kind of a track, or null when the source has no audio/video distinction
// to make honestly. Only YouTube uploads carry the distinction here: Spotify results are
// heard as their matched YouTube version (a separate honesty already stated by the
// player), and local files never appear in search. Returning null keeps the UI from
// slapping a made-up label on a row whose kind it cannot honestly know.
export function trackKind(track: TrackRef): TrackKind | null {
  if (track.source !== "youtube") return null;
  return classifyYouTubeKind(track.title, track.artist);
}

// Does a track present as audio-first? Convenience for surfaces (Now Playing) that only
// need the boolean. A non-YouTube track is never treated as audio-first here.
export function isAudioTrack(track: TrackRef): boolean {
  return trackKind(track) === "audio";
}

// The result-filter chips a person can narrow by (Wave 1 — search extras): everything,
// just songs, or just videos. Built directly on the audio-vs-video classifier above so
// the filter and the row labels can never disagree about what a track is.
export type ResultFilter = "all" | "songs" | "videos";

// Does a track count as a "song" (audio-first) for the filter? A YouTube video is the
// only thing that is NOT a song here: Topic-channel / official-audio YouTube uploads,
// Spotify tracks (heard as their matched YouTube audio), and local files are all songs.
// This keeps the filter HONEST — "Videos" shows exactly the rows the app also labels
// VIDEO, and "Songs" shows everything else.
export function isSongResult(track: TrackRef): boolean {
  return trackKind(track) !== "video";
}

// Apply a result filter, preserving order. "all" returns the list unchanged.
export function filterByKind(
  results: readonly TrackRef[],
  filter: ResultFilter,
): TrackRef[] {
  if (filter === "all") return [...results];
  if (filter === "songs") return results.filter((t) => isSongResult(t));
  return results.filter((t) => trackKind(t) === "video");
}

// Stable audio-first reordering of a combined result list. Preserves each track's
// relative order within its group (a stable partition), so the reorder is fully
// deterministic and testable: audio-first when `preferAudio`, otherwise the list is
// returned unchanged. Only YouTube results can be "audio"; everything else stays in the
// non-audio group, keeping its place.
export function orderByAudioPreference(
  results: readonly TrackRef[],
  preferAudio: boolean,
): TrackRef[] {
  if (!preferAudio) return [...results];
  const audio: TrackRef[] = [];
  const rest: TrackRef[] = [];
  for (const track of results) {
    if (trackKind(track) === "audio") audio.push(track);
    else rest.push(track);
  }
  return [...audio, ...rest];
}
