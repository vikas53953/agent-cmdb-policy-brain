"use client";

// React binding for the ONE playback reading (lib/player/playback-truth.ts).
//
// Every surface that needs to know "is sound genuinely coming out right now?" — the
// transport buttons, the Transition Moment, the stall banner — calls this and nothing
// else, so they cannot drift apart. It subscribes through the selector binding, so it
// re-renders only when the reading actually changes (the ~2/s position poll does not
// change it, so it does not repaint the transport).

import { usePlayerSelector } from "@/lib/player/use-player-selector";
import { describePlayback, type PlaybackTruth } from "@/lib/player/playback-truth";

export function usePlaybackTruth(): PlaybackTruth {
  return usePlayerSelector(describePlayback);
}
