"use client";

// Player session persistence (FIX 2). A headless client component mounted once in the app
// shell. Two jobs, both honest:
//
//   1. RESTORE (on mount): if a snapshot from a previous load is in sessionStorage and the
//      store has nothing loaded yet, rehydrate the SAME track PAUSED at the saved position.
//      It never auto-plays — rehydrate leaves isPlaying false and intent idle, so the user
//      sees a play button and sound only starts on their tap (the no-uninvited-music law).
//
//   2. PERSIST (on every store change): write the small snapshot (current + queue + position
//      + duration) back to sessionStorage, or clear it when nothing is playing. So the next
//      reload — accidental or a crash — can restore where the user was.
//
// It renders nothing. Placed high in the shell so its restore runs before the mini-player
// first needs the state.

import { useEffect } from "react";
import { playerStore } from "@/lib/player/store";
import {
  loadPlayerSession,
  savePlayerSession,
  type PlayerSession,
} from "@/lib/session-state";

export default function PlayerPersistence() {
  useEffect(() => {
    // RESTORE first, before wiring the saver, so the very first save reflects the restored
    // state rather than an empty one. Guard on an empty store so a live in-memory session
    // (e.g. a client-side navigation that kept the store) is never clobbered.
    const saved = loadPlayerSession();
    if (saved && !playerStore.getState().current) {
      playerStore.rehydrate({
        current: saved.current,
        queue: saved.queue,
        positionSec: saved.positionSec,
        durationSec: saved.durationSec,
      });
    }

    // PERSIST on every change. Cheap (synchronous sessionStorage) and best-effort inside
    // the helper, so a 500ms position tick writing here is fine and never throws.
    const unsubscribe = playerStore.subscribe((state) => {
      const snapshot: PlayerSession | null = state.current
        ? {
            current: state.current,
            queue: [...state.queue],
            positionSec: state.positionSec,
            durationSec: state.durationSec,
          }
        : null;
      savePlayerSession(snapshot);
    });

    return unsubscribe;
  }, []);

  return null;
}
