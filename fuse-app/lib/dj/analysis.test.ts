import { describe, expect, it } from "vitest";
import {
  BEATS_PER_BAR,
  MAX_BPM,
  MIN_BPM,
  beatLoopRegion,
  beatTimes,
  computePeaks,
  detectBpm,
  foldTempo,
  onsetEnvelope,
  snapToBeat,
  tapTempo,
} from "@/lib/dj/analysis";

// Build a synthetic click track: a short energy burst every (60/bpm) seconds over a
// silent bed. This is a beat the detector must find — deterministic, so the BPM test is
// exact rather than "roughly".
function clickTrack(bpm: number, seconds: number, sampleRate: number): Float32Array {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  const period = Math.round((60 / bpm) * sampleRate);
  const burst = Math.round(sampleRate * 0.01); // 10 ms click
  for (let beat = 0; beat * period < n; beat++) {
    const start = beat * period;
    for (let i = 0; i < burst && start + i < n; i++) {
      // A decaying impulse so the onset (rising edge) is sharp.
      out[start + i] = (1 - i / burst) * (i === 0 ? 1 : 0.8);
    }
  }
  return out;
}

describe("computePeaks", () => {
  it("reduces samples to the requested bucket count, normalised to [0,1]", () => {
    const samples = new Float32Array([0, 0.5, -0.25, 0, 0.2, -1, 0.9, 0]);
    const peaks = computePeaks(samples, 4);
    expect(peaks).toHaveLength(4);
    // The loudest bucket (containing -1) normalises to exactly 1.
    expect(Math.max(...peaks)).toBeCloseTo(1, 10);
    for (const p of peaks) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("is empty for empty input or zero buckets", () => {
    expect(computePeaks(new Float32Array(0), 10)).toHaveLength(0);
    expect(computePeaks(new Float32Array([1, 2, 3]), 0)).toHaveLength(0);
  });
});

describe("foldTempo — octave correction", () => {
  it("pulls half/double-time detections into the readable range", () => {
    expect(foldTempo(240)).toBeCloseTo(120, 10); // double → fold down
    expect(foldTempo(60)).toBeCloseTo(120, 10); // half → fold up
    expect(foldTempo(128)).toBeCloseTo(128, 10); // already in range
    expect(foldTempo(0)).toBe(0);
  });

  it("always lands inside [MIN_BPM, MAX_BPM] for positive input", () => {
    for (const bpm of [45, 70, 95, 128, 175, 200, 300]) {
      const folded = foldTempo(bpm);
      expect(folded).toBeGreaterThanOrEqual(MIN_BPM - 1e-9);
      expect(folded).toBeLessThanOrEqual(MAX_BPM + 1e-9);
    }
  });
});

describe("onsetEnvelope", () => {
  it("half-wave rectifies — only rising energy is kept", () => {
    const sr = 1000;
    const { flux } = onsetEnvelope(clickTrack(120, 2, sr), sr, 100);
    for (const f of flux) expect(f).toBeGreaterThanOrEqual(0);
    expect(Math.max(...flux)).toBeGreaterThan(0); // a click track does have onsets
  });
});

describe("detectBpm", () => {
  it("finds a known tempo on a synthetic click track", () => {
    const sr = 8000;
    for (const bpm of [90, 120, 128, 140]) {
      const { bpm: found, confidence } = detectBpm(clickTrack(bpm, 8, sr), sr);
      expect(found, `expected ~${bpm}, got ${found}`).toBeGreaterThan(bpm - 2);
      expect(found).toBeLessThan(bpm + 2);
      expect(confidence).toBeGreaterThan(0);
    }
  });

  it("is deterministic — same samples give the same answer", () => {
    const sr = 8000;
    const track = clickTrack(126, 8, sr);
    expect(detectBpm(track, sr)).toEqual(detectBpm(track, sr));
  });

  it("reports zero BPM and no confidence on silence", () => {
    const { bpm, confidence } = detectBpm(new Float32Array(8000), 8000);
    expect(bpm).toBe(0);
    expect(confidence).toBe(0);
  });
});

describe("tapTempo", () => {
  it("averages tap gaps into a BPM", () => {
    // Taps 0.5 s apart → 120 BPM.
    expect(tapTempo([0, 0.5, 1.0, 1.5])).toBeCloseTo(120, 5);
  });
  it("needs at least two taps", () => {
    expect(tapTempo([])).toBeNull();
    expect(tapTempo([1])).toBeNull();
  });
  it("clamps absurd tap rates into a sane range", () => {
    const fast = tapTempo([0, 0.001, 0.002]); // ~30000 BPM raw
    expect(fast).toBeLessThanOrEqual(220);
  });
});

describe("beatTimes + snapToBeat — the beatgrid", () => {
  it("lists the beats visible in a window", () => {
    // 120 BPM → a beat every 0.5 s; first beat at 0.
    const beats = beatTimes(120, 0, 0, 2.01);
    expect(beats).toEqual([0, 0.5, 1, 1.5, 2]);
  });
  it("respects a non-zero first-beat offset", () => {
    const beats = beatTimes(120, 0.1, 0, 1.11);
    expect(beats[0]).toBeCloseTo(0.1, 10);
    expect(beats[1]).toBeCloseTo(0.6, 10);
  });
  it("snaps a time to the nearest beat", () => {
    expect(snapToBeat(0.6, 120, 0)).toBeCloseTo(0.5, 10);
    expect(snapToBeat(0.8, 120, 0)).toBeCloseTo(1.0, 10);
  });
  it("returns no beats for a non-positive BPM", () => {
    expect(beatTimes(0, 0, 0, 10)).toEqual([]);
  });
});

describe("beatLoopRegion — on-grid beat loops replace the fixed 2 s loop", () => {
  it("sizes a loop to bars·beats and snaps the start to the grid", () => {
    // 120 BPM, first beat 0. A 1-bar loop = 4 beats = 2 s. Playhead 0.6 snaps to 0.5.
    const r = beatLoopRegion(0.6, 60, 120, 0, 1);
    expect(r.start).toBeCloseTo(0.5, 10);
    expect(r.end).toBeCloseTo(2.5, 10); // 0.5 + 2 s
  });

  it("sizes 1/2/4/8 bar loops to the right length", () => {
    const beat = 0.5; // 120 BPM
    for (const bars of [0.5, 1, 2, 4, 8]) {
      const r = beatLoopRegion(0, 120, 120, 0, bars);
      expect(r.end - r.start).toBeCloseTo(bars * BEATS_PER_BAR * beat, 6);
    }
  });

  it("pulls a loop that would overrun the end back so its full length still fits", () => {
    // A 4-bar (8 s at 120 BPM) loop near a 10 s track's end keeps its full 8 s length.
    const r = beatLoopRegion(9.5, 10, 120, 0, 4);
    expect(r.end).toBeCloseTo(10, 6);
    expect(r.end - r.start).toBeCloseTo(8, 6);
  });

  it("falls back to a fixed-seconds loop when there is no usable BPM", () => {
    const r = beatLoopRegion(4, 30, 0, 0, 1, 2);
    expect(r.start).toBeCloseTo(4, 10);
    expect(r.end).toBeCloseTo(6, 10);
  });

  it("returns an empty region for a zero-length track", () => {
    expect(beatLoopRegion(0, 0, 120, 0, 1)).toEqual({ start: 0, end: 0 });
  });
});
