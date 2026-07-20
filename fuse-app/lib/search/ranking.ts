// Brutal search ranking (F-0 item 2, hardened by the overnight QA) — the fix for the
// owner's Softly / Karan Aujla case, where the OFFICIAL artist upload was never the first
// row.
//
// WHAT THE QA CAUGHT (and the earlier version still got wrong): across four real searches
// the official channel was ranked 2nd–4th under lyrics/aggregator re-uploads —
//   • "Karan Aujla Softly" → official "SOFTLY" (channel "Karan Aujla") sat at #4 under
//     PRABXDEEP / Indie India / Musicgenree re-uploads.
//   • "AP Dhillon Excuses" → official #2 behind a ChillPind re-upload titled "…(Official Audio)".
//   • "Kesariya" → SonyMusicIndiaVEVO #2 behind a 7clouds lyrics video.
//   • "Anti-Hero" → the official "Taylor Swift" upload #2 behind a LatinHype lyrics video.
//
// TWO ROOT CAUSES, both fixed here:
//   1. RELEVANCE IGNORED THE CHANNEL. `relevanceLevel` scored the TITLE only. So when the
//      query names the artist ("Karan Aujla Softly") the official upload — whose title is
//      just the song ("SOFTLY") — scored 0, while a re-upload that stuffs "Karan Aujla -
//      Softly" into its TITLE scored 2. `rankResults` now credits query words matched by
//      the channel/artist too, so the official upload is recognised as a full match.
//   2. RELEVANCE OUTRANKED OFFICIALNESS. Relevance was the primary sort key, so a re-upload
//      that crafts a tighter title (exact "Kesariya", or "Artist - Song") beat a verified
//      official upload carrying a decorated title. `rankResults` now sorts VERIFIED-CHANNEL
//      authenticity ABOVE the fine title relevance: among results that genuinely match the
//      query, the artist's own / Topic / VEVO / official channel wins even when a re-upload
//      has a keyword-perfect title. Relevance still gates (a wrong-song official can never
//      jump a right-song row) and still orders rows of equal authenticity + tier.
//
// Pure and framework-free so the ordering is unit-tested in node (all four QA cases are
// pinned in ranking.test.ts). The orchestrator applies this as the presentation order; the
// cache stores the raw rows, so ranking is always computed fresh per request.

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
//
// TITLE-ONLY on purpose: this is the *fine* tiebreak among rows that already matched the
// query. Whether a row matches AT ALL (which must also credit the channel/artist) is a
// separate, coarser signal computed in `rankResults` — see `coversQuery`.
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

// Does this result genuinely match the SONG asked for? True when every query word appears
// somewhere across the TITLE **and** the CHANNEL/ARTIST together. This is what rescues the
// official "SOFTLY" by "Karan Aujla" on a query of "Karan Aujla Softly": the title alone
// misses "karan"/"aujla", but the channel supplies them. It is the coarse yes/no gate that
// sorts real matches above coincidences, so a verified-but-decorated official row is never
// mistaken for a non-match. Exported for the ranking tests.
export function coversQuery(query: string, track: TrackRef): boolean {
  const q = tokens(query);
  if (q.length === 0) return false;
  const haystack = new Set([...tokens(track.title), ...tokens(track.artist)]);
  return q.every((w) => haystack.has(w));
}

// Titles that mark a NON-official upload — pushed below ordinary results. Word-boundary
// matched so "cover" in a song title is unlikely to false-trip on these specific phrases.
const NON_OFFICIAL_TITLE_RE =
  /\b(lyrics?|lyrical|cover|reaction|remix|mashup|sped\s*up|slowed|reverb|8d\s*audio|karaoke|instrumental|whatsapp\s*status|status\s*video|short|shorts|fan\s*made|unofficial|compilation|mix|megamix|jukebox|full\s*album|live)\b/i;

// Titles that advertise the official music video.
const OFFICIAL_VIDEO_TITLE_RE =
  /\bofficial\s+(music\s+)?video\b/i;

// A channel that reads as an official/verified artist or label channel by its NAME ALONE:
// YouTube "- Topic" art-track channels, VEVO channels, or a name ending in "Official".
function looksOfficialChannelByName(artist: string | null): boolean {
  if (!artist) return false;
  const a = artist.trim();
  return /\s-\s*topic$/i.test(a) || /vevo$/i.test(a.replace(/\s+/g, "")) || /\bofficial\b/i.test(a);
}

// Is this the ARTIST'S OWN channel for THIS query? True when the whole channel name is
// contained in the query — e.g. query "Karan Aujla Softly", channel "Karan Aujla". This is
// the query-aware half of official detection: a re-upload's channel ("PRABXDEEP", "7clouds",
// "LatinHype") is not named in the query, so it never trips this, while the artist's own
// channel does. Requires the channel to have at least one token and every token to be a
// query word.
function isQueryArtistChannel(query: string, artist: string | null): boolean {
  const channel = tokens(artist);
  if (channel.length === 0) return false;
  const q = new Set(tokens(query));
  return channel.every((w) => q.has(w));
}

// VERIFIED-CHANNEL authenticity: 1 when the row is on a channel we can positively tie to the
// artist/label (Topic / VEVO / "…Official" / the artist channel named in the query), else 0.
// This ranks ABOVE the title-based `officialTier` in `rankResults`, so a re-upload cannot
// beat the real channel merely by writing "(Official Audio)" or a keyword-perfect title into
// its own title — the QA's exact failure. Exported for the ranking tests.
export function channelAuthenticity(query: string, track: TrackRef): number {
  if (track.source !== "youtube") return 0;
  return looksOfficialChannelByName(track.artist) || isQueryArtistChannel(query, track.artist) ? 1 : 0;
}

// The official-ness tier for a result, from its TITLE + channel NAME (query-independent, so
// the pinned unit tests keep their exact values). Higher ranks first among comparably-
// authentic, comparably-relevant rows.
//   4 — official audio (a "- Topic" upload or an "Official Audio" self-label).
//   3 — an official music VIDEO, or a plainly official/verified channel (by name).
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
  if (OFFICIAL_VIDEO_TITLE_RE.test(title) || looksOfficialChannelByName(track.artist)) return 3;
  if (NON_OFFICIAL_TITLE_RE.test(title)) return 0;
  return 2;
}

export type RankOptions = {
  // A gentle FINAL tiebreak (the user's "prefer audio versions" setting): among rows of
  // equal match / authenticity / tier / relevance, float audio above video. Never overrides
  // any of the ordering signals above — those already order the important cases.
  preferAudio?: boolean;
};

function isAudioKind(track: TrackRef): boolean {
  return track.source === "youtube" && classifyYouTubeKind(track.title ?? "", track.artist) === "audio";
}

// Rank a combined result list for a query. Stable: rows that tie on every key keep their
// original (interleaved) order. Returns a new array; the input is never mutated.
//
// Sort keys, most significant first:
//   1. coversQuery — real matches (query words covered by title+artist) above coincidences.
//   2. authenticity — the artist's own / Topic / VEVO / official channel above re-uploads,
//                     EVEN when the re-upload has a keyword-perfect title (the QA fix).
//   3. officialTier — official audio > official video > ordinary > lyrics/cover/fan/junk.
//   4. relevanceLevel — the fine title match (exact > prefix > all-words > partial).
//   5. audio — the gentle prefer-audio tiebreak.
//   6. index — stable within a full tie (keeps the source interleave).
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
      covers: coversQuery(query, track) ? 1 : 0,
      authenticity: channelAuthenticity(query, track),
      tier: officialTier(track),
      relevance: relevanceLevel(query, track.title ?? ""),
      audio: preferAudio && isAudioKind(track) ? 1 : 0,
    }))
    .sort(
      (a, b) =>
        b.covers - a.covers || //         1. real match beats a keyword coincidence
        b.authenticity - a.authenticity || // 2. the verified channel beats re-uploads
        b.tier - a.tier || //              3. official / Topic first, junk last
        b.relevance - a.relevance || //    4. finer title relevance
        b.audio - a.audio || //            5. gentle prefer-audio tiebreak
        a.index - b.index, //              stable within a full tie
    )
    .map((s) => s.track);
}
