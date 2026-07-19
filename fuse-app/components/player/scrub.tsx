"use client";

// Scrub bar (U8). A real, keyboard-operable seek control plus the current / total
// time readout, driven by the single player store. Seeking is HONEST (R17): it is
// live only when the track length is known (the player has reported a duration);
// until then the slider is disabled with a plain reason instead of pretending to
// let you scrub an unknown timeline.

import { playerStore } from "@/lib/player/store";
import { usePlayerSelector } from "@/lib/player/use-player-selector";
import { formatTime } from "@/lib/player/format-time";

// Scrub owns its OWN subscription to position/duration, so the 500ms position poll
// re-renders ONLY this bar — not the whole Now Playing screen (R5). Everything else in
// Now Playing subscribes to a slice that excludes positionSec and so stays still.
export default function Scrub() {
  const { positionSec, durationSec } = usePlayerSelector((s) => ({
    positionSec: s.positionSec,
    durationSec: s.durationSec,
  }));
  const known = durationSec > 0;
  const position = known ? Math.min(Math.max(0, positionSec), durationSec) : 0;
  const pct = known ? (position / durationSec) * 100 : 0;

  return (
    <div className="scrub">
      <input
        type="range"
        className="scrub-range"
        min={0}
        max={known ? Math.floor(durationSec) : 0}
        step={1}
        value={Math.floor(position)}
        onChange={(e) => playerStore.seek(Number(e.currentTarget.value))}
        disabled={!known}
        aria-label="Seek"
        aria-valuetext={
          known
            ? `${formatTime(position)} of ${formatTime(durationSec)}`
            : "Track length not loaded yet"
        }
        title={known ? "Drag to seek" : "Seeking turns on once the track length loads"}
        style={{ ["--scrub-pct" as string]: `${pct}%` }}
      />
      <div className="scrub-times">
        <span className="scrub-cur">{formatTime(position)}</span>
        <span className="scrub-dur">{known ? formatTime(durationSec) : "--:--"}</span>
      </div>
    </div>
  );
}
