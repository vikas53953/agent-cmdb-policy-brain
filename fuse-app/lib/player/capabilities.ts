// Capability resolver (U5, R17, KTD-6).
//
// This is the ONE place the DJ capability matrix lives as executable logic. The DJ
// console (U13) and the player UIs read the resolved matrix and gate their controls
// from it — they never re-decide "can YouTube scratch?" locally. That is the
// class-level fix for the old app's showcase buttons: a control is enabled if and
// only if the resolver says the capability is available, and a disabled control
// always carries the plain-English reason the resolver produced.
//
// The matrix from the plan (Yes / No — reason):
//
//   Capability          My Files   YouTube                Spotify
//   Load onto deck       Yes        Yes                    One deck at a time
//   Volume / crossfade   Yes        Yes                    Yes (single deck)
//   Rate / speed         Yes        Yes [0.25..2]          No
//   3-band EQ            Yes        No                     No
//   Loops                Yes        No                     No
//   FX                   Yes        No                     No
//   Scratch              Yes        No                     No
//   Second deck          Yes        Yes                    Locked

import type { TrackSource } from "@/lib/repos/track";
import type {
  CapabilityKey,
  CapabilityMatrix,
  CapabilityState,
  SourceCapabilities,
} from "@/lib/player/types";

// Plain-English reasons shown on disabled controls (R17). Single source of the exact
// wording the acceptance examples assert (AE3, AE4).
export const REASONS = {
  ytNotAvailable: "Not available for YouTube tracks",
  spNotAvailable: "Not available for Spotify tracks",
  spNoSpeed: "Speed control isn't available for Spotify tracks",
  spOneDeck: "Spotify allows one deck at a time",
  // Engine-readiness reasons (U13): a source whose DJ engine is not wired in this
  // commit. The capability matrix would allow the control, but the engine behind it
  // does not exist yet, so the DJ console renders it disabled with these words until
  // its owning unit lands (My Files → U14, Spotify playback → U15). This is the
  // second honesty axis on top of the matrix (R17).
  localEngineSoon: "Full DJ engine arrives with local-file support",
  spPlaybackSoon: "Spotify playback arrives with Spotify support",
} as const;

// YouTube's IFrame player clamps playback rate to this window (setPlaybackRate).
export const YOUTUBE_RATE_RANGE: readonly [number, number] = [0.25, 2];
// Local decoded audio can be sped up/slowed the same practical range.
export const LOCAL_RATE_RANGE: readonly [number, number] = [0.25, 2];

// The static per-source powers — one entry per column of the matrix. The resolver
// layers deck/occupancy context on top of these; adapters expose their own column
// via `SourceAdapter.capabilities`.
export const SOURCE_CAPABILITIES: Record<TrackSource, SourceCapabilities> = {
  local: {
    source: "local",
    rateRange: LOCAL_RATE_RANGE,
    eq: true,
    loops: true,
    fx: true,
    scratch: true,
    singleDeckOnly: false,
  },
  youtube: {
    source: "youtube",
    rateRange: YOUTUBE_RATE_RANGE,
    eq: false,
    loops: false,
    fx: false,
    scratch: false,
    singleDeckOnly: false,
  },
  spotify: {
    source: "spotify",
    // Spotify Web Playback SDK exposes no speed control.
    rateRange: null,
    eq: false,
    loops: false,
    fx: false,
    scratch: false,
    // Spotify Connect: one active stream only.
    singleDeckOnly: true,
  },
};

export type DeckId = "A" | "B";

// Context for resolving one source's capabilities on one deck.
export type CapabilityContext = {
  // The source being considered for this deck.
  source: TrackSource;
  // Which deck this is (DJ console has two). Optional for plain-player use, where
  // there is only one playback surface and the deck/occupancy rules do not apply.
  deck?: DeckId;
  // The source currently loaded on the OTHER deck, if any. Drives the Spotify
  // one-deck-at-a-time lock (AE4): loading Spotify on deck B is locked while deck A
  // already holds Spotify.
  otherDeckSource?: TrackSource | null;
};

const OK: CapabilityState = { available: true, reason: null };
function no(reason: string): CapabilityState {
  return { available: false, reason };
}

// The reason a non-local source gives for a full-engine capability (EQ/loops/FX/
// scratch) it cannot do. Only local audio routes through the Web Audio graph.
function fullEngineReason(source: TrackSource): string {
  return source === "youtube" ? REASONS.ytNotAvailable : REASONS.spNotAvailable;
}

// Resolve the full capability matrix for a source in a given context. This is the
// single decision point the DJ console and player UIs call; the returned matrix maps
// one-to-one onto the plan's table.
export function resolveCapabilities(context: CapabilityContext): CapabilityMatrix {
  const caps = SOURCE_CAPABILITIES[context.source];
  const isSpotify = context.source === "spotify";

  // Spotify can be loaded onto a deck only if the other deck is not already Spotify.
  const spotifyBlockedByOtherDeck =
    isSpotify && context.otherDeckSource === "spotify";

  const load: CapabilityState = spotifyBlockedByOtherDeck
    ? no(REASONS.spOneDeck)
    : OK;

  // Volume/crossfade is available for every source (Spotify only ever on one deck,
  // enforced by `load`/`secondDeck`, not by disabling volume).
  const volume: CapabilityState = OK;

  const rate: CapabilityState = caps.rateRange
    ? OK
    : no(isSpotify ? REASONS.spNoSpeed : fullEngineReason(context.source));

  const eq: CapabilityState = caps.eq ? OK : no(fullEngineReason(context.source));
  const loops: CapabilityState = caps.loops
    ? OK
    : no(fullEngineReason(context.source));
  const fx: CapabilityState = caps.fx ? OK : no(fullEngineReason(context.source));
  const scratch: CapabilityState = caps.scratch
    ? OK
    : no(fullEngineReason(context.source));

  // A source that is single-deck-only can never occupy a second simultaneous deck.
  const secondDeck: CapabilityState = caps.singleDeckOnly
    ? no(REASONS.spOneDeck)
    : OK;

  return { load, volume, rate, eq, loops, fx, scratch, secondDeck };
}

// Convenience: is a single capability available for a source/context? Lets a UI ask
// one narrow question without destructuring the whole matrix.
export function canDo(
  key: CapabilityKey,
  context: CapabilityContext,
): CapabilityState {
  return resolveCapabilities(context)[key];
}
