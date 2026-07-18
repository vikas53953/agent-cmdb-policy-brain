"use client";

// The single, app-wide playback recovery monitor (R2/R18/AE1).
//
// THE CLASS FIX. The old app (and the first rebuild) could hang in "Playback stalled —
// retrying" forever, and the only recovery lived inside the Now Playing screen — so a
// track played straight from search results, with Now Playing closed, had NO recovery at
// all: it just sat frozen. This monitor is mounted ONCE in the app shell, so the bounded
// recovery ladder runs everywhere a track can play, independent of which surface is open.
//
// It is the only thing that DRIVES recovery. It samples the single player truth each
// tick, feeds it to the pure ladder machine (playback-health.ts), performs the returned
// action against the store (retry → recreate → advance → honest terminal), publishes the
// honest phase into the store so every surface renders one truth, and logs each rung. It
// never loops forever: the ladder terminates, and once the store is at the honest
// skip-offered terminal this monitor stands down.

import { useEffect, useRef } from "react";
import { usePlayerState } from "@/lib/player/use-player";
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
const STALL_ADVANCE_MSG = "This track won't play — trying the next one";
const STALL_GIVEUP_MSG = "This track won't play right now — skip to keep listening";

// Map the machine's phase to the store's surfaced recovery phase.
function toStorePhase(phase: HealthState["phase"]): StoreRecoveryPhase {
  if (phase === "stalled") return "stalled";
  if (phase === "error") return "error";
  return "ok"; // idle | playing
}

export function usePlaybackRecovery(): void {
  const { current } = usePlayerState();
  const healthRef = useRef<HealthState>(initHealth(0));
  // Guards against a slow retry/recreate/advance overlapping the next tick.
  const busyRef = useRef(false);

  const currentKey = current ? `${current.source}:${current.nativeId}` : null;

  useEffect(() => {
    // Re-baseline the ladder for the newly-loaded track so it never inherits the prior
    // track's stall clock.
    healthRef.current = initHealth(Date.now());
    if (!currentKey) return;

    const id = window.setInterval(() => {
      if (busyRef.current) return;
      const s = playerStore.getState();
      // At the honest terminal already — stand down (no infinite loop). A manual Skip or
      // a new track resets everything through the store's play path.
      if (s.recovery.skipOffered) return;

      const outcome = stepHealth(healthRef.current, {
        isPlaying: s.isPlaying,
        positionSec: s.positionSec,
        nowMs: Date.now(),
        errorKind: playerStore.currentErrorKind(),
      });
      healthRef.current = outcome.state;

      // Publish the honest health so every surface (mini data-player-state, Now Playing
      // banner, robot tester) reads one truth and can never disagree.
      playerStore.setRecovery(toStorePhase(outcome.state.phase), outcome.state.skipOffered);

      if (outcome.action === "none") return;

      busyRef.current = true;
      void (async () => {
        try {
          if (outcome.action === "retry") {
            logActivity({ level: "info", type: "stall-retry", message: STALL_RETRY_MSG });
            await playerStore.retry();
          } else if (outcome.action === "recreate") {
            logActivity({ level: "info", type: "stall-recreate", message: STALL_RECREATE_MSG });
            await playerStore.recreate();
          } else if (outcome.action === "advance") {
            logActivity({ level: "info", type: "stall-advance", message: STALL_ADVANCE_MSG });
            const advanced = await playerStore.next();
            if (!advanced) {
              // Nothing to advance to — the honest terminal, with a working Skip.
              logActivity({ level: "error", type: "stall-giveup", message: STALL_GIVEUP_MSG });
              playerStore.failStalled();
            }
          }
        } finally {
          busyRef.current = false;
        }
      })();
    }, TICK_MS);

    return () => window.clearInterval(id);
    // currentKey changes exactly when a new track loads — the monitor resets per track.
    // positionSec / isPlaying / errorKind are read live from the store inside the tick,
    // so they intentionally are not dependencies.
  }, [currentKey]);
}
