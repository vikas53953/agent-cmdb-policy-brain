"use client";

// React binding for the unified player store (U7).
//
// The store (lib/player/store.ts) is a framework-free observable so it can be unit
// tested in node and driven from anywhere. This is the thin React seam that lets a
// client component render from the single playback truth without owning any of it.
//
// `getServerSnapshot` returns the same initial snapshot the client starts from
// (nothing playing yet), so the server-rendered mini-player and the first client
// render agree — no hydration mismatch. Real playback only ever starts from a user
// tap in the browser, well after hydration.

import { useSyncExternalStore } from "react";
import { playerStore } from "@/lib/player/store";
import type { PlayerState } from "@/lib/player/types";

export function usePlayerState(): PlayerState {
  return useSyncExternalStore(
    (onChange) => playerStore.subscribe(onChange),
    () => playerStore.getState(),
    () => playerStore.getState(),
  );
}
