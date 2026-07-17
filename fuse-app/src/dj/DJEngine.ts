// A real dual-deck DJ engine built on the Web Audio API.
//
// This is NOT a mockup: each deck runs an audio graph
//   source -> lowShelf -> midPeak -> highShelf -> deckGain -> crossfadeGain -> master
// so the EQ knobs, per-deck volume and the crossfader all affect real sound.
//
// Decks can load a user's local audio file, or fall back to a synthesized
// looping beat so the engine is audible with zero assets.

export type EqBand = 'low' | 'mid' | 'high';

/** Render a short looping beat (kick + hat) so a deck is audible without files. */
function synthLoop(ctx: BaseAudioContext, bpm: number, brightness: number): AudioBuffer {
  const beats = 4;
  const secPerBeat = 60 / bpm;
  const length = Math.ceil(secPerBeat * beats * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const sr = ctx.sampleRate;

  for (let b = 0; b < beats; b++) {
    // Kick on every beat.
    const kickStart = Math.floor(b * secPerBeat * sr);
    const kickLen = Math.floor(0.18 * sr);
    for (let i = 0; i < kickLen; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 18);
      const freq = 120 * Math.exp(-t * 30) + 45; // pitch drop
      data[kickStart + i] += Math.sin(2 * Math.PI * freq * t) * env * 0.9;
    }
    // Hats on the off-beats.
    const hatStart = Math.floor((b + 0.5) * secPerBeat * sr);
    const hatLen = Math.floor(0.05 * sr);
    for (let i = 0; i < hatLen && hatStart + i < length; i++) {
      const env = Math.exp(-(i / sr) * 60);
      data[hatStart + i] += (Math.random() * 2 - 1) * env * 0.25 * brightness;
    }
  }
  return buffer;
}

class Deck {
  private ctx: AudioContext;
  private low: BiquadFilterNode;
  private mid: BiquadFilterNode;
  private high: BiquadFilterNode;
  private deckGain: GainNode;
  readonly crossGain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private startedAt = 0;
  private offset = 0;
  playing = false;

  constructor(ctx: AudioContext, master: GainNode, bpm: number, brightness: number) {
    this.ctx = ctx;
    this.low = ctx.createBiquadFilter();
    this.low.type = 'lowshelf';
    this.low.frequency.value = 200;
    this.mid = ctx.createBiquadFilter();
    this.mid.type = 'peaking';
    this.mid.frequency.value = 1000;
    this.mid.Q.value = 1;
    this.high = ctx.createBiquadFilter();
    this.high.type = 'highshelf';
    this.high.frequency.value = 3500;

    this.deckGain = ctx.createGain();
    this.crossGain = ctx.createGain();

    this.low.connect(this.mid);
    this.mid.connect(this.high);
    this.high.connect(this.deckGain);
    this.deckGain.connect(this.crossGain);
    this.crossGain.connect(master);

    this.buffer = synthLoop(ctx, bpm, brightness);
  }

  async loadFile(file: File): Promise<void> {
    const arr = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arr);
    if (this.playing) { this.stop(); this.play(); }
  }

  play(): void {
    if (this.playing || !this.buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.connect(this.low);
    src.start(0, this.offset % this.buffer.duration);
    this.source = src;
    this.startedAt = this.ctx.currentTime;
    this.playing = true;
  }

  stop(): void {
    if (!this.source) return;
    this.offset += this.ctx.currentTime - this.startedAt;
    try { this.source.stop(); } catch { /* already stopped */ }
    this.source.disconnect();
    this.source = null;
    this.playing = false;
  }

  toggle(): boolean {
    if (this.playing) this.stop(); else this.play();
    return this.playing;
  }

  setEq(band: EqBand, gainDb: number): void {
    const node = band === 'low' ? this.low : band === 'mid' ? this.mid : this.high;
    node.gain.value = gainDb;
  }

  /** Position 0..1 within the current loop, for the moving playhead. */
  progress(): number {
    if (!this.buffer) return 0;
    const played = this.offset + (this.playing ? this.ctx.currentTime - this.startedAt : 0);
    return (played % this.buffer.duration) / this.buffer.duration;
  }
}

export class DJEngine {
  private ctx: AudioContext;
  private master: GainNode;
  readonly a: Deck;
  readonly b: Deck;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.a = new Deck(this.ctx, this.master, 123, 1);
    this.b = new Deck(this.ctx, this.master, 123, 1.6);
    this.setCrossfade(0.5);
  }

  /** Browsers require a user gesture before audio can start. */
  resume(): Promise<void> {
    return this.ctx.state === 'suspended' ? this.ctx.resume() : Promise.resolve();
  }

  /** 0 = full A, 1 = full B (equal-power curve). */
  setCrossfade(pos: number): void {
    const p = Math.min(1, Math.max(0, pos));
    this.a.crossGain.gain.value = Math.cos((p * Math.PI) / 2);
    this.b.crossGain.gain.value = Math.cos(((1 - p) * Math.PI) / 2);
  }
}
