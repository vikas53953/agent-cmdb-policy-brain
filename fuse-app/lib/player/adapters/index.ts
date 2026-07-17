// Source-adapter registry (U5, KTD-6).
//
// The store never imports a concrete adapter. Instead each adapter registers itself
// here, and the store asks the registry for "the adapter for this track's source".
// That keeps the store's public API source-agnostic and lets the concrete adapters
// land in later units (YouTube U7, local U14, Spotify U15) without touching the
// store. In U5 nothing is registered yet — so the store honestly does nothing on
// play() until an adapter exists (R17 at the state layer), and unit tests register
// a fake adapter to exercise delegation.

import type { TrackSource } from "@/lib/repos/track";
import type { SourceAdapter } from "@/lib/player/types";

// Re-export the contract so consumers import adapters + types from one place.
export type { SourceAdapter } from "@/lib/player/types";

export type AdapterRegistry = {
  // The adapter for a source, or undefined when that source is not wired yet.
  get(source: TrackSource): SourceAdapter | undefined;
  // Register (or replace) the adapter for its declared source.
  register(adapter: SourceAdapter): void;
  // Which sources currently have a working adapter — used by UI to disable, with a
  // reason, any source whose playback engine has not landed (honesty, R17).
  registeredSources(): TrackSource[];
};

// Create an isolated registry. The app uses one shared instance (below); tests make
// their own so registrations never leak between cases.
export function createAdapterRegistry(): AdapterRegistry {
  const adapters = new Map<TrackSource, SourceAdapter>();
  return {
    get(source) {
      return adapters.get(source);
    },
    register(adapter) {
      adapters.set(adapter.source, adapter);
    },
    registeredSources() {
      return [...adapters.keys()];
    },
  };
}

// The single registry the running app shares. Empty until later units register their
// adapters into it; importing it never pulls in browser-only adapter code.
export const adapterRegistry: AdapterRegistry = createAdapterRegistry();
