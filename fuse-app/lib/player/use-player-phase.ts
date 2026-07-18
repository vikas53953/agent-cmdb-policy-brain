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

// The full surfaced vocabulary (store's four phases + the derived "stalled").
export type PlayerPhase = "idle" | "loading" | "playing" | "stalled" | "error";

export function usePlayerPhase(): { phase: PlayerPhase; positionSec: number } {
  const { status, isPlaying, positionSec, recovery } = usePlayerState();

  // The recovery ladder is authoritative about health: an honest "error" or an in-flight
  // "stalled" overrides a raw "playing"/"loading" so the surface never claims healthy
  // playback while the position is frozen (the exact silent-stall lie this app kills).
  let phase: PlayerPhase;
  if (recovery.phase === "error" || status === "error") {
    phase = "error";
  } else if (recovery.phase === "stalled") {
    phase = "stalled";
  } else {
    phase = status; // idle | loading | playing
  }

  // Keep it consistent with isPlaying: if the store says nothing is playing, the surface
  // can never read "playing"/"stalled" (those imply active playback).
  const safePhase: PlayerPhase =
    !isPlaying && (phase === "playing" || phase === "stalled") ? "idle" : phase;

  return { phase: safePhase, positionSec };
}
