// DJ track analysis — the PURE math behind seeing and beat-matching a local track
// (DJ-1). Everything here is framework-free and audio-context-free: it takes plain
// sample arrays and numbers and returns plain numbers, so every rule (peaks, BPM,
// beatgrid, beat-loop quantise) is unit-tested with synthetic signals and no Web Audio.
//
// Only LOCAL decoded files reach this module — it is the analysis half of the honesty
// matrix: YouTube hands us no samples, so none of this runs for a YouTube deck (the UI
// keeps those controls greyed with a plain reason). The engine (engine.ts) calls these
// on the decoded buffer; the deck UI draws from the results.

// The tempo search window. Dance/pop tempo lives here; anything outside is folded into
// range by the octave-correction below so a half/double-time detection still lands sane.
export const MIN_BPM = 70;
export const MAX_BPM = 180;

// Beats per bar Fuse assumes for bar-based beat loops (common-time 4/4). Beat loops are
// sized in bars; one bar = this many beats.
export const BEATS_PER_BAR = 4;

// The bar counts the beat-loop control offers (task DJ-1: 1/2/4/8 bars), plus the
// smaller fractional loops a DJ reaches for on a build-up. Kept here so the UI and the
// math agree on one list.
export const BEAT_LOOP_BARS: readonly number[] = [0.25, 0.5, 1, 2, 4, 8];

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// ── Waveform peaks ───────────────────────────────────────────────────────────────
//
// Reduce a long sample array to `buckets` peak magnitudes in [0,1] for drawing a
// waveform. Each bucket is the max absolute sample across its slice, normalised by the
// track's overall peak so a quiet track still fills the lane. This is what both the
// scrolling waveform and the overview strip draw from (the overview uses fewer buckets).

export function computePeaks(samples: Float32Array, buckets: number): Float32Array {
  if (samples.length === 0 || !(buckets >= 1)) return new Float32Array(0);
  const out = new Float32Array(Math.floor(buckets));
  const per = samples.length / out.length;
  let globalMax = 0;
  for (let b = 0; b < out.length; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(samples.length, Math.floor((b + 1) * per));
    let peak = 0;
    for (let i = start; i < end; i++) {
      const a = Math.abs(samples[i]);
      if (a > peak) peak = a;
    }
    out[b] = peak;
    if (peak > globalMax) globalMax = peak;
  }
  if (globalMax > 0) {
    for (let b = 0; b < out.length; b++) out[b] = out[b] / globalMax;
  }
  return out;
}

// ── Onset envelope ───────────────────────────────────────────────────────────────
//
// Downsample the signal to a coarse energy envelope and take its positive first
// difference (an onset/flux curve): energy RISES sharply at a beat, so peaks in this
// curve mark beats. This is the common pre-step for tempo autocorrelation, and keeping
// it a pure function lets the BPM test feed a known click train and check the answer.

export function onsetEnvelope(
  samples: Float32Array,
  sampleRate: number,
  envelopeRate = 200,
): { flux: Float32Array; rate: number } {
  if (samples.length === 0 || sampleRate <= 0) {
    return { flux: new Float32Array(0), rate: envelopeRate };
  }
  const frame = Math.max(1, Math.round(sampleRate / envelopeRate));
  const frames = Math.floor(samples.length / frame);
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * frame;
    for (let i = 0; i < frame; i++) {
      const s = samples[start + i];
      sum += s * s;
    }
    energy[f] = Math.sqrt(sum / frame);
  }
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const d = energy[f] - energy[f - 1];
    flux[f] = d > 0 ? d : 0; // half-wave rectify — only rising energy counts as onset
  }
  return { flux, rate: sampleRate / frame };
}

// Fold a raw tempo into the [MIN_BPM, MAX_BPM] window by doubling/halving (octave
// correction). Autocorrelation happily locks onto half- or double-time; this pulls the
// answer back to the range a DJ actually reads without changing the beat phase.
export function foldTempo(bpm: number): number {
  if (!(bpm > 0)) return 0;
  let out = bpm;
  while (out < MIN_BPM) out *= 2;
  while (out > MAX_BPM) out /= 2;
  return out;
}

// ── Automatic BPM ────────────────────────────────────────────────────────────────
//
// Autocorrelate the onset flux over the lags that correspond to MIN_BPM..MAX_BPM and
// pick the strongest — that lag is the beat period. `confidence` is the winning
// correlation over the mean correlation (how much the best lag stands out), normalised
// to [0,1]; a flat, beatless signal scores near 0 so the UI can be honest that
// detection is weak and lean on manual TAP. Deterministic: same samples → same BPM.

export function detectBpm(
  samples: Float32Array,
  sampleRate: number,
): { bpm: number; confidence: number } {
  const { flux, rate } = onsetEnvelope(samples, sampleRate);
  if (flux.length < 4 || rate <= 0) return { bpm: 0, confidence: 0 };

  const minLag = Math.max(1, Math.floor((60 / MAX_BPM) * rate));
  const maxLag = Math.min(flux.length - 1, Math.ceil((60 / MIN_BPM) * rate));
  if (maxLag <= minLag) return { bpm: 0, confidence: 0 };

  let bestLag = minLag;
  let bestScore = -Infinity;
  let sum = 0;
  let count = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = lag; i < flux.length; i++) acc += flux[i] * flux[i - lag];
    acc /= flux.length - lag; // normalise for the shrinking overlap at longer lags
    sum += acc;
    count += 1;
    if (acc > bestScore) {
      bestScore = acc;
      bestLag = lag;
    }
  }

  // A beatless signal (silence, a pure tone) produces no onset energy — every lag
  // correlates to ~0. Report no tempo rather than inventing one from the shortest lag,
  // so the UI stays honest and leans on manual TAP.
  if (!(bestScore > 0)) return { bpm: 0, confidence: 0 };

  const mean = count > 0 ? sum / count : 0;
  const rawBpm = (60 * rate) / bestLag;
  const bpm = Math.round(foldTempo(rawBpm) * 10) / 10; // 0.1-BPM resolution
  const confidence = mean > 0 ? clamp(bestScore / mean - 1, 0, 1) : 0;
  return { bpm, confidence };
}

// ── Manual TAP tempo ─────────────────────────────────────────────────────────────
//
// Turn a series of tap timestamps (seconds) into a BPM by averaging the gaps between
// consecutive taps. Needs at least two taps; more taps average out human jitter. This
// is the honest override for when auto-detection misses (jazz, live, off-beat) — the
// blueprint's manual TAP.

export function tapTempo(tapTimesSec: readonly number[]): number | null {
  if (tapTimesSec.length < 2) return null;
  let total = 0;
  let gaps = 0;
  for (let i = 1; i < tapTimesSec.length; i++) {
    const gap = tapTimesSec[i] - tapTimesSec[i - 1];
    if (gap > 0) {
      total += gap;
      gaps += 1;
    }
  }
  if (gaps === 0) return null;
  const bpm = 60 / (total / gaps);
  return Math.round(clamp(bpm, 40, 220) * 10) / 10;
}

// ── Beatgrid ─────────────────────────────────────────────────────────────────────
//
// A beatgrid is just (firstBeatSec, bpm): every beat sits at firstBeat + n·(60/bpm).
// `beatTimes` lists the beats visible in a [from,to] window (for drawing grid lines
// over the scrolling waveform); `snapToBeat` returns the nearest beat time (for
// quantising cues and loop points to the grid).

export function beatDurationSec(bpm: number): number {
  return bpm > 0 ? 60 / bpm : 0;
}

export function beatTimes(
  bpm: number,
  firstBeatSec: number,
  fromSec: number,
  toSec: number,
): number[] {
  const beat = beatDurationSec(bpm);
  if (beat <= 0 || !(toSec > fromSec)) return [];
  const out: number[] = [];
  // The index of the first beat at or after `from`.
  let n = Math.ceil((fromSec - firstBeatSec) / beat);
  if (!Number.isFinite(n)) return [];
  let t = firstBeatSec + n * beat;
  // Guard against pathological inputs producing a runaway loop.
  const cap = 100_000;
  while (t <= toSec && out.length < cap) {
    if (t >= fromSec) out.push(t);
    n += 1;
    t = firstBeatSec + n * beat;
  }
  return out;
}

export function snapToBeat(timeSec: number, bpm: number, firstBeatSec: number): number {
  const beat = beatDurationSec(bpm);
  if (beat <= 0) return timeSec;
  const n = Math.round((timeSec - firstBeatSec) / beat);
  const snapped = firstBeatSec + n * beat;
  return snapped < 0 ? 0 : snapped;
}

// ── Beat loops ───────────────────────────────────────────────────────────────────
//
// The region [start,end] for a loop of `bars` bars, quantised to the grid — this is
// what replaces the old fixed 2-second loop. The start snaps to the nearest beat so the
// loop is on-grid; the length is bars·BEATS_PER_BAR beats. Both are clamped to the
// buffer so a loop near the end never runs past the track. With no usable BPM it falls
// back to a fixed-seconds loop from the raw playhead (still honest — just not on-grid).

export function beatLoopRegion(
  positionSec: number,
  durationSec: number,
  bpm: number,
  firstBeatSec: number,
  bars: number,
  fallbackSeconds = 2,
): { start: number; end: number } {
  if (!(durationSec > 0)) return { start: 0, end: 0 };
  const beat = beatDurationSec(bpm);

  if (beat <= 0 || !(bars > 0)) {
    const start = clamp(positionSec, 0, durationSec);
    const end = clamp(start + Math.max(0, fallbackSeconds), start, durationSec);
    if (end <= start) return { start: 0, end: durationSec };
    return { start, end };
  }

  const lengthSec = bars * BEATS_PER_BAR * beat;
  let start = snapToBeat(clamp(positionSec, 0, durationSec), bpm, firstBeatSec);
  start = clamp(start, 0, durationSec);
  let end = start + lengthSec;
  // If the on-grid loop would run past the end, pull the whole loop back so its full
  // length still fits (a loop that gets silently truncated would drift off the beat).
  if (end > durationSec) {
    end = durationSec;
    start = clamp(end - lengthSec, 0, durationSec);
  }
  if (end <= start) return { start: 0, end: durationSec };
  return { start, end };
}

// ── How much to trust the BPM readout (DJ-1 honesty) ───────────────────────────
// detectBpm returns a 0..1 confidence alongside the tempo. Showing the number without
// that signal would let a shaky guess look as solid as a locked-in beat, which is
// exactly what the TAP button exists to correct. This turns the raw score into plain
// words a DJ can act on — and says plainly when the DJ tapped the tempo themselves.

export type BpmTrust = "tapped" | "clear" | "fair" | "rough" | "none";

// A confidence at or above this reads as a beat the detector is sure of.
const BPM_TRUST_CLEAR = 0.5;
// Below this the reading is little more than a guess.
const BPM_TRUST_FAIR = 0.2;

export function bpmTrust(input: {
  bpm: number;
  confidence: number;
  tapped: boolean;
}): BpmTrust {
  if (input.tapped) return "tapped";
  if (!(input.bpm > 0)) return "none";
  if (input.confidence >= BPM_TRUST_CLEAR) return "clear";
  if (input.confidence >= BPM_TRUST_FAIR) return "fair";
  return "rough";
}

// The words shown next to the BPM. `none` shows nothing — there is no reading to judge.
export const BPM_TRUST_LABEL: Record<BpmTrust, string | null> = {
  tapped: "You tapped this",
  clear: "Clear beat",
  fair: "Roughly right — tap to correct it",
  rough: "Hard to hear — tap the beat",
  none: null,
};

export function bpmTrustLabel(input: {
  bpm: number;
  confidence: number;
  tapped: boolean;
}): string | null {
  return BPM_TRUST_LABEL[bpmTrust(input)];
}
