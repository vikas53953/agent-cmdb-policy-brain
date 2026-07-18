// Local-files playback adapter for the unified player store (U14, R12/R14, KTD-6).
//
// This is the SourceAdapter that lets the ONE unified store (U5) play a user's own
// audio file, reusing the same Web Audio engine that powers the DJ local decks
// (lib/dj/engine.ts) but exposing only the generic transport the store contract needs
// (load/play/pause/seek/volume/rate) — EQ/loops/FX/scratch stay a DJ-console concern.
//
// R14 — ON DEVICE, ALWAYS. A local track's bytes are only ever the File the user
// picked this session; they are decoded in memory and never uploaded. The adapter
// keeps a session-scoped map from a track's nativeId to its File, populated by the UI
// that ran the file picker (`provideLocalFile`). Nothing is persisted: after a reload
// the map is empty, which is exactly why the adapter is NOT auto-registered into the
// global registry — a persisted "local" library row whose File is gone must not render
// an enabled play button that then can't play (R17). A future uploads picker that owns
// live Files registers the adapter for its own session via `registerLocalAdapter`.
//
// SSR/Node-safe: the engine degrades to inert no-ops with no AudioContext, so importing
// and constructing this adapter touches nothing browser-only until a real File loads.

import type { TrackRef } from "@/lib/repos/track";
import type { SourceAdapter, SourceCapabilities } from "@/lib/player/types";
import { SOURCE_CAPABILITIES } from "@/lib/player/capabilities";
import { createDjDeckEngine, type DjDeckEngine } from "@/lib/dj/engine";
import { adapterRegistry, type AdapterRegistry } from "@/lib/player/adapters";
import { logPlaybackError } from "@/lib/activity-log";

// The local column of the capability matrix (single source: capabilities.ts).
export const LOCAL_CAPABILITIES: SourceCapabilities = SOURCE_CAPABILITIES.local;

// Session-scoped map: a local track's nativeId → the File the user picked. Lives only
// in memory; the bytes never leave the device. Cleared implicitly on reload.
const sessionFiles = new Map<string, File>();

// Hand the adapter a File for a local track (called by the UI that ran the picker).
// Returns the same nativeId for convenience.
export function provideLocalFile(nativeId: string, file: File): string {
  sessionFiles.set(nativeId, file);
  return nativeId;
}

// Forget a session File (e.g. when its object URL is revoked).
export function forgetLocalFile(nativeId: string): void {
  sessionFiles.delete(nativeId);
}

export type LocalAdapterDeps = {
  // Injectable engine factory for tests; defaults to the real Web Audio engine.
  engine?: DjDeckEngine;
  files?: Map<string, File>;
};

export function createLocalAdapter(deps: LocalAdapterDeps = {}): SourceAdapter {
  const engine = deps.engine ?? createDjDeckEngine();
  const files = deps.files ?? sessionFiles;

  return {
    source: "local",
    capabilities: LOCAL_CAPABILITIES,

    async load(track: TrackRef): Promise<void> {
      const file = files.get(track.nativeId);
      if (!file) {
        // Honest failure: we cannot play a local track whose bytes are not on hand this
        // session. Logged for diagnosis (R18); no fake success.
        logPlaybackError("This file isn't loaded on this device anymore", {
          source: "local",
        });
        return;
      }
      // A user gesture drove this load; resume the context so audio can start.
      await engine.resume();
      await engine.loadFile(file);
    },

    async play(): Promise<void> {
      await engine.resume();
      engine.play();
    },

    pause(): void {
      engine.pause();
    },

    seek(positionSec: number): void {
      engine.seek(positionSec);
    },

    setVolume(volume: number): void {
      engine.setCrossfade(volume);
    },

    setRate(rate: number): void {
      engine.setRate(rate);
    },

    unload(): void {
      engine.dispose();
    },
  };
}

// Register a local adapter into a registry for a session that owns live Files. Not run
// at module load by design (see the header) — a caller with a real file-load path opts
// in. Returns the registered adapter.
export function registerLocalAdapter(
  registry: AdapterRegistry = adapterRegistry,
  deps: LocalAdapterDeps = {},
): SourceAdapter {
  const adapter = createLocalAdapter(deps);
  registry.register(adapter);
  return adapter;
}
