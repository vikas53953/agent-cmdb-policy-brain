"use client";

// App singleton for the sleep timer (Wave 1) + its React binding.
//
// sleep-timer.ts holds the pure, framework-free timer (unit-tested with a fake clock).
// This module wires that timer to the app's real singletons — the unified store (pause +
// the "stop after track" flag) — and exposes a hook the countdown chip and the timer
// controls render from. Kept separate so the pure timer stays node-testable without the store.

import { useSyncExternalStore } from "react";
import { playerStore } from "@/lib/player/store";
import { SleepTimer, type SleepTimerState } from "@/lib/player/sleep-timer";

export const sleepTimer = new SleepTimer({
  // Firing a minutes timer pauses playback — a real stop, never a fake one.
  onFire: () => playerStore.pause(),
  // End-of-track mode arms the flag the store consumes when the track genuinely ends.
  setStopAfterTrack: (stop) => playerStore.setStopAfterTrack(stop),
});

// When the store consumes the "stop after track" flag at a genuine end-of-track (flag goes
// true → false without a user cancel), tell the timer so an end-of-track chip clears itself.
// Idempotent: notifyTrackEnded is a no-op once the timer is already off (e.g. after cancel).
let lastStop = playerStore.getState().sleepStopAfterTrack;
playerStore.subscribe((state) => {
  if (lastStop && !state.sleepStopAfterTrack) {
    sleepTimer.notifyTrackEnded();
  }
  lastStop = state.sleepStopAfterTrack;
});

const IDLE: SleepTimerState = { mode: "off", remainingSec: 0, minutes: null };

// Subscribe a component to the sleep-timer snapshot. Server snapshot is the idle state so
// SSR and the first client render agree (the timer can only be armed by a browser tap).
export function useSleepTimer(): SleepTimerState {
  return useSyncExternalStore(
    (onChange) => sleepTimer.subscribe(onChange),
    () => sleepTimer.getState(),
    () => IDLE,
  );
}

// Format the remaining seconds as m:ss for the countdown chip.
export function formatSleepRemaining(remainingSec: number): string {
  const total = Math.max(0, Math.floor(remainingSec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
