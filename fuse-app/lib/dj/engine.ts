// The Web Audio DJ engine for a single local-files deck (U14, R12/R13/R14).
//
// This is the one part of the DJ console that runs on REAL decoded audio the user
// owns — and the ONLY source whose raw samples the app can process, which is exactly
// why the full engine (3-band EQ, loops, echo FX, scratch) is honest for My Files and
// disabled for YouTube/Spotify (the capability matrix, capabilities.ts).
//
// R14 — THE ON-DEVICE PROMISE, ENFORCED BY CONSTRUCTION. Files are read with the
// browser's FileReader/`file.arrayBuffer()` and decoded with `decodeAudioData` into an
// in-memory AudioBuffer. Nothing here ever touches the network: there is no fetch, no
// upload, no server round-trip. The bytes live in this AudioContext and are released
// on `dispose()`. The DJ UI states this where files are loaded.
//
// The audio graph (per the plan) is:
//
//   bufferSource → lowShelf → midPeak → highShelf → deckGain → crossfadeGain → master
//                                          └→ delay → wetGain ─┘   (echo FX, parallel)
//                                                └→ feedback ─┘
//
// so every knob affects real sound: EQ on the three biquads, per-deck level on
// deckGain, the crossfader on crossfadeGain, echo on the delay/wet path, and scratch
// on the source's playbackRate. Loops set the source's loopStart/loopEnd.
//
// TESTABILITY / SSR-SAFETY. Web Audio does not exist in Node (where vitest runs) or
// during SSR, so the engine takes an injectable AudioContext factory. The default
// builds a real `AudioContext` only when one exists; otherwise `create()` returns null
// and every method is a safe no-op (an engine that cannot make sound never claims to).
// The pure math (EQ/rate clamps, scratch mapping, loop region) is exported and
// unit-tested without any audio context at all.

import { LOCAL_RATE_RANGE } from "@/lib/player/capabilities";

export type EqBand = "low" | "mid" | "high";

// EQ shelf/peak gain travels this many dB either side of flat (0 dB). Matches a
// typical DJ mixer's ±12 dB kill-to-boost throw.
export const EQ_GAIN_RANGE: readonly [number, number] = [-12, 12];

// Echo FX fixed character (a musical slap-back), so the toggle is one honest on/off.
const ECHO_DELAY_SEC = 0.28;
const ECHO_FEEDBACK = 0.32;
const ECHO_WET = 0.42;

// A held loop captures this many seconds from the current playhead when engaged.
export const DEFAULT_LOOP_SECONDS = 2;

// Scratch throw: at full deflection the record runs this fraction faster/slower, so a
// hard scratch is an audible pitch/speed bend that springs back to the set rate.
const SCRATCH_THROW = 1.5;

// ── Pure helpers (unit-tested with no AudioContext) ─────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// Clamp an EQ band gain to the mixer's dB throw; NaN falls back to flat (0 dB).
export function clampEqGain(db: number): number {
  if (Number.isNaN(db)) return 0;
  const [min, max] = EQ_GAIN_RANGE;
  return clamp(db, min, max);
}

// Clamp a playback rate to what decoded audio plays cleanly (matches the matrix's
// local rate window); NaN falls back to normal speed.
export function clampRate(rate: number): number {
  if (Number.isNaN(rate)) return 1;
  const [min, max] = LOCAL_RATE_RANGE;
  return clamp(rate, min, max);
}

// Map a scratch deflection in [-1, 1] against a base rate to the momentary playback
// rate. 0 = the record runs at its set speed; ±1 = a hard forward/back scratch. The
// result is clamped to the same rate window so a scratch never runs away.
export function scratchRate(baseRate: number, deflection: number): number {
  const d = clamp(deflection, -1, 1);
  return clampRate(baseRate * (1 + d * SCRATCH_THROW));
}

// The loop region [start, end] captured from `position` for `lengthSec`, clamped so it
// always sits inside a buffer of `durationSec` and never inverts. When the track is too
// short for a full loop it loops the whole remaining tail (or the whole track).
export function loopRegion(
  position: number,
  durationSec: number,
  lengthSec: number = DEFAULT_LOOP_SECONDS,
): { start: number; end: number } {
  if (!(durationSec > 0)) return { start: 0, end: 0 };
  const start = clamp(position, 0, durationSec);
  const end = clamp(start + Math.max(0, lengthSec), start, durationSec);
  // Degenerate (playhead at the very end): loop from the start of the track instead.
  if (end <= start) return { start: 0, end: durationSec };
  return { start, end };
}

// ── Injectable Web Audio surface (real nodes satisfy these structurally) ────────

export interface AudioParamLike {
  value: number;
}
interface NodeLike {
  connect(destination: NodeLike): NodeLike;
  disconnect(): void;
}
export interface GainLike extends NodeLike {
  gain: AudioParamLike;
}
export interface BiquadLike extends NodeLike {
  type: string;
  frequency: AudioParamLike;
  Q: AudioParamLike;
  gain: AudioParamLike;
}
export interface DelayLike extends NodeLike {
  delayTime: AudioParamLike;
}
export interface BufferSourceLike extends NodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  playbackRate: AudioParamLike;
  onended: (() => void) | null;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}
export interface AudioBufferLike {
  duration: number;
}
export interface AudioContextLike {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: NodeLike;
  createGain(): GainLike;
  createBiquadFilter(): BiquadLike;
  createDelay(maxDelaySeconds?: number): DelayLike;
  createBufferSource(): BufferSourceLike;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export type AudioContextFactory = () => AudioContextLike | null;

// The default factory builds a real AudioContext only in a browser that has one; in
// Node / SSR it returns null and the engine degrades to silent no-ops.
const defaultContextFactory: AudioContextFactory = () => {
  const Ctor =
    typeof window !== "undefined"
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext)
      : undefined;
  if (!Ctor) return null;
  return new Ctor() as unknown as AudioContextLike;
};

// ── The engine ──────────────────────────────────────────────────────────────────

export type DjDeckEngine = {
  // Whether a real audio graph exists (a browser AudioContext was available). When
  // false every method is a safe no-op and the UI must not claim the deck can play.
  readonly available: boolean;
  // Whether a decoded file is currently loaded and ready to play.
  readonly hasTrack: boolean;
  // Whether sound is currently being produced.
  readonly playing: boolean;
  // Browsers require a user gesture before audio starts; call inside the load/play tap.
  resume(): Promise<void>;
  // Decode a user's local file into memory (never uploaded — R14). Rejects if the
  // bytes cannot be decoded so the caller can show an honest error.
  loadFile(file: File): Promise<void>;
  // Decode already-read bytes (used by the unified local adapter, which owns file IO).
  loadArrayBuffer(bytes: ArrayBuffer): Promise<void>;
  play(): void;
  pause(): void;
  // Toggle play/pause; returns whether the deck is playing afterwards.
  toggle(): boolean;
  // Seek to an absolute position in seconds within the decoded buffer.
  seek(positionSec: number): void;
  // 3-band EQ, in dB (clamped to EQ_GAIN_RANGE).
  setEq(band: EqBand, gainDb: number): void;
  // Playback speed (clamped to the local rate window).
  setRate(rate: number): void;
  // Deck output level after the crossfader — the equal-power crossfade gain, 0..1.
  setCrossfade(gain: number): void;
  // Engage/disengage a seamless loop from the current playhead.
  setLoop(enabled: boolean): void;
  // Engage/disengage the echo FX.
  setEcho(enabled: boolean): void;
  // Momentary scratch deflection in [-1, 1]; 0 restores the set rate.
  scratch(deflection: number): void;
  // Release the scratch (spring back to the set rate).
  endScratch(): void;
  // Current playhead in seconds (for a moving position readout).
  position(): number;
  // Total decoded length in seconds, or 0 when nothing is loaded.
  duration(): number;
  // Tear down the graph and free the decoded buffer (the bytes leave memory here).
  dispose(): void;
};

export function createDjDeckEngine(
  createContext: AudioContextFactory = defaultContextFactory,
): DjDeckEngine {
  const ctx = createContext();

  // No AudioContext (SSR / Node / unsupported browser): a fully inert engine that is
  // honest about producing no sound. `available` is false so the UI disables the deck.
  if (!ctx) return inertEngine();

  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  const crossGain = ctx.createGain();
  crossGain.gain.value = 1;
  crossGain.connect(master);

  const deckGain = ctx.createGain();
  deckGain.gain.value = 1;

  const low = ctx.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = 200;
  const mid = ctx.createBiquadFilter();
  mid.type = "peaking";
  mid.frequency.value = 1000;
  mid.Q.value = 1;
  const high = ctx.createBiquadFilter();
  high.type = "highshelf";
  high.frequency.value = 3200;

  // Dry chain: EQ → deckGain → crossfade.
  low.connect(mid);
  mid.connect(high);
  high.connect(deckGain);
  deckGain.connect(crossGain);

  // Echo FX (parallel wet path off deckGain): deckGain → delay → wet → crossfade,
  // with a feedback loop for repeats. Silent until engaged (wet gain starts at 0).
  const delay = ctx.createDelay(1);
  delay.delayTime.value = ECHO_DELAY_SEC;
  const feedback = ctx.createGain();
  feedback.gain.value = ECHO_FEEDBACK;
  const wet = ctx.createGain();
  wet.gain.value = 0;
  deckGain.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(crossGain);

  // Mutable playback state reapplied to each fresh AudioBufferSourceNode (a source is
  // one-shot: once stopped it cannot restart, so play() after pause() builds a new one
  // and re-applies loop/rate here).
  let buffer: AudioBufferLike | null = null;
  let source: BufferSourceLike | null = null;
  let playing = false;
  let startedAt = 0; // ctx.currentTime when the current source started
  let offset = 0; // seconds into the buffer at that start
  let baseRate = 1; // the user's set speed (scratch bends around this)
  let scratching = false;
  let loopOn = false;

  function currentPosition(): number {
    if (!buffer) return 0;
    const played = offset + (playing ? ctx!.currentTime - startedAt : 0);
    if (loopOn) return played; // looped playback keeps its own region; report raw elapsed
    return Math.min(played, buffer.duration);
  }

  function applyLoop(src: BufferSourceLike): void {
    if (loopOn && buffer) {
      const region = loopRegion(offset, buffer.duration);
      src.loop = true;
      src.loopStart = region.start;
      src.loopEnd = region.end;
    } else {
      src.loop = false;
    }
  }

  function startSource(): void {
    if (!buffer) return;
    const src = ctx!.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = clampRate(baseRate);
    applyLoop(src);
    src.connect(low);
    src.onended = () => {
      // Only a natural end (not a pause-triggered stop) clears playback state.
      if (source === src && !scratching) {
        playing = false;
        source = null;
        offset = 0;
      }
    };
    const startOffset = buffer.duration > 0 ? offset % buffer.duration : 0;
    src.start(0, startOffset);
    source = src;
    startedAt = ctx!.currentTime;
    playing = true;
  }

  function stopSource(): void {
    if (!source) return;
    offset += ctx!.currentTime - startedAt;
    if (buffer && buffer.duration > 0) offset = offset % buffer.duration;
    const dying = source;
    source = null; // detach onended so it does not clear state as a natural end
    dying.onended = null;
    try {
      dying.stop();
    } catch {
      /* already stopped */
    }
    dying.disconnect();
    playing = false;
  }

  return {
    get available() {
      return true;
    },
    get hasTrack() {
      return buffer !== null;
    },
    get playing() {
      return playing;
    },

    async resume() {
      if (ctx.state === "suspended") await ctx.resume();
    },

    async loadFile(file: File) {
      const bytes = await file.arrayBuffer();
      await this.loadArrayBuffer(bytes);
    },

    async loadArrayBuffer(bytes: ArrayBuffer) {
      const decoded = await ctx.decodeAudioData(bytes);
      const wasPlaying = playing;
      stopSource();
      buffer = decoded;
      offset = 0;
      if (wasPlaying) startSource();
    },

    play() {
      if (!buffer || playing) return;
      startSource();
    },

    pause() {
      stopSource();
    },

    toggle() {
      if (playing) this.pause();
      else this.play();
      return playing;
    },

    seek(positionSec: number) {
      if (!buffer) return;
      const wasPlaying = playing;
      stopSource();
      offset = clamp(positionSec, 0, buffer.duration);
      if (wasPlaying) startSource();
    },

    setEq(band: EqBand, gainDb: number) {
      const node = band === "low" ? low : band === "mid" ? mid : high;
      node.gain.value = clampEqGain(gainDb);
    },

    setRate(rate: number) {
      baseRate = clampRate(rate);
      if (!scratching && source) source.playbackRate.value = baseRate;
    },

    setCrossfade(gain: number) {
      crossGain.gain.value = clamp(gain, 0, 1);
    },

    setLoop(enabled: boolean) {
      loopOn = enabled;
      if (!source || !buffer) return;
      // Apply live so the current playhead's region loops immediately (seamless — no
      // teardown of the running source).
      if (enabled) {
        const region = loopRegion(currentPosition(), buffer.duration);
        source.loopStart = region.start;
        source.loopEnd = region.end;
        source.loop = true;
      } else {
        source.loop = false;
      }
    },

    setEcho(enabled: boolean) {
      wet.gain.value = enabled ? ECHO_WET : 0;
    },

    scratch(deflection: number) {
      scratching = true;
      if (source) source.playbackRate.value = scratchRate(baseRate, deflection);
    },

    endScratch() {
      scratching = false;
      if (source) source.playbackRate.value = baseRate;
    },

    position() {
      return currentPosition();
    },

    duration() {
      return buffer?.duration ?? 0;
    },

    dispose() {
      stopSource();
      buffer = null;
      void ctx.close();
    },
  };
}

// A fully inert engine for environments with no Web Audio (Node/SSR/unsupported). It
// satisfies the contract while producing no sound and honestly reporting `available:
// false` so the UI keeps the deck disabled with a plain reason (R17).
function inertEngine(): DjDeckEngine {
  return {
    available: false,
    hasTrack: false,
    playing: false,
    resume: async () => {},
    loadFile: async () => {},
    loadArrayBuffer: async () => {},
    play: () => {},
    pause: () => {},
    toggle: () => false,
    seek: () => {},
    setEq: () => {},
    setRate: () => {},
    setCrossfade: () => {},
    setLoop: () => {},
    setEcho: () => {},
    scratch: () => {},
    endScratch: () => {},
    position: () => 0,
    duration: () => 0,
    dispose: () => {},
  };
}
