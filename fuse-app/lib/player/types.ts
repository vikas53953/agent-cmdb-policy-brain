// Unified player types (U5, KTD-6).
//
// These are the one shared vocabulary for playback truth. The player store holds a
// single `PlayerState`; every UI surface (mini-player, Now Playing, Home, Search,
// DJ) subscribes to it and renders from it. Source adapters (YouTube U7, local U14,
// Spotify U15) implement the `SourceAdapter` contract and feed the same store — so
// "which source can do what" is a typed, testable seam (the capability matrix)
// rather than the scattered per-source conditionals that broke the old app.
//
// This file is types only (no runtime, no framework), so it is safe to import from
// server code, client components, and node unit tests alike.

import type { TrackRef, TrackSource } from "@/lib/repos/track";

// Repeat behaviour for the queue. "one" repeats the current track; "all" loops the
// whole queue; "off" stops after the last track.
export type RepeatMode = "off" | "one" | "all";

// The single source of playback truth. Nothing outside the store mutates this; the
// store's actions are the only writers, and UI reads a read-only snapshot.
export type PlayerState = {
  // The track the player is currently focused on (playing or paused), or null when
  // nothing has been chosen yet.
  current: TrackRef | null;
  // Upcoming tracks, in order. `current` is NOT part of the queue.
  queue: readonly TrackRef[];
  // True only while sound is actually being produced by an adapter. When no adapter
  // is wired for a source, this stays false — the store never claims to be playing
  // something it cannot play (R17 honesty, at the state layer).
  isPlaying: boolean;
  // Playback position and total length, in seconds. Fed by the active adapter's
  // polling; 0 when nothing is loaded.
  positionSec: number;
  durationSec: number;
  shuffle: boolean;
  repeat: RepeatMode;
  // A short, plain-English label about the CURRENT playback situation, or null when
  // there is nothing to say. Set honestly by the store when a source is substituted —
  // e.g. a Spotify track played as its matched YouTube version for a non-Premium user
  // (KTD-2, AE5): "Spotify needs Premium — playing the YouTube version". It is cleared
  // on every fresh play so it never lingers past the moment it describes (R17).
  notice: string | null;
};

// The DJ/player powers whose availability differs by source and context. These are
// exactly the rows of the DJ capability matrix in the plan.
export type CapabilityKey =
  | "load" // can this source be loaded onto the deck at all
  | "volume" // volume / crossfade
  | "rate" // playback rate / speed
  | "eq" // 3-band EQ
  | "loops"
  | "fx"
  | "scratch"
  | "secondDeck"; // can this source occupy a second simultaneous deck

// The resolved availability of one capability. When unavailable, `reason` is a
// plain-English sentence the UI shows on the disabled control (R17); when available,
// `reason` is null. The two-shape union makes it impossible to render a disabled
// control without a reason, or an enabled control that still carries an excuse.
export type CapabilityState =
  | { available: true; reason: null }
  | { available: false; reason: string };

// Every capability's resolved state for one (source, context). This is what the DJ
// deck and player UIs read to decide which controls light up and which grey out.
export type CapabilityMatrix = Record<CapabilityKey, CapabilityState>;

// The static, context-free powers of a source. `rateRange` is the clamp window for
// playback speed, or null when the source has no speed control at all. These feed
// the resolver, which then layers context (which deck, whether Spotify is already
// in use) on top.
export type SourceCapabilities = {
  source: TrackSource;
  rateRange: readonly [number, number] | null;
  eq: boolean;
  loops: boolean;
  fx: boolean;
  scratch: boolean;
  // Spotify Connect allows only one active stream, so Spotify can occupy at most one
  // deck at a time. YouTube and local files have no such limit.
  singleDeckOnly: boolean;
};

// The imperative surface every source adapter exposes to the store. The store calls
// ONLY these generic methods — no source-specific branch ever leaks into its public
// API (KTD-6). Concrete adapters land in later units:
//   - YouTube  → U7  (visible IFrame player)
//   - local    → U14 (Web Audio decoded buffer)
//   - Spotify  → U15 (Web Playback SDK, allowlisted Premium, else YouTube fallback)
export type SourceAdapter = {
  readonly source: TrackSource;
  // The adapter's static capabilities (the source's column in the matrix).
  readonly capabilities: SourceCapabilities;
  // OPTIONAL substitution seam (U15, KTD-2/AE5). Given a track of THIS adapter's
  // source, return the track that should actually be played and an honest label for
  // any swap — or a null track with a reason when nothing playable can be found.
  // Sources that always play natively omit this (the store treats absence as
  // identity). The Spotify adapter uses it to hand back the matched YouTube version
  // for a non-Premium user, so the store — and the visible-player rule — operate on a
  // real, playable track rather than a source the app cannot actually stream.
  resolvePlayable?(track: TrackRef): Promise<PlayableResolution>;
  // Prepare a track for playback (create/point the underlying player at it).
  load(track: TrackRef): Promise<void>;
  // Begin / resume playback. Resolves once sound is (or will imminently be) produced.
  play(): Promise<void>;
  // Pause without tearing down — position is retained.
  pause(): void;
  // Seek to an absolute position in seconds.
  seek(positionSec: number): void;
  // Set output volume in the range 0..1 (used for volume-crossfade blends).
  setVolume(volume: number): void;
  // Set playback rate; the adapter clamps to its own `rateRange`.
  setRate(rate: number): void;
  // Release the underlying player/resources for this adapter's current track.
  unload(): void;
};

// The result of resolvePlayable: either a playable track (optionally a SUBSTITUTE for
// the requested one, carrying an honest notice about the swap), or an honest failure
// with a plain-English reason when nothing playable could be resolved. The two-shape
// union makes it impossible to return a substitute without saying so, or a failure
// without a reason (R17 at the resolution layer).
export type PlayableResolution =
  | { track: TrackRef; notice: string | null }
  | { track: null; reason: string };
