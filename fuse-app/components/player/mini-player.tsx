"use client";

// Persistent mini-player (U7, R2/R4/R5, KTD-7).
//
// U4 shipped this as an honest empty scaffold. U7 makes it LIVE: it subscribes to the
// single player store and, when a YouTube track is playing, shows the visible video as
// its artwork (KTD-7 — never a hidden player) with real, working transport wired to
// the store. When nothing is playing it keeps the honest empty state; nothing here is
// enabled unless it actually does something (R17).
//
// U8 wires the expand affordance (R4 — the mini-player opens the full Now Playing
// screen when tapped) and hands the single visible YouTube <iframe> up to Now Playing
// while it is open: `npOpen` tells the mini to stop hosting the video so the same
// player node re-parents into the big Now Playing art surface (never two hosts, never
// a hidden player).

import type { TrackRef } from "@/lib/repos/track";
import { usePlayerState } from "@/lib/player/use-player";
import { usePlayerPhase } from "@/lib/player/use-player-phase";
import { playerStore } from "@/lib/player/store";
import { adapterRegistry } from "@/lib/player/adapters";
import VideoSurface from "@/components/player/video-surface";
import { MusicIcon, PlayIcon, PauseIcon, NextIcon } from "@/components/ui/icons";

const NOT_WIRED_REASON = "Playback starts once the player engine is connected";
const NO_NEXT_REASON = "Nothing queued up next";

// The art box: the live YouTube video for a YouTube track (visible-player rule), the
// track's real cover art for any other source, or a music glyph when art is missing.
// While Now Playing is open (`npOpen`) the mini stops hosting the YouTube video so the
// single iframe re-parents up into the Now Playing art surface — never two hosts.
function MiniArt({ track, npOpen }: { track: TrackRef; npOpen: boolean }) {
  if (track.source === "youtube") {
    if (npOpen) {
      // The video lives in Now Playing right now; keep a placeholder in the (hidden-
      // behind-the-overlay) mini so we do not mount a second video host.
      return <div className="mini-art mini-art-video" aria-hidden="true" />;
    }
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
    <div
      className="mini"
      aria-label="Mini player"
      data-testid="mini-player"
      data-player-state="idle"
      data-player-position="0"
    >
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

export default function MiniPlayer({
  npOpen = false,
  onExpand,
}: {
  npOpen?: boolean;
  onExpand?: () => void;
}) {
  const { current, isPlaying, queue, notice } = usePlayerState();
  // The machine-readable playback surface for the robot tester (data-player-state /
  // data-player-position on the mini root). Derived from the store's status plus a live
  // "is position advancing?" check (stall detection), reusing the same pure health core
  // the Now Playing banner uses — so the attribute and the banner never disagree.
  const { phase, positionSec } = usePlayerPhase();

  if (!current) return <EmptyMini />;

  // The transport is honest: play/pause acts only when a working adapter backs the
  // current track; next is enabled only when there is something queued to advance to.
  const hasEngine = adapterRegistry.get(current.source) !== undefined;
  const canAdvance = queue.length > 0;

  return (
    <>
      {/* Honest label about the current playback situation (U15/AE5): shown when a
          Spotify track is heard as its matched YouTube version. Plain words, always
          truthful about what the listener is actually hearing (R17). */}
      {notice ? (
        <p className="player-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
      <div
        className="mini"
        aria-label="Mini player"
        data-testid="mini-player"
        data-player-state={phase}
        data-player-position={positionSec.toFixed(2)}
      >
        <MiniArt track={current} npOpen={npOpen} />

      {/* Tapping the track opens the full Now Playing screen (R4). */}
      <button
        type="button"
        className="mini-meta mini-open"
        data-testid="mini-open"
        onClick={onExpand}
        disabled={!onExpand}
        aria-label={`Open now playing — ${current.title}`}
      >
        <span className="mini-title">{current.title}</span>
        <span className="mini-sub">{current.artist ?? "Unknown artist"}</span>
      </button>

      <div className="mini-controls">
        <button
          type="button"
          className="icon-btn primary"
          data-testid="mini-play"
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
          data-testid="mini-next"
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
    </>
  );
}
