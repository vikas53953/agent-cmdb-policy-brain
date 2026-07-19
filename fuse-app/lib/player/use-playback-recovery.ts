"use client";

// The single, app-wide playback recovery monitor (R2/R18/AE1).
//
// THE CLASS FIX. The old app (and the first two rebuilds) could hang in "Playback
// stalled — retrying" forever, and its recovery lived inside the Now Playing screen — so
// a track played straight from search, with Now Playing closed, had NO recovery at all.
// This monitor is mounted ONCE in the app shell, so the bounded recovery ladder runs
// everywhere a track can play, independent of which surface is open.
//
// WHAT CHANGED (the R1/R3/R4 fix). It now feeds the pure ladder machine the USER'S INTENT
// and the ENGINE'S state, not just whether a polled clock advanced — so a paused,
// minimised, idle, or never-started track is never treated as a stall. And it NO LONGER
// auto-advances the queue: a false stall can no longer switch to a different track or race
// the user's Next. The ladder is retry → recreate → honest terminal (error + Skip); the
// user's Next and a REAL end-of-track engine event are the only things that change tracks.
//
// It reads the store IMPERATIVELY inside its interval and subscribes (via a narrow
// selector) only to the current track's key — so the 500ms position poll never re-renders
// the AppChrome shell (the R5 slowness fix).

import { useEffect, useRef } from "react";
import { usePlayerSelector } from "@/lib/player/use-player-selector";
import { playerStore } from "@/lib/player/store";
import { logActivity } from "@/lib/activity-log";
import {
  initHealth,
  stepHealth,
  type HealthState,
} from "@/lib/player/playback-health";
import type { RecoveryPhase as StoreRecoveryPhase } from "@/lib/player/types";

// How often we sample the player clock to judge whether position is advancing.
const TICK_MS = 1000;

const STALL_RETRY_MSG = "Playback stalled — retrying";
const STALL_RECREATE_MSG = "Playback stalled — rebuilding the player";

// Map the machine's phase to the store's surfaced recovery phase.
function toStorePhase(phase: HealthState["phase"]): StoreRecoveryPhase {
  if (phase === "stalled") return "stalled";
  if (phase === "error") return "error";
  return "ok"; // idle | playing
}

export function usePlaybackRecovery(): void {
  // Subscribe ONLY to the current track's key via a narrow selector, so a position tick
  // (which changes positionSec, not the key) never re-renders the shell this hook lives
  // in. The key changes exactly when a new track loads — when the per-track ladder resets.
  const currentKey = usePlayerSelector((s) =>
    s.current ? `${s.current.source}:${s.current.nativeId}` : null,
  );
  const healthRef = useRef<HealthState>(initHealth(0));
  // Guards against a slow retry/recreate overlapping the next tick.
  const busyRef = useRef(false);
  // The track key we have already surfaced the honest terminal for, so failStalled fires
  // exactly once per wedged episode (not every tick — which would re-render twice a sec).
  const terminalKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // Re-baseline the per-track ladder clock so a new track never inherits the prior
    // track's stall timer.
    healthRef.current = initHealth(Date.now());
    terminalKeyRef.current = null;
    if (!currentKey) return;

    const id = window.setInterval(() => {
      const s = playerStore.getState();

      // An action is still in flight — let it finish before sampling again.
      if (busyRef.current) return;

      const outcome = stepHealth(healthRef.current, {
        intent: s.intent,
        engineState: playerStore.currentEngineState(),
        positionSec: s.positionSec,
        nowMs: Date.now(),
        errorKind: playerStore.currentErrorKind(),
      });
      healthRef.current = outcome.state;

      // Publish the honest health so every surface (mini data-player-state, Now Playing
      // banner, robot tester) reads one truth. skipOffered is queue-aware so the store and
      // the health machine agree (a Skip only when there is something to skip to).
      const skip = outcome.state.skipOffered && s.queue.length > 0;
      playerStore.setRecovery(toStorePhase(outcome.state.phase), skip);

      // The terminal outcome surfaces the honest error + Skip once; there is NO auto-
      // advance. Only retry / recreate are ever performed here.
      if (outcome.action === "none") {
        if (outcome.state.skipOffered && terminalKeyRef.current !== currentKey) {
          terminalKeyRef.current = currentKey;
          playerStore.failStalled();
        }
        return;
      }

      busyRef.current = true;
      void (async () => {
        try {
          if (outcome.action === "retry") {
            logActivity({ level: "info", type: "stall-retry", message: STALL_RETRY_MSG });
            await playerStore.retry();
          } else if (outcome.action === "recreate") {
            logActivity({ level: "info", type: "stall-recreate", message: STALL_RECREATE_MSG });
            await playerStore.recreate();
          }
        } finally {
          busyRef.current = false;
        }
      })();
    }, TICK_MS);

    return () => window.clearInterval(id);
    // currentKey changes exactly when a new track loads — the per-track ladder resets.
    // intent / positionSec / engineState / errorKind are read live from the store inside
    // the tick, so they intentionally are not dependencies.
  }, [currentKey]);
}
