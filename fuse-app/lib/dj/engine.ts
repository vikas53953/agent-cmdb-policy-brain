// The Web Audio DJ engine for a single local-files deck (U14 + DJ-1, R12/R13/R14).
//
// This is the one part of the DJ console that runs on REAL decoded audio the user
// owns — and the ONLY source whose raw samples the app can process, which is exactly
// why the full engine (waveform, BPM, EQ, kills, filter, loops, echo FX, scratch,
// meter) is honest for My Files and disabled for YouTube/Spotify (the capability
// matrix, capabilities.ts).
//
// R14 — THE ON-DEVICE PROMISE, ENFORCED BY CONSTRUCTION. Files are read with the
// browser's FileReader/`file.arrayBuffer()` and decoded with `decodeAudioData` into an
// in-memory AudioBuffer. Nothing here ever touches the network: there is no fetch, no
// upload, no server round-trip. The bytes live in this AudioContext and are released
// on `dispose()`. Waveform peaks and BPM are computed from the SAME in-memory buffer —
// the samples never leave the device. The DJ UI states this where files are loaded.
//
// The audio graph (DJ-1) is:
//
//   bufferSource → hp/lpFilter → lowShelf → midPeak → highShelf → deckGain(trim) →
//        crossfadeGain → master → destination
//                                          ├→ delay → wetGain → crossfade  (echo FX)
//                                          │      └→ feedback ─┘
//                                          └→ analyser                     (level meter)
//
// so every knob affects real sound: the filter and EQ on biquads, kills by slamming a
// band to EQ_KILL_DB, per-deck level on deckGain, the crossfader on crossfadeGain, echo
// on the delay/wet path, scratch on the source's playbackRate, and the meter reads the
// post-trim signal through an analyser. Loops set the source's loopStart/loopEnd.
//
// TESTABILITY / SSR-SAFETY. Web Audio does not exist in Node (where vitest runs) or
// during SSR, so the engine takes an injectable AudioContext factory. The default
// builds a real `AudioContext` only when one exists; otherwise `create()` returns null
// and every method is a safe no-op (an engine that cannot make sound never claims to).
// The pure math (EQ/rate/filter clamps, scratch mapping, loop region, analysis) is
// exported and unit-tested without any audio context at all.

import { LOCAL_RATE_RANGE } from "@/lib/player/capabilities";
import { computePeaks, detectBpm } from "@/lib/dj/analysis";

export type EqBand = "low" | "mid" | "high";

// EQ shelf/peak gain travels this many dB either side of flat (0 dB). Matches a
// typical DJ mixer's ±12 dB kill-to-boost throw.
export const EQ_GAIN_RANGE: readonly [number, number] = [-12, 12];

// A "kill" cuts a band effectively to silence — deeper than the slider's boost/cut
// throw. Real mixers kill to roughly -26..-40 dB; this is the value the kill button
// slams the band to, bypassing the slider clamp (the slider only spans EQ_GAIN_RANGE).
export const EQ_KILL_DB = -40;

// Trim/gain travels 0..2 (unity at 1) so a quiet track can be matched up to the loud one.
export const TRIM_RANGE: readonly [number, number] = [0, 2];

// Echo FX fixed character (a musical slap-back), so the toggle is one honest on/off.
const ECHO_DELAY_SEC = 0.28;
const ECHO_FEEDBACK = 0.32;
const ECHO_WET = 0.42;

// A held loop captures this many seconds from the current playhead when engaged (the
// fallback when there is no on-grid beat loop armed).
export const DEFAULT_LOOP_SECONDS = 2;

// Scratch throw: at full deflection the record runs this fraction faster/slower, so a
// hard scratch is an audible pitch/speed bend that springs back to the set rate.
const SCRATCH_THROW = 1.5;

// The HP/LP filter knob sweep endpoints in Hz (low-pass fully closed → high-pass fully open).
const FILTER_MIN_HZ = 30;
const FILTER_MAX_HZ = 20_000;

// How many waveform peak buckets the engine pre-computes on load. The overview strip
// draws a downsample of these; the scrolling lane re-buckets a slice for its zoom.
export const ANALYSIS_PEAK_BUCKETS = 2000;

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

// Map the bipolar filter knob [-1,1] to a concrete biquad. |amount| near 0 is treated as
// bypass (a wide-open filter that colours nothing). The frequency sweeps exponentially so
// the knob feels even to the ear across the audible range. Pure + exported for unit test.
export function filterSpec(
  amount: number,
): { type: "lowpass" | "highpass" | "allpass"; frequency: number } {
  const a = clamp(amount, -1, 1);
  if (Math.abs(a) < 0.02) return { type: "allpass", frequency: 1000 };
  if (a < 0) {
    // Low-pass: at a=0 fully open (MAX Hz), at a=-1 fully closed (MIN Hz).
    const t = -a;
    const frequency = FILTER_MAX_HZ * Math.pow(FILTER_MIN_HZ / FILTER_MAX_HZ, t);
    return { type: "lowpass", frequency };
  }
  // High-pass: at a=0 fully open (MIN Hz), at a=1 fully closed (MAX Hz).
  const frequency = FILTER_MIN_HZ * Math.pow(FILTER_MAX_HZ / FILTER_MIN_HZ, a);
  return { type: "highpass", frequency };
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
export interface AnalyserLike extends NodeLike {
  fftSize: number;
  readonly frequencyBinCount: number;
  getFloatTimeDomainData(array: Float32Array): void;
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
  // Real AudioBuffers expose these; they are what the waveform + BPM analysis read. A
  // minimal fake (the unit test) may omit them, in which case analysis degrades to empty
  // peaks / zero BPM rather than throwing — honest, not fake.
  length?: number;
  sampleRate?: number;
  numberOfChannels?: number;
  getChannelData?(channel: number): Float32Array;
}
export interface AudioContextLike {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: NodeLike;
  createGain(): GainLike;
  createBiquadFilter(): BiquadLike;
  createDelay(maxDelaySeconds?: number): DelayLike;
  createBufferSource(): BufferSourceLike;
  createAnalyser(): AnalyserLike;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

// The analysis a local deck computes on load (DJ-1): waveform peaks, detected tempo, and
// the buffer geometry the UI needs to map seconds ↔ pixels. Empty/zero when the buffer
// exposes no samples (a minimal fake, or a decode that yielded no channel data).
export type DeckAnalysis = {
  peaks: readonly number[];
  bpm: number;
  bpmConfidence: number;
  sampleRate: number;
  duration: number;
};

const EMPTY_ANALYSIS: DeckAnalysis = {
  peaks: [],
  bpm: 0,
  bpmConfidence: 0,
  sampleRate: 0,
  duration: 0,
};

// Compute peaks + BPM from a decoded buffer, if it exposes samples. Reads channel 0
// (mono is enough for a waveform outline and tempo). Never throws on a minimal buffer.
function computeBufferAnalysis(buffer: AudioBufferLike): DeckAnalysis {
  const sampleRate = buffer.sampleRate ?? 0;
  const duration = buffer.duration ?? 0;
  if (typeof buffer.getChannelData !== "function" || sampleRate <= 0) {
    return { ...EMPTY_ANALYSIS, duration };
  }
  let data: Float32Array;
  try {
    data = buffer.getChannelData(0);
  } catch {
    return { ...EMPTY_ANALYSIS, duration };
  }
  const peaks = Array.from(computePeaks(data, ANALYSIS_PEAK_BUCKETS));
  const { bpm, confidence } = detectBpm(data, sampleRate);
  return { peaks, bpm, bpmConfidence: confidence, sampleRate, duration };
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
  // Kill/un-kill a band — cut it to silence (EQ_KILL_DB), restoring the slider on release.
  setEqKill(band: EqBand, killed: boolean): void;
  // Whether a band is currently killed (for the UI to reflect the pressed state).
  isEqKilled(band: EqBand): boolean;
  // Bipolar HP/LP filter knob in [-1,1]: 0 bypass, <0 low-pass sweep, >0 high-pass sweep.
  setFilter(amount: number): void;
  // Per-deck trim/gain (TRIM_RANGE, unity at 1) — match a quiet track to a loud one.
  setTrim(gain: number): void;
  // Instantaneous output level 0..1 for the meter (RMS of the post-trim signal).
  getLevel(): number;
  // The waveform peaks + detected tempo computed from the decoded buffer (empty until a
  // file is loaded, or when the buffer exposes no samples).
  getAnalysis(): DeckAnalysis;
  // Playback speed (clamped to the local rate window).
  setRate(rate: number): void;
  // Deck output level after the crossfader — the equal-power crossfade gain, 0..1.
  setCrossfade(gain: number): void;
  // Engage/disengage a seamless loop from the current playhead (default region).
  setLoop(enabled: boolean): void;
  // Arm/clear an on-grid beat loop with exact bounds (from analysis.beatLoopRegion).
  setBeatLoop(bounds: { start: number; end: number } | null): void;
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

  // deckGain is the TRIM/gain stage (0..2, unity at 1) — separate from the crossfader
  // (crossGain), so a DJ can match a quiet track's level AND blend it independently.
  const deckGain = ctx.createGain();
  deckGain.gain.value = 1;

  // The HP/LP filter knob sits at the head of the chain (source → filter → EQ), starting
  // as a wide-open low-pass (bypass) so it colours nothing until the knob is turned.
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = FILTER_MAX_HZ;

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

  // Dry chain: filter → EQ → deckGain(trim) → crossfade.
  filter.connect(low);
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

  // Level meter: an analyser taps the post-trim deck signal so the meter shows this
  // deck's real loudness independent of the crossfader position. Read-only sink.
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  deckGain.connect(analyser);
  const meterBuffer = new Float32Array(analyser.fftSize);

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
  // The active loop bounds, in seconds. When null, a loop captures a default region from
  // the playhead (the old fixed-length behaviour); when set (a beat loop), those exact
  // on-grid bounds are used so the loop stays locked to the beat.
  let loopBounds: { start: number; end: number } | null = null;
  // Per-band EQ: the slider value and whether the band is killed. Kill slams the band to
  // EQ_KILL_DB regardless of the slider; un-killing restores the slider value.
  const eqValue: Record<EqBand, number> = { low: 0, mid: 0, high: 0 };
  const eqKilled: Record<EqBand, boolean> = { low: false, mid: false, high: false };
  // Cached analysis (peaks + BPM) computed once per decoded buffer.
  let analysis: DeckAnalysis = EMPTY_ANALYSIS;

  function eqNode(band: EqBand): BiquadLike {
    return band === "low" ? low : band === "mid" ? mid : high;
  }
  function applyEq(band: EqBand): void {
    eqNode(band).gain.value = eqKilled[band] ? EQ_KILL_DB : clampEqGain(eqValue[band]);
  }

  function currentPosition(): number {
    if (!buffer) return 0;
    const played = offset + (playing ? ctx!.currentTime - startedAt : 0);
    if (loopOn) return played; // looped playback keeps its own region; report raw elapsed
    return Math.min(played, buffer.duration);
  }

  function loopFor(position: number): { start: number; end: number } {
    if (loopBounds) return loopBounds;
    return buffer ? loopRegion(position, buffer.duration) : { start: 0, end: 0 };
  }

  function applyLoop(src: BufferSourceLike): void {
    if (loopOn && buffer) {
      const region = loopFor(offset);
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
    src.connect(filter);
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
      loopBounds = null;
      analysis = computeBufferAnalysis(decoded);
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
      eqValue[band] = clampEqGain(gainDb);
      applyEq(band);
    },

    setEqKill(band: EqBand, killed: boolean) {
      eqKilled[band] = killed;
      applyEq(band);
    },

    isEqKilled(band: EqBand) {
      return eqKilled[band];
    },

    setFilter(amount: number) {
      const spec = filterSpec(amount);
      filter.type = spec.type;
      filter.frequency.value = spec.frequency;
    },

    setTrim(gain: number) {
      const [min, max] = TRIM_RANGE;
      deckGain.gain.value = clamp(gain, min, max);
    },

    getLevel() {
      // RMS of the post-trim signal, mapped to a 0..1 meter reading. Returns 0 when
      // nothing is playing so the meter honestly sits at rest.
      if (!playing) return 0;
      analyser.getFloatTimeDomainData(meterBuffer);
      let sum = 0;
      for (let i = 0; i < meterBuffer.length; i++) sum += meterBuffer[i] * meterBuffer[i];
      const rms = Math.sqrt(sum / meterBuffer.length);
      return clamp(rms, 0, 1);
    },

    getAnalysis() {
      return analysis;
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
      if (!enabled) loopBounds = null;
      if (!source || !buffer) return;
      // Apply live so the region loops immediately (seamless — no teardown of the running
      // source). Uses the active beat-loop bounds if set, else a default region.
      if (enabled) {
        const region = loopFor(currentPosition());
        source.loopStart = region.start;
        source.loopEnd = region.end;
        source.loop = true;
      } else {
        source.loop = false;
      }
    },

    setBeatLoop(bounds: { start: number; end: number } | null) {
      // Arm an on-grid beat loop with exact bounds (from analysis.beatLoopRegion) and
      // engage it. Passing null clears the beat loop and any active loop.
      if (!bounds || !(bounds.end > bounds.start)) {
        loopBounds = null;
        loopOn = false;
        if (source) source.loop = false;
        return;
      }
      loopBounds = bounds;
      loopOn = true;
      if (source) {
        source.loopStart = bounds.start;
        source.loopEnd = bounds.end;
        source.loop = true;
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
    setEqKill: () => {},
    isEqKilled: () => false,
    setFilter: () => {},
    setTrim: () => {},
    getLevel: () => 0,
    getAnalysis: () => EMPTY_ANALYSIS,
    setRate: () => {},
    setCrossfade: () => {},
    setLoop: () => {},
    setBeatLoop: () => {},
    setEcho: () => {},
    scratch: () => {},
    endScratch: () => {},
    position: () => 0,
    duration: () => 0,
    dispose: () => {},
  };
}
