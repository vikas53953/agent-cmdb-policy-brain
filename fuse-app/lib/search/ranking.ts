// Brutal search ranking (F-0 item 2) — the fix for the owner's Softly / Karan Aujla case,
// where a lyrics upload titled "Chunni Meri Rang De …" (merely CONTAINING the word Softly)
// outranked the actual official "SOFTLY" video.
//
// Two truths this enforces, in order:
//   1. QUERY-TITLE RELEVANCE beats keyword-stuffing. The result whose title IS the query
//      (or starts with it) beats one that merely contains a query word somewhere. This is
//      the primary sort key — it is what pushes the real "Softly" above the coincidence.
//   2. Among comparably-relevant results, OFFICIAL sources rank first: the artist's
//      "- Topic" upload / an "Official Audio" (official audio ABOVE official video), then
//      the official video, then everything ordinary, and lyrics / covers / fan uploads /
//      Shorts / compilations / reactions LAST.
//
// Pure and framework-free so the ordering is unit-tested in node (the owner's exact case is
// pinned in ranking.test.ts). The search orchestrator applies this as the presentation
// order; the cache stores the raw rows, so ranking is always computed fresh per request.

import type { TrackRef } from "@/lib/repos/track";
import { classifyYouTubeKind } from "@/lib/search/audio-kind";

// Split a string into lowercase word tokens (letters/digits), dropping punctuation so
// "Softly." and "(Softly)" both tokenise to ["softly"].
function tokens(value: string | null | undefined): string[] {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// How well a result's TITLE answers the query. Higher is better.
//   3 — the title IS the query (exact token match), ignoring order/punctuation.
//   2 — the title STARTS with the full query, or contains it as a contiguous run.
//   1 — the title contains ALL query words (somewhere), i.e. a solid match.
//   0 — only some query words appear (a keyword coincidence).
export function relevanceLevel(query: string, title: string): number {
  const q = tokens(query);
  const t = tokens(title);
  if (q.length === 0) return 0;
  const tSet = new Set(t);
  const contained = q.filter((w) => tSet.has(w)).length;

  // Exact: same set of words (the title says nothing more than the query).
  const sameLength = t.length === q.length;
  if (sameLength && contained === q.length) return 3;

  // Contiguous run of the query at the start of, or anywhere within, the title tokens.
  const startsWith = q.every((w, i) => t[i] === w);
  if (startsWith) return 2;
  const joinedQ = q.join(" ");
  const joinedT = t.join(" ");
  if (joinedT.includes(joinedQ)) return 2;

  if (contained === q.length) return 1; // all words present but scattered / with extras
  return 0; // only some words — keyword coincidence (the thing we push DOWN)
}

// Titles that mark a NON-official upload — pushed below ordinary results. Word-boundary
// matched so "cover" in a song title is unlikely to false-trip on these specific phrases.
const NON_OFFICIAL_TITLE_RE =
  /\b(lyrics?|lyrical|cover|reaction|remix|mashup|sped\s*up|slowed|reverb|8d\s*audio|karaoke|instrumental|whatsapp\s*status|status\s*video|short|shorts|fan\s*made|unofficial|compilation|mix|megamix|jukebox|full\s*album|live)\b/i;

// Titles that advertise the official music video.
const OFFICIAL_VIDEO_TITLE_RE =
  /\bofficial\s+(music\s+)?video\b/i;

// A channel that reads as an official/verified artist or label channel (Topic art-tracks,
// VEVO, or a name ending in "Official"). A soft signal — it only orders comparably-relevant
// results, never overrides relevance.
function looksOfficialChannel(artist: string | null): boolean {
  if (!artist) return false;
  const a = artist.trim();
  return /\s-\s*topic$/i.test(a) || /vevo$/i.test(a) || /\bofficial\b/i.test(a);
}

// The official-ness tier for a result. Higher ranks first among comparably-relevant rows.
//   4 — official audio (a "- Topic" upload or an "Official Audio" self-label).
//   3 — an official music VIDEO, or a plainly official/verified channel.
//   2 — ordinary (neutral) — the default, incl. non-YouTube catalogue rows (Spotify).
//   0 — a lyrics / cover / fan / Shorts / compilation / reaction upload.
export function officialTier(track: TrackRef): number {
  // Non-YouTube rows (Spotify) are legitimate official catalogue tracks but carry no
  // YouTube-style markers — treat them as neutral so they never leapfrog a genuinely
  // official YouTube result on tier alone (relevance still decides first).
  if (track.source !== "youtube") return 2;

  const title = track.title ?? "";
  // Official audio (Topic / "Official Audio") is the top tier — above the official video.
  if (classifyYouTubeKind(title, track.artist) === "audio") return 4;
  if (OFFICIAL_VIDEO_TITLE_RE.test(title) || looksOfficialChannel(track.artist)) return 3;
  if (NON_OFFICIAL_TITLE_RE.test(title)) return 0;
  return 2;
}

export type RankOptions = {
  // A gentle FINAL tiebreak (the user's "prefer audio versions" setting): among rows of
  // equal relevance AND equal official tier, float audio above video. Never overrides
  // relevance or official tier — those already order the important cases.
  preferAudio?: boolean;
};

function isAudioKind(track: TrackRef): boolean {
  return track.source === "youtube" && classifyYouTubeKind(track.title ?? "", track.artist) === "audio";
}

// Rank a combined result list for a query. Stable: rows that tie on every key keep their
// original (interleaved) order. Returns a new array; the input is never mutated.
export function rankResults(
  query: string,
  results: readonly TrackRef[],
  opts: RankOptions = {},
): TrackRef[] {
  const preferAudio = opts.preferAudio === true;
  return results
    .map((track, index) => ({
      track,
      index,
      relevance: relevanceLevel(query, track.title ?? ""),
      tier: officialTier(track),
      audio: preferAudio && isAudioKind(track) ? 1 : 0,
    }))
    .sort(
      (a, b) =>
        b.relevance - a.relevance || // 1. relevance beats keyword-stuffing
        b.tier - a.tier || //           2. official / Topic first, junk last
        b.audio - a.audio || //         3. gentle prefer-audio tiebreak
        a.index - b.index, //           stable within a full tie
    )
    .map((s) => s.track);
}
