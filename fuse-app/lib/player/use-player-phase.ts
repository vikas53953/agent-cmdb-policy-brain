"use client";

// Machine-readable player phase for the instrument panel (the robot tester's surface).
//
// The store owns idle/loading/playing/error (lib/player/store.ts) AND, since the class
// fix, the honest recovery phase (ok/stalled/error) written by the ONE app-wide recovery
// monitor (use-playback-recovery.ts). This hook simply projects those two fields into the
// single surfaced vocabulary the mini-player publishes as data-player-state — it does NOT
// run its own stall detection or drive any recovery (that would be a second, disagreeing
// driver). Read-only: it samples the truth, it never touches playback.

import { usePlayerState } from "@/lib/player/use-player";
import { describePlayback } from "@/lib/player/playback-truth";

// The full surfaced vocabulary (store's four phases + the derived "stalled").
export type PlayerPhase = "idle" | "loading" | "playing" | "stalled" | "error";

export function usePlayerPhase(): { phase: PlayerPhase; positionSec: number } {
  const state = usePlayerState();
  // The machine-readable attribute is a NAMING of the one playback reading — not a second
  // opinion assembled from status/isPlaying/recovery. That is what keeps the robot
  // tester's data-player-state and the on-screen surfaces permanently in agreement.
  const truth = describePlayback(state);

  const phase: PlayerPhase =
    truth.motion === "sounding"
      ? "playing"
      : truth.motion === "starting"
        ? "loading"
        : truth.motion === "stuck"
          ? truth.giveUp
            ? "error"
            : "stalled"
          : "idle"; // silent | paused

  return { phase, positionSec: state.positionSec };
}
