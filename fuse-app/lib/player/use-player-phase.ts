"use client";

// Machine-readable player phase for the instrument panel (the robot tester's surface).
//
// The store owns idle/loading/playing/error (lib/player/store.ts). "stalled" is not a
// store field — it is the honest observation that playback claims to be playing but the
// position has stopped advancing (the exact failure the old app hid). This hook layers
// that observation on top of the store's status using the SAME pure decision core the
// Now Playing banner uses (playback-health.ts), so the data-player-state attribute and
// the visible "Playback stalled — retrying" banner never disagree.
//
// It is read-only: it samples, it never drives playback. The mini-player publishes its
// result as data-player-state / data-player-position so an automated test can assert
// real, advancing playback instead of guessing from pixels.

import { useEffect, useRef, useState } from "react";
import { usePlayerState } from "@/lib/player/use-player";
import { playerStore } from "@/lib/player/store";
import {
  initHealth,
  stepHealth,
  type HealthState,
} from "@/lib/player/playback-health";

// The full surfaced vocabulary (store's four phases + the derived "stalled").
export type PlayerPhase = "idle" | "loading" | "playing" | "stalled" | "error";

// How often we sample the player clock to judge whether position is advancing.
const TICK_MS = 1000;

export function usePlayerPhase(): { phase: PlayerPhase; positionSec: number } {
  const { status, isPlaying, positionSec, current } = usePlayerState();
  const [stalled, setStalled] = useState(false);
  const healthRef = useRef<HealthState>(initHealth(0));

  // Reset the stall baseline whenever a new track loads, so a fresh track never starts
  // life looking stalled from the previous one's clock.
  const currentKey = current ? `${current.source}:${current.nativeId}` : null;
  useEffect(() => {
    // Re-baseline the stall clock for the newly-loaded track (a ref write, not state).
    // The stall flag is cleared by the first interval tick below (a fresh, advancing
    // track reads healthy within a second), so no synchronous setState is needed here.
    healthRef.current = initHealth(Date.now());
    if (!currentKey) return;
    const id = window.setInterval(() => {
      const s = playerStore.getState();
      const outcome = stepHealth(healthRef.current, {
        isPlaying: s.isPlaying,
        positionSec: s.positionSec,
        nowMs: Date.now(),
      });
      healthRef.current = outcome.state;
      const nextStalled = outcome.state.phase === "stalled";
      setStalled((prev) => (prev === nextStalled ? prev : nextStalled));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [currentKey]);

  // Derive the surfaced phase: only "playing" can degrade to "stalled"; every other
  // store phase passes through unchanged.
  const phase: PlayerPhase =
    status === "playing" ? (stalled ? "stalled" : "playing") : status;
  // isPlaying is the store's fine-grained truth; keep it consistent with the surface —
  // if the store says not playing, the phase can never be "playing"/"stalled".
  const safePhase: PlayerPhase =
    !isPlaying && (phase === "playing" || phase === "stalled") ? "idle" : phase;

  return { phase: safePhase, positionSec };
}
