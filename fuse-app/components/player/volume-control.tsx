"use client";

// Volume slider + mute toggle (owner fix 3).
//
// The big three all pair a speaker button (click to mute/unmute) with a level slider — the
// mini-player reveals the slider on hover/focus (YouTube Music's pattern), Now Playing shows
// it inline. Both render from the ONE volume truth in the player store and drive it: the
// store applies the effective level to the YouTube adapter (setVolume) and re-asserts it
// across track changes and blends, and the shell persists it per user. Honesty (R17): the
// speaker icon reflects real state — muted, quiet, or loud — and the slider always shows the
// level actually in effect.

import { usePlayerSelector } from "@/lib/player/use-player-selector";
import { playerStore } from "@/lib/player/store";
import { VolumeIcon, VolumeMuteIcon } from "@/components/ui/icons";

export default function VolumeControl({ variant = "mini" }: { variant?: "mini" | "full" }) {
  const { volume, muted } = usePlayerSelector((s) => ({ volume: s.volume, muted: s.muted }));
  const effective = muted ? 0 : volume;
  const pct = Math.round(effective * 100);

  return (
    <div className={`volume volume-${variant}`} data-testid="volume-control" data-muted={muted ? "true" : "false"}>
      <button
        type="button"
        className="icon-btn volume-mute"
        data-testid="volume-mute"
        onClick={() => playerStore.toggleMute()}
        aria-pressed={muted}
        title={muted ? "Unmute" : "Mute"}
        aria-label={muted ? "Unmute" : "Mute"}
      >
        {muted ? <VolumeMuteIcon size={18} /> : <VolumeIcon size={18} level={volume} />}
      </button>
      <input
        type="range"
        className="volume-range"
        data-testid="volume-range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => playerStore.setVolume(Number(e.target.value) / 100)}
        aria-label="Volume"
        aria-valuetext={`${pct}%`}
      />
    </div>
  );
}
