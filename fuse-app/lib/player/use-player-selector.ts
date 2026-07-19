"use client";

// Selector-based React binding for the unified player store (the R5 slowness fix).
//
// THE BUG THIS KILLS: usePlayerState() (use-player.ts) subscribes to the WHOLE store, so
// every set() — including the 500ms position poll — re-rendered every subscriber: the
// whole Now Playing subtree, the mini, PlayRecorder, and (because the recovery hook read
// `current` through it) the entire AppChrome shell. Twice a second the app repainted
// itself. This hook lets a component subscribe to only the SLICE it needs, so a position
// tick re-renders the scrub bar alone, not whole screens.
//
// It is the standard useSyncExternalStore-with-selector pattern: the selected snapshot is
// cached in a ref and returned by reference while it is (shallow) equal, so a selector
// that builds a fresh object each call cannot cause an infinite render loop.

import { useCallback, useRef, useSyncExternalStore } from "react";
import { playerStore } from "@/lib/player/store";
import type { PlayerState } from "@/lib/player/types";

// Default equality: Object.is for primitives, a one-level shallow compare for plain
// objects (so `{current, isPlaying, ...}` slices are compared field-by-field).
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
    return false;
  }
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}

export function usePlayerSelector<T>(
  selector: (state: PlayerState) => T,
  isEqual: (a: T, b: T) => boolean = shallowEqual,
): T {
  // Cache the last selected value so getSnapshot returns a STABLE reference whenever the
  // selected slice is equal — the invariant useSyncExternalStore relies on to stop.
  const cache = useRef<{ value: T } | null>(null);

  const getSnapshot = useCallback((): T => {
    const next = selector(playerStore.getState());
    const prev = cache.current;
    if (prev && isEqual(prev.value, next)) return prev.value;
    cache.current = { value: next };
    return next;
  }, [selector, isEqual]);

  return useSyncExternalStore(
    (onChange) => playerStore.subscribe(onChange),
    getSnapshot,
    getSnapshot,
  );
}
