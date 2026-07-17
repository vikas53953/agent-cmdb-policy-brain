// Unified player store (U5, KTD-6, R2/R3/R4).
//
// This is the single source of playback truth. Every UI surface subscribes to it and
// renders from the snapshot it returns; nothing else holds playback state. The store
// is framework-free (a tiny observable, not a React hook) so it can be unit-tested in
// node and driven from anywhere. React surfaces subscribe via useSyncExternalStore in
// their own units.
//
// The store's public API is deliberately SOURCE-AGNOSTIC (the class-level fix for the
// old app, whose playback logic only ever wired YouTube). It never branches on
// `source`. To act on real sound it asks the adapter registry for the adapter of the
// current track's source and calls that adapter's generic methods. When no adapter is
// registered for a source (as in U5, before any land), the store updates the chosen
// track but honestly leaves `isPlaying` false — it will not claim to be playing
// something it cannot play (R17 at the state layer).

import type { TrackRef } from "@/lib/repos/track";
import type { PlayerState, RepeatMode, SourceAdapter } from "@/lib/player/types";
import { adapterRegistry, type AdapterRegistry } from "@/lib/player/adapters";

export type PlayerListener = (state: PlayerState) => void;

const INITIAL_STATE: PlayerState = {
  current: null,
  queue: [],
  isPlaying: false,
  positionSec: 0,
  durationSec: 0,
  shuffle: false,
  repeat: "off",
};

export type PlayerStoreOptions = {
  // Registry the store resolves adapters from. Defaults to the shared app registry;
  // tests pass their own so a fake adapter can drive delegation in isolation.
  registry?: AdapterRegistry;
  // Optional starting state (mainly for tests and SSR hydration).
  initial?: Partial<PlayerState>;
};

export class PlayerStore {
  private state: PlayerState;
  private readonly listeners = new Set<PlayerListener>();
  private readonly registry: AdapterRegistry;
  // The adapter currently producing (or paused on) sound, so pause/seek/volume/rate
  // reach the right player without the store branching on source.
  private activeAdapter: SourceAdapter | null = null;

  constructor(options: PlayerStoreOptions = {}) {
    this.registry = options.registry ?? adapterRegistry;
    this.state = { ...INITIAL_STATE, ...options.initial };
  }

  // Read-only snapshot of the single truth. Callers must not mutate it.
  getState(): PlayerState {
    return this.state;
  }

  // Subscribe to state changes; returns an unsubscribe function.
  subscribe(listener: PlayerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  // Replace the upcoming queue (does not touch the current track).
  setQueue(tracks: readonly TrackRef[]): void {
    this.set({ queue: [...tracks] });
  }

  // Play a track (or resume the current one). Resolves the adapter for the track's
  // source and delegates; only marks `isPlaying` true once an adapter has acted, so
  // the state never lies about producing sound. Returns whether playback started.
  async play(track?: TrackRef): Promise<boolean> {
    const target = track ?? this.state.current;
    if (!target) return false;

    const adapter = this.registry.get(target.source);
    // Switch active adapter if the source changed; stop the previous one honestly.
    if (this.activeAdapter && this.activeAdapter !== adapter) {
      this.activeAdapter.pause();
      this.activeAdapter.unload();
    }
    this.activeAdapter = adapter ?? null;

    if (!adapter) {
      // No engine for this source yet: focus the track but do not fake playback.
      this.set({ current: target, isPlaying: false, positionSec: 0 });
      return false;
    }

    // Optimistic focus: reflect the chosen track in state BEFORE we create/start the
    // underlying player, so a source whose UI surface depends on `current` (the visible
    // YouTube video, U7/KTD-7) mounts on-screen first and the player is created inside a
    // visible container rather than a hidden one. `isPlaying` stays honest — it flips to
    // true only after the adapter has actually acted (R17 at the state layer).
    this.set({ current: target, isPlaying: false, positionSec: 0 });
    await adapter.load(target);
    await adapter.play();
    this.set({ isPlaying: true });
    return true;
  }

  // Pause the active adapter. No-op (but still reflects intent) when nothing plays.
  pause(): void {
    this.activeAdapter?.pause();
    this.set({ isPlaying: false });
  }

  // Resume the current track. Convenience alias over play() with no argument.
  async resume(): Promise<boolean> {
    return this.play();
  }

  // Toggle between playing and paused for the current track.
  async toggle(): Promise<void> {
    if (this.state.isPlaying) {
      this.pause();
    } else {
      await this.resume();
    }
  }

  // Re-issue playback on the active adapter WITHOUT resetting position — the stall
  // recovery nudge Now Playing's retry path calls (U8, AE1). Honest no-op when
  // nothing is actively playing, so it never fakes a recovery it cannot perform.
  async retry(): Promise<void> {
    if (!this.activeAdapter || !this.state.current) return;
    await this.activeAdapter.play();
  }

  // Advance to the next queued track (honouring repeat and shuffle). Returns false
  // when the queue is exhausted and repeat is off.
  async next(): Promise<boolean> {
    if (this.state.repeat === "one" && this.state.current) {
      return this.play(this.state.current);
    }
    if (this.state.queue.length === 0) {
      if (this.state.repeat === "all" && this.state.current) {
        return this.play(this.state.current);
      }
      return false;
    }
    // Shuffle picks a random track from the queue instead of the head, so the shuffle
    // control does something REAL (R17) — not a flag that changes nothing. With
    // shuffle off it always picks index 0, i.e. plain in-order advance.
    const pickIndex = this.state.shuffle
      ? Math.floor(Math.random() * this.state.queue.length)
      : 0;
    const head = this.state.queue[pickIndex];
    const rest = this.state.queue.filter((_, i) => i !== pickIndex);
    // If repeat is "all", the finished current track rejoins the tail of the queue.
    const nextQueue =
      this.state.repeat === "all" && this.state.current
        ? [...rest, this.state.current]
        : rest;
    this.set({ queue: nextQueue });
    return this.play(head);
  }

  // Restart the current track from the top (prototype prev behaviour).
  async previous(): Promise<boolean> {
    if (!this.state.current) return false;
    this.seek(0);
    return this.play(this.state.current);
  }

  // Seek to an absolute position; delegates to the active adapter and mirrors it in
  // state so the scrub bar reflects it immediately.
  seek(positionSec: number): void {
    const clamped = Math.max(
      0,
      this.state.durationSec > 0
        ? Math.min(positionSec, this.state.durationSec)
        : positionSec,
    );
    this.activeAdapter?.seek(clamped);
    this.set({ positionSec: clamped });
  }

  // Set output volume (0..1) on the active adapter. Used by the blend engine (U11).
  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.activeAdapter?.setVolume(clamped);
  }

  // Set playback rate; the adapter clamps to its own supported range.
  setRate(rate: number): void {
    this.activeAdapter?.setRate(rate);
  }

  // Position/duration are pushed in by the active adapter's polling loop; the store
  // does not compute them. These are the only writers of those fields besides seek().
  reportPosition(positionSec: number, durationSec?: number): void {
    this.set({
      positionSec: Math.max(0, positionSec),
      ...(durationSec != null ? { durationSec: Math.max(0, durationSec) } : {}),
    });
  }

  toggleShuffle(): void {
    this.set({ shuffle: !this.state.shuffle });
  }

  // Cycle off → all → one → off (prototype repeat button behaviour).
  cycleRepeat(): void {
    const order: RepeatMode[] = ["off", "all", "one"];
    const nextIndex = (order.indexOf(this.state.repeat) + 1) % order.length;
    this.set({ repeat: order[nextIndex] });
  }
}

// The app's shared player store instance. UI surfaces import this one so they all
// read the same single truth.
export const playerStore = new PlayerStore();
