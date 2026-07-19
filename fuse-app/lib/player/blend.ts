// Auto-crossfade blend engine (U11, R3/R16, F2, KTD-6/KTD-7) — the fusion signature.
//
// "Fuse means blend." In normal listening a track never cuts to silence: as the
// current song nears its end, the next queued track melts in over the user's chosen
// crossfade length while the two OVERLAP with an equal-power volume curve. This file
// is that scheduler.
//
// SHAPE (the class-level discipline from playback-health.ts): the timing + gain math
// is a set of PURE functions, unit-tested in node with no DOM and no player. The
// BlendController wires those decisions to two injectable ports — a source adapter
// that can run a real two-player overlap (the YouTube adapter, U7) and the unified
// store (U5) — so the controller itself is testable with fakes and the real audio is
// confirmed on the owner's screen (the Phase D checkpoint), never faked here.
//
// HONESTY (R17): the controller is INERT unless every precondition for a real blend
// holds (something is playing, the current and next tracks are both a source whose
// adapter can genuinely overlap two players, the track is long enough, and we are
// inside the crossfade tail). When it cannot blend it does nothing and the ordinary
// end-of-track advance (the adapter's ENDED handler) still fires — no silent freeze,
// and the crossfade-length setting only ever affects a transition that truly happens.

import type { TrackRef, TrackSource } from "@/lib/repos/track";
import type { PlayerState } from "@/lib/player/types";
import {
  CROSSFADE_DEFAULT_SEC,
  CROSSFADE_MAX_SEC,
  CROSSFADE_MIN_SEC,
} from "@/lib/repos/settings";

// ── Pure timing + gain math (unit-tested without a DOM) ─────────────────────────

// Equal-power crossfade gains for a blend `progress` in [0, 1]. The outgoing track
// follows cos(p·π/2) and the incoming cos((1−p)·π/2) = sin(p·π/2), so their POWER
// sums to one (out² + in² = 1) across the whole transition — the perceived loudness
// stays constant instead of dipping in the middle (the reference curve the old
// DJEngine used: cos((p·π)/2)). Progress is clamped so callers can pass raw values.
export function equalPowerGains(progress: number): {
  outgoing: number;
  incoming: number;
} {
  const p = clamp01(progress);
  return {
    outgoing: Math.cos((p * Math.PI) / 2),
    incoming: Math.cos(((1 - p) * Math.PI) / 2),
  };
}

// The playback position at which the blend must BEGIN so the incoming track has the
// full crossfade window to melt in before the outgoing one ends: duration − crossfade
// (never negative). A track shorter than the crossfade would have a zero threshold,
// which `canBlend` rejects separately so we never "blend" a clip too short to overlap.
export function blendStartThresholdSec(
  durationSec: number,
  crossfadeSec: number,
): number {
  return Math.max(0, durationSec - crossfadeSec);
}

// A track must be comfortably longer than the crossfade for an overlap to make sense
// (otherwise the blend would start at or before the very first second). This margin
// is the honest floor below which we simply hard-cut to the next track instead.
export const MIN_BLENDABLE_HEADROOM_SEC = 1;

export function canBlendDuration(
  durationSec: number,
  crossfadeSec: number,
): boolean {
  return durationSec > crossfadeSec + MIN_BLENDABLE_HEADROOM_SEC;
}

// Should a blend start on this observation? True only when we are playing, not
// already blending, a next track exists, both the current and next sources can run a
// real two-player overlap, the current track is long enough, and the position has
// entered the crossfade tail. Every guard here is what keeps the engine inert during
// ordinary mid-track playback (protecting the U7/U8 single-track path).
export type BlendDecisionInput = {
  isPlaying: boolean;
  alreadyBlending: boolean;
  positionSec: number;
  durationSec: number;
  crossfadeSec: number;
  currentSource: TrackSource | null;
  nextSource: TrackSource | null;
  // The sources whose adapter can genuinely overlap two players for an auto-crossfade.
  blendableSources: readonly TrackSource[];
};

export function shouldStartBlend(input: BlendDecisionInput): boolean {
  if (!input.isPlaying || input.alreadyBlending) return false;
  if (input.durationSec <= 0) return false;
  if (input.currentSource == null || input.nextSource == null) return false;
  if (!input.blendableSources.includes(input.currentSource)) return false;
  if (!input.blendableSources.includes(input.nextSource)) return false;
  if (!canBlendDuration(input.durationSec, input.crossfadeSec)) return false;
  const threshold = blendStartThresholdSec(input.durationSec, input.crossfadeSec);
  return input.positionSec >= threshold;
}

// Linear progress of an in-flight blend from wall-clock elapsed time, clamped to
// [0, 1]. Driven by the clock rather than the ~2 Hz player poll so the volume ramp
// and the melt-panel bar move smoothly rather than in coarse half-second steps.
export function blendProgressFromElapsed(
  elapsedMs: number,
  crossfadeSec: number,
): number {
  const durationMs = Math.max(1, crossfadeSec * 1000);
  return clamp01(elapsedMs / durationMs);
}

// Clamp a crossfade length to the honest 3–15s window (mirrors the settings repo, so
// a stray value from anywhere degrades to a real, usable length).
export function clampCrossfadeSec(seconds: number): number {
  if (!Number.isFinite(seconds)) return CROSSFADE_DEFAULT_SEC;
  return Math.min(CROSSFADE_MAX_SEC, Math.max(CROSSFADE_MIN_SEC, Math.round(seconds)));
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// ── The controller (wires pure decisions to injectable ports) ───────────────────

// The blend-side surface a source adapter must expose to run a real two-player
// overlap. The YouTube adapter (U7) implements this: `beginBlend` warms a SECOND
// visible iframe on the incoming track, `setBlendVolumes` cross-ramps the two, and
// `completeBlend` promotes the incoming player to primary with no reload (so the
// audio never restarts). Any source without a genuine overlap simply is not listed
// in `blendableSources`, so the controller never calls these for it.
export type BlendAdapterPorts = {
  readonly source: TrackSource;
  beginBlend(track: TrackRef): Promise<void>;
  setBlendVolumes(outgoing01: number, incoming01: number): void;
  completeBlend(): void;
  cancelBlend(): void;
  // Restore the (post-promotion) primary player to full volume after a blend.
  setVolume(volume01: number): void;
};

// The slice of the store the controller reads and drives. `promoteBlended` makes the
// already-playing incoming track the single source of truth without a reload.
export type BlendStorePorts = {
  getState(): PlayerState;
  subscribe(listener: () => void): () => void;
  promoteBlended(track: TrackRef): void;
};

export type BlendTimers = {
  setInterval(handler: () => void, ms: number): number;
  clearInterval(id: number): void;
  now(): number;
};

export type MeltState = {
  // True only while a real crossfade is under way — the melt panel renders from this.
  active: boolean;
  // The track melting in, or null when no blend is running.
  incoming: TrackRef | null;
  // 0..1 progress of the current blend (drives the melt-panel bar).
  progress: number;
};

const IDLE_MELT: MeltState = { active: false, incoming: null, progress: 0 };

export type BlendControllerOptions = {
  store: BlendStorePorts;
  // Resolve the adapter that can blend a given source, or null if none can. In the
  // app this returns the YouTube adapter for "youtube" and null otherwise (until
  // local/Spotify overlap lands); tests pass a fake.
  resolveBlendAdapter: (source: TrackSource) => BlendAdapterPorts | null;
  // Current crossfade length in seconds (the persisted user setting, kept in memory
  // and updated live by the profile-sheet slider). A getter so the latest value is
  // always read at the moment a blend starts.
  getCrossfadeSec: () => number;
  timers?: BlendTimers;
  // How often the in-flight ramp updates gains + melt progress.
  rampMs?: number;
};

// Frequency of the gain/progress ramp while a blend runs (smooth, ~20 fps).
const DEFAULT_RAMP_MS = 50;

export class BlendController {
  private readonly store: BlendStorePorts;
  private readonly resolveBlendAdapter: (
    source: TrackSource,
  ) => BlendAdapterPorts | null;
  private readonly getCrossfadeSec: () => number;
  private readonly timers: BlendTimers;
  private readonly rampMs: number;

  private unsubscribe: (() => void) | null = null;

  // Non-null only while a blend is in flight.
  private blend:
    | {
        adapter: BlendAdapterPorts;
        outgoing: TrackRef;
        incoming: TrackRef;
        crossfadeSec: number;
        startMs: number;
        rampId: number;
      }
    | null = null;

  private melt: MeltState = IDLE_MELT;
  private readonly meltListeners = new Set<() => void>();

  constructor(options: BlendControllerOptions) {
    this.store = options.store;
    this.resolveBlendAdapter = options.resolveBlendAdapter;
    this.getCrossfadeSec = options.getCrossfadeSec;
    this.rampMs = options.rampMs ?? DEFAULT_RAMP_MS;
    this.timers =
      options.timers ??
      ({
        setInterval: (handler, ms) =>
          globalThis.setInterval(handler, ms) as unknown as number,
        clearInterval: (id) => globalThis.clearInterval(id),
        now: () => Date.now(),
      } satisfies BlendTimers);
  }

  // Begin watching the store. Idempotent. The controller reacts to every state change
  // (position updates arrive ~2/s from the active adapter's poll) and, when the tail
  // is reached, starts a blend. Returns an unsubscribe so a client can tear it down.
  start(): () => void {
    if (this.unsubscribe) return this.unsubscribe;
    this.unsubscribe = this.store.subscribe(() => this.onStoreChange());
    return () => this.stop();
  }

  stop(): void {
    this.cancelActiveBlend();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  getMeltState(): MeltState {
    return this.melt;
  }

  subscribeMelt(listener: () => void): () => void {
    this.meltListeners.add(listener);
    return () => {
      this.meltListeners.delete(listener);
    };
  }

  // The blendable sources are exactly those a registered adapter can overlap.
  private blendableSources(current: TrackSource | null, next: TrackSource | null): TrackSource[] {
    const out: TrackSource[] = [];
    for (const s of [current, next]) {
      if (s && this.resolveBlendAdapter(s)) out.push(s);
    }
    return out;
  }

  private onStoreChange(): void {
    const state = this.store.getState();

    // If a blend is running, guard it against a manual jump: the user hitting next /
    // previous / picking a new track changes `current` out from under us. When that
    // happens, abandon the blend cleanly rather than fighting the user's choice.
    if (this.blend) {
      const cur = state.current;
      const isOutgoing =
        cur != null && sameTrack(cur, this.blend.outgoing);
      const isIncoming =
        cur != null && sameTrack(cur, this.blend.incoming);
      if (!isOutgoing && !isIncoming) {
        this.cancelActiveBlend();
      }
      return; // while blending, the ramp interval owns gains/progress
    }

    // Sleep timer "stop at end of track" (Wave 1): do NOT start a crossfade — a blend would
    // promote the next track before this one truly ends and slip past the stop. Skipping the
    // blend lets the track hard-end so the store's end-of-track pause is honoured honestly.
    if (state.sleepStopAfterTrack) return;

    const current = state.current;
    const next = state.queue[0] ?? null;
    const crossfadeSec = clampCrossfadeSec(this.getCrossfadeSec());
    const blendable = this.blendableSources(
      current?.source ?? null,
      next?.source ?? null,
    );

    const go = shouldStartBlend({
      isPlaying: state.isPlaying,
      alreadyBlending: false,
      positionSec: state.positionSec,
      durationSec: state.durationSec,
      crossfadeSec,
      currentSource: current?.source ?? null,
      nextSource: next?.source ?? null,
      blendableSources: blendable,
    });

    if (go && current && next) {
      void this.startBlend(current, next, crossfadeSec);
    }
  }

  private async startBlend(
    outgoing: TrackRef,
    incoming: TrackRef,
    crossfadeSec: number,
  ): Promise<void> {
    // Both tracks must blend through the SAME adapter's two-player overlap (auto-
    // crossfade is within-source in v1: two YouTube iframes). If they differ, skip.
    const adapter = this.resolveBlendAdapter(outgoing.source);
    if (!adapter || adapter.source !== incoming.source) return;
    if (this.blend) return; // race guard

    // Reserve the blend slot before the async warm-up so a second store tick during
    // `beginBlend` cannot start a duplicate blend.
    const startMs = this.timers.now();
    this.blend = {
      adapter,
      outgoing,
      incoming,
      crossfadeSec,
      startMs,
      rampId: -1,
    };
    this.setMelt({ active: true, incoming, progress: 0 });

    // Incoming starts fully attenuated so its autoplay is silent (satisfies browser
    // autoplay policy — it inherits the gesture context of the first play), then the
    // ramp brings it up. Outgoing stays at full until the ramp pulls it down.
    adapter.setBlendVolumes(1, 0);
    try {
      await adapter.beginBlend(incoming);
    } catch {
      // Warm-up failed (e.g. the video is unplayable): abandon honestly so the
      // ordinary end-of-track advance still carries listening forward.
      this.cancelActiveBlend();
      return;
    }
    // A manual jump during warm-up may have cancelled us; only arm the ramp if still live.
    if (!this.blend || this.blend.startMs !== startMs) return;

    this.blend.rampId = this.timers.setInterval(() => this.ramp(), this.rampMs);
  }

  private ramp(): void {
    if (!this.blend) return;
    const elapsed = this.timers.now() - this.blend.startMs;
    const progress = blendProgressFromElapsed(elapsed, this.blend.crossfadeSec);
    const { outgoing, incoming } = equalPowerGains(progress);
    this.blend.adapter.setBlendVolumes(outgoing, incoming);
    this.setMelt({ active: true, incoming: this.blend.incoming, progress });

    if (progress >= 1) this.completeBlend();
  }

  private completeBlend(): void {
    const blend = this.blend;
    if (!blend) return;
    this.timers.clearInterval(blend.rampId);
    // Promote the already-playing incoming player to primary WITHOUT a reload (no
    // restart, no cut to silence), restore it to full volume, and make it the single
    // source of truth. The outgoing player is retired inside completeBlend().
    blend.adapter.completeBlend();
    blend.adapter.setVolume(1);
    this.blend = null;
    this.store.promoteBlended(blend.incoming);
    this.setMelt(IDLE_MELT);
  }

  private cancelActiveBlend(): void {
    const blend = this.blend;
    if (!blend) return;
    if (blend.rampId !== -1) this.timers.clearInterval(blend.rampId);
    blend.adapter.cancelBlend();
    // Return the primary to full volume — a mid-ramp cancel must not leave it quiet.
    blend.adapter.setVolume(1);
    this.blend = null;
    this.setMelt(IDLE_MELT);
  }

  private setMelt(next: MeltState): void {
    this.melt = next;
    for (const listener of this.meltListeners) listener();
  }
}

function sameTrack(a: TrackRef, b: TrackRef): boolean {
  return a.source === b.source && a.nativeId === b.nativeId;
}
