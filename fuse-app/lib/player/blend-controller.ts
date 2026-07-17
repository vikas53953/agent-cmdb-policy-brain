"use client";

// App singleton for the auto-crossfade blend engine (U11) + its React binding.
//
// blend.ts holds the pure timing/gain math and the framework-free BlendController.
// This module wires that controller to the app's real singletons — the unified store
// (U5) and the YouTube adapter's two-player blend surface (U7) — and exposes a hook
// the melt panel renders from. Kept separate from blend.ts so the pure engine stays
// node-testable without importing any browser adapter.
//
// CROSSFADE LENGTH lives here as a small in-memory value that the profile-sheet
// slider updates live (setCrossfadeSec) and the engine reads the instant a blend
// starts (getCrossfadeSec). The persisted setting (survives reload) is written by the
// server action; this in-memory copy is just the live value for the current session.

import { useSyncExternalStore } from "react";
import type { TrackSource } from "@/lib/repos/track";
import { playerStore } from "@/lib/player/store";
import { youtubeAdapter } from "@/lib/player/adapters/youtube";
import { CROSSFADE_DEFAULT_SEC } from "@/lib/repos/settings";
import {
  BlendController,
  clampCrossfadeSec,
  type BlendAdapterPorts,
  type MeltState,
} from "@/lib/player/blend";

// Live crossfade length (seconds) for this session. Seeded to the default; the shell
// overwrites it with the user's persisted value on mount and on every slider change.
let currentCrossfadeSec = CROSSFADE_DEFAULT_SEC;

export function setLiveCrossfadeSec(seconds: number): void {
  currentCrossfadeSec = clampCrossfadeSec(seconds);
}

export function getLiveCrossfadeSec(): number {
  return currentCrossfadeSec;
}

// Only sources whose adapter can genuinely overlap two players may auto-crossfade. In
// v1 that is YouTube (two iframes). Local (U14) and Spotify (U15) are not wired for
// overlap yet, so they resolve to null and the engine hard-cuts instead of faking a
// blend (R17 — the setting only affects transitions that truly happen).
function resolveBlendAdapter(source: TrackSource): BlendAdapterPorts | null {
  if (source === "youtube") return youtubeAdapter;
  return null;
}

export const blendController = new BlendController({
  store: playerStore,
  resolveBlendAdapter,
  getCrossfadeSec: getLiveCrossfadeSec,
});

// Subscribe the melt panel to blend state. useSyncExternalStore keeps the panel in
// lockstep with the engine; the server snapshot is the idle state (nothing blending),
// so SSR and first client render agree.
const IDLE: MeltState = { active: false, incoming: null, progress: 0 };

export function useMeltState(): MeltState {
  return useSyncExternalStore(
    (onChange) => blendController.subscribeMelt(onChange),
    () => blendController.getMeltState(),
    () => IDLE,
  );
}
