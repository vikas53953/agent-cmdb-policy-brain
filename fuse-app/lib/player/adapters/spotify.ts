// Spotify playback adapter — the HONEST YouTube fallback (U15, R16/R17, AE5, KTD-2).
//
// Spotify's real streaming (Web Playback SDK) is Premium-only and, for a new app, is
// dev-mode capped to a handful of allowlisted users; `preview_url` is dead for new
// apps. So the ONE thing this adapter can honestly make work for everyone in this
// commit is the fallback the product contract mandates (KTD-2): when a user plays a
// Spotify track, resolve the SAME song's YouTube version and play THAT, told plainly.
//
// HOW IT PLUGS IN (KTD-6): the adapter registers itself, which flips Spotify search
// results from "Plays after Spotify support arrives" (disabled) to a real, enabled
// play button — the control lights up only because a working capability now backs it
// (R17). It implements the store's `resolvePlayable` seam: given a Spotify track it
// returns the matched YouTube `TrackRef` plus an honest label, so the store — and the
// visible-player rule (KTD-7) — operate on a real, streamable YouTube track. Because
// `resolvePlayable` always substitutes, the YouTube adapter is the true engine; this
// adapter never becomes the active player, so its transport methods are honest no-ops
// (native Spotify streaming for allowlisted Premium users is a later, separate step —
// nothing here pretends it works today).
//
// KEYLESS / NODE SAFE: module load only builds + registers the adapter object (pure).
// `resolvePlayable` guards on `fetch`; with no YouTube key the search route returns no
// match and we surface an honest "couldn't find a YouTube version" reason — never a
// throw, never a silent stick (R2/R18). Nothing here reads a secret.

import type { TrackRef } from "@/lib/repos/track";
import type {
  PlayableResolution,
  SourceAdapter,
  SourceCapabilities,
} from "@/lib/player/types";
import { adapterRegistry } from "@/lib/player/adapters";
import { SOURCE_CAPABILITIES } from "@/lib/player/capabilities";
import { logActivity } from "@/lib/activity-log";

// The Spotify column of the DJ capability matrix (single source: capabilities.ts).
export const SPOTIFY_CAPABILITIES: SourceCapabilities = SOURCE_CAPABILITIES.spotify;

// The honest label shown while a Spotify track is heard as its YouTube version (AE5,
// KTD-2). Plain words a non-technical listener understands — no jargon, no excuse.
export const SPOTIFY_FALLBACK_NOTICE =
  "Spotify needs Premium — playing the YouTube version";

// When no YouTube match can be found (e.g. YouTube search isn't configured, or a very
// obscure track). Honest failure text, never a silent freeze (R2/R18).
export const SPOTIFY_NO_MATCH_REASON =
  "Couldn't find a YouTube version of this Spotify track";

// Resolve the best matching YouTube track for a Spotify track. Injectable so unit
// tests supply a deterministic matcher; the default asks the app's own cached search
// route (which already prefers cache + real cover art) and takes its first YouTube
// result. Returns null on any miss/failure so the caller degrades honestly.
export type MatchResolver = (track: TrackRef) => Promise<TrackRef | null>;

async function defaultMatchResolver(track: TrackRef): Promise<TrackRef | null> {
  if (typeof fetch === "undefined") return null; // node/SSR: cannot search here
  const query = [track.title, track.artist].filter(Boolean).join(" ").trim();
  if (!query) return null;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: TrackRef[] };
    const match = (data.results ?? []).find((r) => r.source === "youtube");
    return match ?? null;
  } catch {
    return null;
  }
}

export type SpotifyAdapterDeps = {
  // Override the YouTube matcher (tests). Defaults to the cached /api/search lookup.
  resolveMatch?: MatchResolver;
};

export function createSpotifyAdapter(deps: SpotifyAdapterDeps = {}): SourceAdapter {
  const resolveMatch = deps.resolveMatch ?? defaultMatchResolver;

  return {
    source: "spotify",
    capabilities: SPOTIFY_CAPABILITIES,

    // The heart of U15 (AE5, KTD-2): substitute the Spotify track for its matched
    // YouTube version so the store plays a real, visible, streamable track — and label
    // the swap honestly. On no match, an honest failure the store surfaces (R2/R18).
    async resolvePlayable(track: TrackRef): Promise<PlayableResolution> {
      const match = await resolveMatch(track);
      if (!match) {
        logActivity({
          level: "error",
          type: "spotify-fallback-miss",
          message: SPOTIFY_NO_MATCH_REASON,
          detail: { source: "spotify" },
        });
        return { track: null, reason: SPOTIFY_NO_MATCH_REASON };
      }
      logActivity({
        level: "info",
        type: "spotify-fallback",
        message: SPOTIFY_FALLBACK_NOTICE,
        detail: { source: "spotify", to: "youtube" },
      });
      return { track: match, notice: SPOTIFY_FALLBACK_NOTICE };
    },

    // This adapter never becomes the active engine (resolvePlayable always substitutes
    // to YouTube in this commit), so these are honest no-ops rather than a fake native
    // player. Native Spotify streaming for allowlisted Premium users lands separately.
    async load(): Promise<void> {},
    async play(): Promise<void> {},
    pause(): void {},
    seek(): void {},
    setVolume(): void {},
    setRate(): void {},
    unload(): void {},
  };
}

// The app's single Spotify adapter. Registering it is what makes Spotify search
// results genuinely playable (via the honest YouTube fallback) — the enabled control
// is backed by a real capability (R17).
export const spotifyAdapter = createSpotifyAdapter();
adapterRegistry.register(spotifyAdapter);
