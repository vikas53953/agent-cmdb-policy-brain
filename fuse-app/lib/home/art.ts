// Home cover-art resolution (R5: real cover art everywhere, never a plain box).
//
// WHY THIS EXISTS. Search renders LIVE provider results, and the YouTube adapter always
// fills `artUrl` (lib/youtube.ts snippetArt() falls back to the keyless thumbnail CDN).
// Home is different: every row is built from PERSISTED rows — Play rows and TrendingSeed
// rows — whose `artUrl` column is nullable (prisma/schema.prisma). Any row written before
// art was captured, or by a path that had no thumbnail to hand, comes back with
// artUrl = null, and the card falls through to the grey MusicIcon box. That is why Home
// could show blank covers while Search showed artwork for the very same videos.
//
// The honest fix is DERIVATION, not a nicer placeholder: a YouTube video id already
// determines its thumbnail URL (https://i.ytimg.com/vi/{id}/hqdefault.jpg — keyless and
// already allowed by img-src in lib/security-headers.ts). Deriving it invents nothing;
// it just recomputes a fact we already hold. Sources whose art cannot be derived from an
// id alone (Spotify covers, local files) keep a null artUrl and keep the icon fallback —
// we never fabricate a URL we cannot stand behind.
//
// Applied at the Home data boundary (app/(app)/page.tsx) so EVERY row benefits — recently
// played, trending/starter picks and more-like-what-you-love alike — plus in the card
// itself as the second candidate when a stored URL 404s.

import type { TrackRef } from "@/lib/repos/track";

// The keyless, CSP-allowed YouTube thumbnail for a video id. Same shape as
// lib/youtube.ts youtubeThumbnailUrl(); duplicated deliberately so the Home render path
// never has to pull in the API client (and its key handling) just to build a URL.
export function youtubeArtUrl(nativeId: string): string {
  return `https://i.ytimg.com/vi/${nativeId}/hqdefault.jpg`;
}

function isUsable(url: string | null | undefined): url is string {
  return typeof url === "string" && url.trim() !== "";
}

// The art URL we can derive from a track's identity alone, or null when the source gives
// us no honest way to do so.
export function derivedArtUrl(track: Pick<TrackRef, "source" | "nativeId">): string | null {
  if (track.source !== "youtube") return null;
  const id = track.nativeId?.trim();
  if (!id) return null;
  return youtubeArtUrl(id);
}

// Every art URL worth trying for this track, best first: the stored one (if any), then
// the derived one (if different). Empty when there is genuinely nothing to show — the
// card then renders its icon fallback, which is now a rare, honest state rather than the
// default.
export function artCandidates(track: Pick<TrackRef, "source" | "nativeId" | "artUrl">): string[] {
  const out: string[] = [];
  if (isUsable(track.artUrl)) out.push(track.artUrl.trim());
  const derived = derivedArtUrl(track);
  if (derived && !out.includes(derived)) out.push(derived);
  return out;
}

// Fill in a missing/blank `artUrl` from the track's own identity. Returns the SAME object
// when nothing needed fixing, so callers can use it freely on already-good data.
export function withResolvedArt(track: TrackRef): TrackRef {
  if (isUsable(track.artUrl)) return track;
  const derived = derivedArtUrl(track);
  if (!derived) return track;
  return { ...track, artUrl: derived };
}

// Convenience for a whole row.
export function withResolvedArtAll(tracks: readonly TrackRef[]): TrackRef[] {
  return tracks.map(withResolvedArt);
}
