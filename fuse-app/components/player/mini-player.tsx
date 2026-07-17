"use client";

// Persistent mini-player (U7, R2/R4/R5, KTD-7).
//
// U4 shipped this as an honest empty scaffold. U7 makes it LIVE: it subscribes to the
// single player store and, when a YouTube track is playing, shows the visible video as
// its artwork (KTD-7 — never a hidden player) with real, working transport wired to
// the store. When nothing is playing it keeps the honest empty state; nothing here is
// enabled unless it actually does something (R17).

import type { TrackRef } from "@/lib/repos/track";
import { usePlayerState } from "@/lib/player/use-player";
import { playerStore } from "@/lib/player/store";
import { adapterRegistry } from "@/lib/player/adapters";
import VideoSurface from "@/components/player/video-surface";
import { MusicIcon, PlayIcon, PauseIcon, NextIcon } from "@/components/ui/icons";

const NOT_WIRED_REASON = "Playback starts once the player engine is connected";
const NO_NEXT_REASON = "Nothing queued up next";

// The art box: the live YouTube video for a YouTube track (visible-player rule), the
// track's real cover art for any other source, or a music glyph when art is missing.
function MiniArt({ track }: { track: TrackRef }) {
  if (track.source === "youtube") {
    return (
      <div className="mini-art mini-art-video">
        <VideoSurface variant="mini" />
      </div>
    );
  }
  if (track.artUrl) {
    return (
      <div className="mini-art mini-art-cover">
        {/* eslint-disable-next-line @next/next/no-img-element -- external source CDN, allowed by CSP img-src */}
        <img src={track.artUrl} alt="" referrerPolicy="no-referrer" />
      </div>
    );
  }
  return (
    <div className="mini-art" aria-hidden="true">
      <MusicIcon size={20} />
    </div>
  );
}

function EmptyMini() {
  return (
    <div className="mini" aria-label="Mini player">
      <div className="mini-art" aria-hidden="true">
        <MusicIcon size={20} />
      </div>
      <div className="mini-meta">
        <div className="mini-title">Nothing playing yet</div>
        <div className="mini-sub">Search and tap a song to start</div>
      </div>
      <div className="mini-controls">
        <button
          type="button"
          className="icon-btn primary"
          disabled
          aria-disabled="true"
          title={NOT_WIRED_REASON}
          aria-label={`Play — ${NOT_WIRED_REASON}`}
        >
          <PlayIcon />
        </button>
        <button
          type="button"
          className="icon-btn"
          disabled
          aria-disabled="true"
          title={NOT_WIRED_REASON}
          aria-label={`Next — ${NOT_WIRED_REASON}`}
        >
          <NextIcon />
        </button>
      </div>
    </div>
  );
}

export default function MiniPlayer() {
  const { current, isPlaying, queue } = usePlayerState();

  if (!current) return <EmptyMini />;

  // The transport is honest: play/pause acts only when a working adapter backs the
  // current track; next is enabled only when there is something queued to advance to.
  const hasEngine = adapterRegistry.get(current.source) !== undefined;
  const canAdvance = queue.length > 0;

  return (
    <div className="mini" aria-label="Mini player">
      <MiniArt track={current} />

      <div className="mini-meta">
        <div className="mini-title">{current.title}</div>
        <div className="mini-sub">{current.artist ?? "Unknown artist"}</div>
      </div>

      <div className="mini-controls">
        <button
          type="button"
          className="icon-btn primary"
          onClick={hasEngine ? () => void playerStore.toggle() : undefined}
          disabled={!hasEngine}
          aria-disabled={!hasEngine}
          title={hasEngine ? (isPlaying ? "Pause" : "Play") : NOT_WIRED_REASON}
          aria-label={
            hasEngine
              ? isPlaying
                ? `Pause ${current.title}`
                : `Play ${current.title}`
              : `Play — ${NOT_WIRED_REASON}`
          }
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={canAdvance ? () => void playerStore.next() : undefined}
          disabled={!canAdvance}
          aria-disabled={!canAdvance}
          title={canAdvance ? "Next track" : NO_NEXT_REASON}
          aria-label={canAdvance ? "Next track" : `Next — ${NO_NEXT_REASON}`}
        >
          <NextIcon />
        </button>
      </div>
    </div>
  );
}
