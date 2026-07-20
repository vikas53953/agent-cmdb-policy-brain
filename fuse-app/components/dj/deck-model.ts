// DJ deck model (U13, R12/R13/R17, AE3/AE4) — the pure, framework-free logic behind
// the DJ console. It composes TWO honesty axes so the console can never show a fake
// control:
//
//   1. The capability MATRIX (lib/player/capabilities.ts) — what a source can do at
//      all (YouTube can't EQ; Spotify has no speed; Spotify is one deck at a time).
//   2. Engine READINESS in THIS commit — whether the code that would drive a control
//      actually exists yet. U13 ships working YouTube decks; the local-file engine
//      lands in U14 and Spotify playback in U15. Until then those sources' controls
//      are disabled with a plain-English "arrives with …" reason, even where the
//      matrix would allow them.
//
// Keeping this here (not inside the React components) is what lets capabilities.test.ts
// assert the gating against the plan's matrix without a DOM.

import type { TrackSource } from "@/lib/repos/track";
import type { CapabilityKey, CapabilityMatrix, CapabilityState } from "@/lib/player/types";
import {
  REASONS,
  resolveCapabilities,
  type DeckId,
} from "@/lib/player/capabilities";

export type { DeckId };

// Which sources have a real, wired DJ-deck engine in this commit. This is the single
// place the "what works today" truth lives; U14 flips `local` true, U15 flips
// `spotify` true. A source that is not ready renders its otherwise-available controls
// disabled with the reason from `engineReason`.
export type DeckEngineReadiness = Record<TrackSource, boolean>;

export const DJ_ENGINE_READY: DeckEngineReadiness = {
  youtube: true, // U13: two visible iframe players, volume-crossfaded — real audio.
  spotify: false, // U15: Web Playback SDK / YouTube fallback.
  local: true, // U14: Web Audio engine on decoded local files — full EQ/loops/FX/scratch.
};

// The plain-English reason a not-yet-wired source gives for a control the matrix would
// otherwise allow (load / volume). Matrix-DISALLOWED controls keep their own, more
// specific matrix reason instead (e.g. Spotify speed → spNoSpeed).
// Plain words for the one source a deck cannot play. "Spotify playback arrives with
// Spotify support" said the same thing twice and told the DJ nothing to do, so the deck
// uses this instead: what can't happen, and what to do right now.
export const DJ_SPOTIFY_NOTICE =
  "This deck can't play Spotify tracks yet. Use My Files or YouTube on this deck for now.";

function engineReason(source: TrackSource): string {
  return source === "spotify" ? DJ_SPOTIFY_NOTICE : REASONS.localEngineSoon;
}

// One source's option in a deck's source picker. `selectable` is whether the user can
// load this source onto THIS deck right now; `reason` is the plain-English why-not
// shown on the disabled option (R17).
export type DeckSourceOption = {
  source: TrackSource;
  selectable: boolean;
  reason: string | null;
};

export type DeckContext = {
  deck: DeckId;
  // The source loaded on the OTHER deck, if any — drives the Spotify one-deck lock.
  otherDeckSource?: TrackSource | null;
  // Override for tests; defaults to the real per-commit readiness.
  ready?: DeckEngineReadiness;
};

// Can `source` be loaded onto this deck? Encodes the two plan-mandated rules:
//   - My Files is NOT selectable in U13 (no landable commit exposes a dead local deck)
//     — disabled with the local-engine reason until U14.
//   - Spotify IS selectable (so it can occupy a deck and the one-deck lock, AE4, is
//     demonstrable), UNLESS the other deck already holds Spotify, in which case the
//     capability resolver's `load` locks it. Whether Spotify can actually PLAY is a
//     separate, transport-level honesty surfaced by resolveDeckControls.
export function resolveDeckSourceOption(
  source: TrackSource,
  ctx: DeckContext,
): DeckSourceOption {
  const ready = ctx.ready ?? DJ_ENGINE_READY;

  // Local: no deck engine at all until U14 — never selectable in U13.
  if (source === "local" && !ready.local) {
    return { source, selectable: false, reason: REASONS.localEngineSoon };
  }

  // The one-deck-at-a-time lock (AE4) comes straight from the matrix `load` state.
  const load = resolveCapabilities({
    source,
    deck: ctx.deck,
    otherDeckSource: ctx.otherDeckSource,
  }).load;
  if (!load.available) {
    return { source, selectable: false, reason: load.reason };
  }

  return { source, selectable: true, reason: null };
}

// Every source's picker option for a deck, in display order (My Files, YouTube,
// Spotify) — the prototype's `.source-pick` row.
export const DECK_SOURCE_ORDER: readonly TrackSource[] = ["local", "youtube", "spotify"];

export function resolveDeckSourceOptions(ctx: DeckContext): DeckSourceOption[] {
  return DECK_SOURCE_ORDER.map((source) => resolveDeckSourceOption(source, ctx));
}

// The resolved control matrix for a source LOADED on a deck. Starts from the pure
// capability matrix, then — if the source's engine is not wired in this commit —
// disables every control the matrix WOULD allow with the engine reason. Controls the
// matrix already disallows keep their specific matrix reason.
export function resolveDeckControls(
  source: TrackSource,
  ctx: DeckContext,
): CapabilityMatrix {
  const ready = ctx.ready ?? DJ_ENGINE_READY;
  const base = resolveCapabilities({
    source,
    deck: ctx.deck,
    otherDeckSource: ctx.otherDeckSource,
  });
  if (ready[source]) return base;

  const reason = engineReason(source);
  const out = {} as CapabilityMatrix;
  for (const key of Object.keys(base) as CapabilityKey[]) {
    const state: CapabilityState = base[key];
    out[key] = state.available ? { available: false, reason } : state;
  }
  return out;
}

// The "full engine" powers shown as honest on/off indicators on every deck (prototype
// `.cap.on/.cap.off`). Speed and the crossfader are their own live controls, so they
// are not repeated here.
export const DECK_CAPABILITY_CHIPS: readonly { key: CapabilityKey; label: string }[] = [
  { key: "eq", label: "EQ" },
  { key: "loops", label: "Loops" },
  { key: "fx", label: "FX" },
  { key: "scratch", label: "Scratch" },
];

// ── The THIRD honesty axis: nothing is loaded yet (F-7) ────────────────────────────
//
// THE BUG: a My Files deck with no file picked showed four CUE pads, four loop buttons,
// three EQ kills and a TAP button that all LOOKED live. They were correctly `disabled`
// and each carried a `title` explaining why — but a `title` is a hover tooltip, and on
// the phone this app is mostly used on there IS no hover. So the honest reason was, in
// practice, invisible: the pads just sat there looking broken.
//
// The app already had the right machinery for exactly this — the capability matrix, which
// greys a control and states the reason as VISIBLE text ("Not available for YouTube
// tracks"). It simply was not being applied to the not-loaded case, and a My Files deck
// rendered no capability chips at all. This axis closes that gap: "can this source do it"
// (the matrix) and "is its engine wired" (readiness) are now joined by "is there anything
// loaded to do it TO".
//
// Doing it here rather than in the component is what makes it a class fix: every control
// group reads its live/disabled state and its reason from one resolved matrix, so a
// control added later cannot forget to explain itself.

// Which capabilities are meaningless with an empty deck. `load` is deliberately absent —
// loading is the one thing you must still be able to do. `volume`/`secondDeck` are deck
// properties, not track controls, so they stay unaffected.
export const LOADED_GATED_KEYS: readonly CapabilityKey[] = [
  "rate",
  "eq",
  "loops",
  "fx",
  "scratch",
];

// The plain-words reason an empty deck gives, in the vocabulary of the thing the DJ
// actually has to go and do. Same register as the matrix reasons — what is off, and what
// to do about it.
export const NOTHING_LOADED_REASONS: Record<TrackSource, string> = {
  local: "Load a file first",
  youtube: "Load a track first",
  spotify: "Load a track first",
};

export function nothingLoadedReason(source: TrackSource): string {
  return NOTHING_LOADED_REASONS[source];
}

// The controls for a source on a deck, gated by whether anything is actually loaded.
// Layered ON TOP of resolveDeckControls so the capability and readiness reasons always
// win: a YouTube deck's EQ says "Not available for YouTube tracks" whether or not a video
// is loaded, because loading one would not change the answer. Only controls that WOULD be
// live are turned off for the empty deck.
export function resolveDeckControlsFor(
  source: TrackSource,
  ctx: DeckContext,
  loaded: boolean,
): CapabilityMatrix {
  const base = resolveDeckControls(source, ctx);
  if (loaded) return base;

  const reason = nothingLoadedReason(source);
  const out = { ...base } as CapabilityMatrix;
  for (const key of LOADED_GATED_KEYS) {
    const state: CapabilityState = base[key];
    if (state.available) out[key] = { available: false, reason };
  }
  return out;
}

// The one-line pointer under a deck's greyed chips. It exists to reframe missing powers
// as a CAPABILITY DIFFERENCE ("the full engine is a My Files thing") rather than
// breakage. That framing is only true when the powers are off because of the SOURCE — on
// a My Files deck that simply has no file yet, the chips already say "Load a file first"
// and telling the DJ the full engine works with My Files would be nonsense, since they
// are already on My Files. Returns null when no pointer should be shown.
export const FULL_ENGINE_POINTER = "Full engine works with My Files";

export function capabilityPointer(source: TrackSource, ctx: DeckContext): string | null {
  // Ask the UNGATED matrix: is a power off for a reason that loading something would not
  // fix? Only then is the "this is a My Files power" pointer the honest thing to say.
  const base = resolveDeckControls(source, ctx);
  const offBySource = DECK_CAPABILITY_CHIPS.some(({ key }) => !base[key].available);
  if (!offBySource) return null;
  // Suppress it on a My Files deck — it would be telling the DJ to use what they are
  // already using. (Only reachable if a future readiness flag turns local off.)
  if (source === "local") return null;
  return FULL_ENGINE_POINTER;
}

// The crossfader curve a DJ can choose (DJ-1). "smooth" is the equal-power blend for
// long mixes; "linear" is a straight fade; "sharp" is a fast cut that brings the other
// deck fully in from a small movement at the edge — the curve scratch DJs cut on.
export type CrossfadeCurve = "smooth" | "linear" | "sharp";

export const CROSSFADE_CURVES: readonly { curve: CrossfadeCurve; label: string }[] = [
  { curve: "smooth", label: "Smooth" },
  { curve: "linear", label: "Linear" },
  { curve: "sharp", label: "Sharp cut" },
];

// How aggressively the "sharp" curve cuts: a channel reaches full within this fraction of
// the travel from its edge, then plateaus (both decks sit near full through the middle).
const SHARP_GAIN = 2;

// Crossfade gains for a position in [0,1] (0 = full Deck A, 1 = full Deck B) under the
// chosen curve. Defaults to the equal-power "smooth" curve the old DJEngine used, so the
// two decks sum to roughly constant perceived loudness through the blend (R13). Every
// curve honours the endpoints exactly: p=0 → {1,0}, p=1 → {0,1}.
export function crossfadeGains(
  position: number,
  curve: CrossfadeCurve = "smooth",
): { a: number; b: number } {
  const p = Math.max(0, Math.min(1, position));
  if (curve === "linear") {
    return { a: 1 - p, b: p };
  }
  if (curve === "sharp") {
    return {
      a: Math.min(1, (1 - p) * SHARP_GAIN),
      b: Math.min(1, p * SHARP_GAIN),
    };
  }
  return {
    a: Math.cos((p * Math.PI) / 2),
    b: Math.cos(((1 - p) * Math.PI) / 2),
  };
}

// A YouTube video id (11 chars) from a raw id or any common YouTube URL form, or null
// when the input is not a recognisable YouTube reference. Lets a deck load a real,
// specific YouTube track (the working U13 capability) rather than a fake knob.
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^[\w-]{11}$/.test(s)) return s;
  const patterns: readonly RegExp[] = [
    /[?&]v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /\/embed\/([\w-]{11})/,
    /\/shorts\/([\w-]{11})/,
    /\/v\/([\w-]{11})/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}
