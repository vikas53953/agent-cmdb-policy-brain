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

// The USER'S intent for playback — the thing the recovery monitor must gate on so it
// never "recovers" a track the listener has paused, minimised, or never started (the
// exact R1/R3/R4 class of false stalls). It is written ONLY by user-driven store
// commands (play/resume/next/previous → "play"; pause → "pause"; initial / honest
// terminal → "idle"). It is NOT the fine-grained engine truth — `isPlaying` and
// `engineState` stay that — so recovery can distinguish "the user wants sound but the
// engine is wedged" (a real stall) from "the engine is not producing sound because the
// user does not want it to right now" (never a stall).
export type PlayerIntent = "play" | "pause" | "idle";

// The engine's own reported lifecycle for the current track, mirrored from the source
// adapter (for YouTube: YT.PlayerState). Distinct from PlayerIntent: this is what the
// player IS doing, not what the user WANTS. The recovery monitor treats only
// "playing"/"buffering" (with intent "play" and frozen position) as a possible stall;
// "paused"/"unstarted"/"ended" are definitively-not-a-stall.
export type EngineState =
  | "unstarted"
  | "buffering"
  | "playing"
  | "paused"
  | "ended"
  | "error";

// The machine-readable playback lifecycle, exposed on the mini-player root as
// data-player-state for the robot tester (and any diagnostics). "stalled" is NOT a
// store field — it is derived by watching whether position advances while playing
// (playback-health.ts) — but it is part of the surfaced vocabulary the UI emits.
//   • idle    — nothing loaded, or paused.
//   • loading — play() called; the adapter is preparing/starting (not yet producing).
//   • playing — an adapter has actually started; sound is being produced.
//   • error   — playback could not start (no playable resolution, or the engine threw).
// The store owns idle/loading/playing/error; the mini-player layers "stalled" on top.
export type PlayerStatus = "idle" | "loading" | "playing" | "error";

// The honest health of playback layered on top of PlayerStatus by the recovery ladder
// (playback-health.ts, driven app-wide by use-playback-recovery.ts):
//   • "ok"      — nothing wrong (idle, loading, or genuinely advancing).
//   • "stalled" — position stopped advancing; the bounded recovery ladder is working it.
//   • "error"   — the ladder is exhausted; this track will not play. Skip is offered.
// This is a store field (single source of truth) so every surface — the mini-player's
// data-player-state, the Now Playing banner, the robot tester — reads ONE truth and can
// never disagree about whether playback is healthy, recovering, or honestly failed.
export type RecoveryPhase = "ok" | "stalled" | "error";

export type RecoveryState = {
  phase: RecoveryPhase;
  // True once automatic recovery gave up and the user should Skip. Never a silent freeze.
  skipOffered: boolean;
};

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
  // The machine-readable lifecycle phase (see PlayerStatus). Surfaced on the
  // mini-player root as data-player-state so the robot tester can assert real playback
  // (e.g. that it reaches "playing") rather than guessing from the DOM. isPlaying and
  // status stay consistent: status === "playing" exactly when isPlaying is true.
  status: PlayerStatus;
  // The recovery-ladder health of the current track (single source of truth). The
  // app-wide recovery monitor writes it; every surface renders the honest phase from it.
  recovery: RecoveryState;
  // The user's playback intent (see PlayerIntent). Written only by user-driven store
  // commands; the recovery monitor gates on this so a paused/idle track is never a stall.
  intent: PlayerIntent;
  // The engine's own reported lifecycle for the current track (see EngineState), mirrored
  // from the active adapter. Read by the recovery monitor together with `intent`.
  engineState: EngineState;
  // The back-stack of tracks the listener has navigated AWAY from, oldest first (Wave 1 —
  // true Previous). `previous()` pops this to go back a song, mirroring every rival's
  // back button. Capped so it never grows without bound. Not the queue (that is forward);
  // this is history (backward).
  history: readonly TrackRef[];
  // True while RADIO CONTINUATION is carrying listening past the end of the queue with
  // similar tracks (Wave 1). It is the ONE sanctioned auto-play — user-consented via the
  // visible "Autoplay similar when queue ends" setting — and drives the honest on-screen
  // banner in Now Playing. Set only when the radio branch fires; cleared the moment the
  // user starts a fresh listening context (a new row tap replaces the queue).
  radioActive: boolean;
  // True when the sleep timer is armed to "stop at the end of the current track" (Wave 1).
  // The store consumes it at a genuine end-of-track advance: instead of moving on (or
  // continuing radio) it pauses. A visible countdown/chip renders from the sleep timer.
  sleepStopAfterTrack: boolean;
  // Output volume in 0..1 and the mute toggle (owner fix 3). The store is the single owner
  // of playback volume: it applies the EFFECTIVE volume (0 while muted, else `volume`) to
  // the active adapter, re-applies it across track changes and blend promotions so it
  // persists, and the shell persists it per user. The mini-player and Now Playing render
  // the slider + mute from these fields, so every surface shows one truth.
  volume: number;
  muted: boolean;
  // True when the up-next queue was auto-seeded with radio-continuation picks because the
  // user played a track without building a queue (owner fix 2 — never an empty "Up next").
  // Drives the honest "Up next — Autoplay" section label in the queue view. Cleared when a
  // fresh listening context replaces the queue (a new row tap). The picks are ordinary
  // queue entries — reorderable and removable — and feed playback at track end like any
  // other queued track; the consented "Autoplay similar" setting governs whether they seed.
  autoplayQueued: boolean;
};

// A radio provider seeds "similar" tracks from the last-played track when the queue runs
// out (Wave 1). Kept as an injected function so the framework-free store never imports the
// search/network machinery: the app wires a provider that reuses the real search engine
// (seed from the track's artist/title); tests pass a deterministic fake. Returning [] means
// "nothing similar found" — the store then honestly stops rather than faking continuation.
export type RadioProvider = (seed: TrackRef) => Promise<readonly TrackRef[]>;

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
  // OPTIONAL engine-state seam: the adapter's own view of what the player is doing
  // (backed by YT.PlayerState for YouTube). Adapters that cannot report it omit it; the
  // store then falls back to its mirrored engineState. Read by the recovery monitor so a
  // stall is judged from real engine state, not just whether a polled clock advanced.
  getEngineState?(): EngineState;
};

// The result of resolvePlayable: either a playable track (optionally a SUBSTITUTE for
// the requested one, carrying an honest notice about the swap), or an honest failure
// with a plain-English reason when nothing playable could be resolved. The two-shape
// union makes it impossible to return a substitute without saying so, or a failure
// without a reason (R17 at the resolution layer).
export type PlayableResolution =
  | { track: TrackRef; notice: string | null }
  | { track: null; reason: string };
