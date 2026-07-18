import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LOOP_SECONDS,
  EQ_GAIN_RANGE,
  clampEqGain,
  clampRate,
  createDjDeckEngine,
  loopRegion,
  scratchRate,
  type AudioBufferLike,
  type AudioContextLike,
  type BiquadLike,
  type BufferSourceLike,
  type DelayLike,
  type GainLike,
} from "@/lib/dj/engine";

// ── Pure helpers (no AudioContext) ──────────────────────────────────────────────

describe("clampEqGain", () => {
  it("clamps to the ±12 dB throw and maps NaN to flat", () => {
    const [min, max] = EQ_GAIN_RANGE;
    expect(clampEqGain(0)).toBe(0);
    expect(clampEqGain(100)).toBe(max);
    expect(clampEqGain(-100)).toBe(min);
    expect(clampEqGain(Number.NaN)).toBe(0);
  });
});

describe("clampRate", () => {
  it("clamps to the local rate window and maps NaN to 1", () => {
    expect(clampRate(1)).toBe(1);
    expect(clampRate(9)).toBe(2);
    expect(clampRate(0.01)).toBe(0.25);
    expect(clampRate(Number.NaN)).toBe(1);
  });
});

describe("scratchRate", () => {
  it("is the base rate at rest and bends up/down under deflection", () => {
    expect(scratchRate(1, 0)).toBe(1);
    expect(scratchRate(1, 1)).toBeGreaterThan(1);
    expect(scratchRate(1, -1)).toBeLessThan(1);
  });
  it("never runs outside the rate window", () => {
    expect(scratchRate(2, 1)).toBeLessThanOrEqual(2);
    expect(scratchRate(0.25, -1)).toBeGreaterThanOrEqual(0.25);
  });
});

describe("loopRegion", () => {
  it("captures a region from the playhead inside the buffer", () => {
    const r = loopRegion(4, 30, 2);
    expect(r.start).toBe(4);
    expect(r.end).toBe(6);
  });
  it("clamps the region end to the buffer duration", () => {
    const r = loopRegion(29, 30, DEFAULT_LOOP_SECONDS);
    expect(r.start).toBe(29);
    expect(r.end).toBe(30);
  });
  it("loops the whole track when the playhead sits at the very end", () => {
    const r = loopRegion(30, 30, 2);
    expect(r).toEqual({ start: 0, end: 30 });
  });
  it("returns an empty region for a zero-length buffer", () => {
    expect(loopRegion(0, 0, 2)).toEqual({ start: 0, end: 0 });
  });
});

// ── Fake Web Audio graph (records params + connections) ─────────────────────────

class FakeParam {
  constructor(public value: number) {}
}
class FakeNode {
  connections: FakeNode[] = [];
  connect(dest: FakeNode): FakeNode {
    this.connections.push(dest);
    return dest;
  }
  disconnect(): void {
    this.connections = [];
  }
}
class FakeGain extends FakeNode implements GainLike {
  gain = new FakeParam(1);
}
class FakeBiquad extends FakeNode implements BiquadLike {
  type = "";
  frequency = new FakeParam(0);
  Q = new FakeParam(0);
  gain = new FakeParam(0);
}
class FakeDelay extends FakeNode implements DelayLike {
  delayTime = new FakeParam(0);
}
class FakeSource extends FakeNode implements BufferSourceLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  startOffset = 0;
  start(_when?: number, offset?: number): void {
    this.started = true;
    this.startOffset = offset ?? 0;
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeContext implements AudioContextLike {
  state = "running";
  currentTime = 0;
  destination = new FakeNode();
  gains: FakeGain[] = [];
  biquads: FakeBiquad[] = [];
  sources: FakeSource[] = [];
  closed = false;
  createGain(): GainLike {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBiquadFilter(): BiquadLike {
    const b = new FakeBiquad();
    this.biquads.push(b);
    return b;
  }
  createDelay(): DelayLike {
    return new FakeDelay();
  }
  createBufferSource(): BufferSourceLike {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  async decodeAudioData(): Promise<AudioBufferLike> {
    return { duration: 30 };
  }
  async resume(): Promise<void> {
    this.state = "running";
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  // Test helpers.
  biquadOfType(type: string): FakeBiquad {
    const node = this.biquads.find((b) => b.type === type);
    if (!node) throw new Error(`no ${type} biquad`);
    return node;
  }
  crossGain(): FakeGain {
    // master, crossGain, deckGain, feedback, wet — in creation order.
    return this.gains[1];
  }
  wetGain(): FakeGain {
    return this.gains[4];
  }
  lastSource(): FakeSource {
    return this.sources[this.sources.length - 1];
  }
}

async function loadedEngine() {
  const ctx = new FakeContext();
  const engine = createDjDeckEngine(() => ctx);
  await engine.loadArrayBuffer(new ArrayBuffer(8));
  return { ctx, engine };
}

describe("createDjDeckEngine — the audio graph", () => {
  let ctx: FakeContext;
  let engine: ReturnType<typeof createDjDeckEngine>;

  beforeEach(async () => {
    const built = await loadedEngine();
    ctx = built.ctx;
    engine = built.engine;
  });

  it("reports available with a real context and hasTrack once decoded", () => {
    expect(engine.available).toBe(true);
    expect(engine.hasTrack).toBe(true);
    expect(engine.duration()).toBe(30);
  });

  it("wires the three EQ bands as low-shelf / peak / high-shelf", () => {
    expect(ctx.biquadOfType("lowshelf")).toBeTruthy();
    expect(ctx.biquadOfType("peaking")).toBeTruthy();
    expect(ctx.biquadOfType("highshelf")).toBeTruthy();
  });

  it("turning the Low EQ changes the low-shelf filter gain on real audio", () => {
    engine.setEq("low", 9);
    expect(ctx.biquadOfType("lowshelf").gain.value).toBe(9);
    engine.setEq("low", 999); // clamped to the throw
    expect(ctx.biquadOfType("lowshelf").gain.value).toBe(EQ_GAIN_RANGE[1]);
  });

  it("the crossfader drives the deck's crossfade gain (equal-power blend)", () => {
    engine.setCrossfade(0.4);
    expect(ctx.crossGain().gain.value).toBeCloseTo(0.4, 10);
    engine.setCrossfade(5); // clamped to 0..1
    expect(ctx.crossGain().gain.value).toBe(1);
  });

  it("play starts a source that feeds the EQ chain at normal rate", () => {
    engine.play();
    expect(engine.playing).toBe(true);
    const src = ctx.lastSource() as FakeSource;
    expect(src.started).toBe(true);
    expect(src.playbackRate.value).toBe(1);
    // source → lowshelf is the head of the graph.
    expect(src.connections).toContain(ctx.biquadOfType("lowshelf"));
  });

  it("engaging a loop sets a seamless region on the live source", () => {
    engine.play();
    engine.setLoop(true);
    const src = ctx.lastSource() as FakeSource;
    expect(src.loop).toBe(true);
    expect(src.loopEnd).toBeGreaterThan(src.loopStart);
    engine.setLoop(false);
    expect(src.loop).toBe(false);
  });

  it("the echo FX opens the wet path only when engaged", () => {
    expect(ctx.wetGain().gain.value).toBe(0);
    engine.setEcho(true);
    expect(ctx.wetGain().gain.value).toBeGreaterThan(0);
    engine.setEcho(false);
    expect(ctx.wetGain().gain.value).toBe(0);
  });

  it("scratch bends the live playback rate and springs back on release", () => {
    engine.play();
    engine.setRate(1);
    engine.scratch(1);
    const src = ctx.lastSource() as FakeSource;
    expect(src.playbackRate.value).toBeGreaterThan(1);
    engine.endScratch();
    expect(src.playbackRate.value).toBe(1);
  });

  it("pause retains position and toggle flips playback", () => {
    engine.play();
    expect(engine.toggle()).toBe(false); // was playing → now paused
    expect(engine.playing).toBe(false);
    expect(engine.toggle()).toBe(true); // resumes
    expect(engine.playing).toBe(true);
  });

  it("dispose stops audio and frees the decoded buffer (bytes leave memory)", () => {
    engine.play();
    engine.dispose();
    expect(ctx.closed).toBe(true);
    expect(engine.hasTrack).toBe(false);
  });
});

describe("createDjDeckEngine — no Web Audio (SSR / Node / unsupported)", () => {
  it("is an inert, honest no-op engine when no context can be built", async () => {
    const engine = createDjDeckEngine(() => null);
    expect(engine.available).toBe(false);
    // None of these throw, and nothing ever claims to play.
    await engine.loadArrayBuffer(new ArrayBuffer(8));
    engine.play();
    expect(engine.playing).toBe(false);
    expect(engine.hasTrack).toBe(false);
    engine.setEq("mid", 3);
    engine.dispose();
  });
});
