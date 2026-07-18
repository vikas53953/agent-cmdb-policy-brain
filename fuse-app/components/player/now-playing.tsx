"use client";

// Now Playing screen (U8, R2/R4/R18, AE1).
//
// The full player surface: the art surface (the VISIBLE YouTube video itself for a
// YouTube track — KTD-7 — otherwise the track's real cover), title / artist, source
// badge, scrub bar, and transport (prev / play-pause / next, shuffle, repeat). It
// opens from the mini-player and slides up over the phone frame.
//
// HONEST FAILURE HANDLING is the heart of this unit (AE1). A playback-health state
// machine watches whether position is actually advancing; on a stall it shows
// "Playback stalled — retrying", fires a retry, and after repeated failure offers
// Skip. Nothing ever freezes silently. Every control is real (R17): play/pause is
// live only when a working adapter backs the source, Next only when something is
// queued, Skip only when there is a track to skip to.

import { useEffect, useRef, useState } from "react";
import { usePlayerState } from "@/lib/player/use-player";
import { playerStore } from "@/lib/player/store";
import { adapterRegistry } from "@/lib/player/adapters";
import { SOURCE_BADGES } from "@/lib/ui/shell";
import { logActivity } from "@/lib/activity-log";
import {
  initHealth,
  stepHealth,
  type HealthState,
} from "@/lib/player/playback-health";
import VideoSurface from "@/components/player/video-surface";
import Scrub from "@/components/player/scrub";
import Lyrics from "@/components/player/lyrics";
import MeltPanel from "@/components/player/melt-panel";
import LikeButton from "@/components/player/like-button";
import {
  PlayIcon,
  PauseIcon,
  NextIcon,
  PrevIcon,
  ShuffleIcon,
  RepeatIcon,
  ChevronDownIcon,
  MusicIcon,
} from "@/components/ui/icons";

// How often Now Playing samples the player to judge playback health.
const HEALTH_TICK_MS = 1000;

const STALL_MSG = "Playback stalled — retrying";
const STILL_STUCK_MSG = "Still stuck — this track won't play right now";
const NO_ENGINE_REASON = "Playback starts once the player engine is connected";
const NO_NEXT_REASON = "Nothing queued up next";
const NO_SKIP_REASON = "Nothing queued to skip to";

export default function NowPlaying({
  open,
  onClose,
  lyricsEnabled,
}: {
  open: boolean;
  onClose: () => void;
  // Lyrics on/off setting (U9, R16). Threaded from the shell so the toggle in the
  // profile sheet shows/hides this screen's lyrics panel instantly.
  lyricsEnabled: boolean;
}) {
  const { current, isPlaying, queue, positionSec, durationSec, shuffle, repeat, notice } =
    usePlayerState();

  const [health, setHealth] = useState<HealthState>(() => initHealth(0));
  const healthRef = useRef<HealthState>(initHealth(0));

  // Close on Escape while open (accessibility parity with the profile sheet).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Playback-health monitor. Runs whenever a track is loaded (independent of the
  // overlay being open, so stalls are caught and logged app-wide). Each tick feeds
  // the current player snapshot to the pure state machine; a returned retry flag
  // re-issues playback, and phase/skipOffered drive the banner + Skip control.
  const currentKey = current ? `${current.source}:${current.nativeId}` : null;
  useEffect(() => {
    // Reset the health baseline for the newly-loaded track (a ref write, not state —
    // the visible banner clears on the first tick below, within a second).
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
      // Only re-render when something user-visible changed, to avoid a needless
      // render every second while playback is healthy.
      setHealth((prev) =>
        prev.phase === outcome.state.phase &&
        prev.skipOffered === outcome.state.skipOffered
          ? prev
          : outcome.state,
      );
      if (outcome.retry) {
        logActivity({ level: "info", type: "stall-retry", message: STALL_MSG });
        void playerStore.retry();
      }
    }, HEALTH_TICK_MS);
    return () => window.clearInterval(id);
    // currentKey changes exactly when a new track is loaded — the monitor resets per
    // track. positionSec/isPlaying are read live from the store inside the interval,
    // so they intentionally are not dependencies.
  }, [currentKey]);

  const showOpen = open && !!current;
  const hasEngine = current ? adapterRegistry.get(current.source) !== undefined : false;
  const canAdvance = queue.length > 0;
  const badge = current
    ? SOURCE_BADGES[current.source] ?? { className: "mp3", label: current.source }
    : null;

  const stalled = health.phase === "stalled";

  return (
    <>
      <div
        className={showOpen ? "np-overlay open" : "np-overlay"}
        onClick={onClose}
        aria-hidden="true"
      />
      <section
        className={showOpen ? "np open" : "np"}
        role="dialog"
        aria-modal="true"
        aria-label="Now playing"
        aria-hidden={!showOpen}
        data-testid="now-playing"
        data-np-open={showOpen ? "true" : "false"}
      >
        {current && badge ? (
          <>
            <header className="np-head">
              <button
                type="button"
                className="icon-btn"
                onClick={onClose}
                aria-label="Collapse now playing"
              >
                <ChevronDownIcon />
              </button>
              <span className="np-head-label">Now Playing</span>
              <span className={`badge ${badge.className}`}>{badge.label}</span>
            </header>

            <div className="np-art">
              {open && current.source === "youtube" ? (
                // The visible YouTube video IS the artwork surface (KTD-7).
                <VideoSurface variant="np" />
              ) : current.artUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- external source CDN (i.ytimg.com / i.scdn.co); allowed by CSP img-src
                <img src={current.artUrl} alt="" referrerPolicy="no-referrer" />
              ) : (
                <div className="np-art-fallback" aria-hidden="true">
                  <MusicIcon size={56} />
                </div>
              )}
            </div>

            <div className="np-info">
              <h2 className="np-title">{current.title}</h2>
              <p className="np-artist">{current.artist ?? "Unknown artist"}</p>
              {/* Honest label about the current situation (U15/AE5): shown when a
                  Spotify track is heard as its matched YouTube version. */}
              {notice ? (
                <p className="player-notice" role="status" aria-live="polite">
                  {notice}
                </p>
              ) : null}
            </div>

            {/* Like the current track (U10, R8). A real, persisted control — the
                heart reflects the true saved state and drives the Library. */}
            <div className="np-actions">
              <LikeButton track={current} />
            </div>

            {/* Auto-crossfade visual (U11, R3/F2): shown only while a blend is truly
                under way — the incoming track melting in with a progress bar. */}
            <MeltPanel />

            {/* Real synced lyrics (U9). Hidden entirely when the user turns lyrics
                off; honest "no lyrics" message when LRCLIB has none. */}
            <Lyrics enabled={lyricsEnabled} active={showOpen} />

            {stalled ? (
              <div className="np-stall" role="status" aria-live="polite">
                {health.skipOffered ? (
                  <>
                    <span className="np-stall-msg">{STILL_STUCK_MSG}</span>
                    <button
                      type="button"
                      className="np-stall-skip"
                      onClick={canAdvance ? () => void playerStore.next() : undefined}
                      disabled={!canAdvance}
                      aria-disabled={!canAdvance}
                      title={canAdvance ? "Skip to the next track" : NO_SKIP_REASON}
                      aria-label={
                        canAdvance ? "Skip to the next track" : `Skip — ${NO_SKIP_REASON}`
                      }
                    >
                      Skip
                    </button>
                  </>
                ) : (
                  <span className="np-stall-msg">{STALL_MSG}…</span>
                )}
              </div>
            ) : null}

            <Scrub positionSec={positionSec} durationSec={durationSec} />

            <div className="transport" data-testid="np-transport">
              <button
                type="button"
                className={shuffle ? "icon-btn toggle on" : "icon-btn toggle"}
                data-testid="np-shuffle"
                onClick={() => playerStore.toggleShuffle()}
                aria-pressed={shuffle}
                title={shuffle ? "Shuffle on" : "Shuffle off"}
                aria-label={shuffle ? "Turn shuffle off" : "Turn shuffle on"}
              >
                <ShuffleIcon />
              </button>

              <button
                type="button"
                className="icon-btn"
                onClick={hasEngine ? () => void playerStore.previous() : undefined}
                disabled={!hasEngine}
                aria-disabled={!hasEngine}
                title={hasEngine ? "Restart track" : NO_ENGINE_REASON}
                aria-label={hasEngine ? "Restart track" : `Previous — ${NO_ENGINE_REASON}`}
              >
                <PrevIcon />
              </button>

              <button
                type="button"
                className="icon-btn primary np-play"
                data-testid="np-play"
                onClick={hasEngine ? () => void playerStore.toggle() : undefined}
                disabled={!hasEngine}
                aria-disabled={!hasEngine}
                title={hasEngine ? (isPlaying ? "Pause" : "Play") : NO_ENGINE_REASON}
                aria-label={
                  hasEngine
                    ? isPlaying
                      ? `Pause ${current.title}`
                      : `Play ${current.title}`
                    : `Play — ${NO_ENGINE_REASON}`
                }
              >
                {isPlaying ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
              </button>

              <button
                type="button"
                className="icon-btn"
                data-testid="np-next"
                onClick={canAdvance ? () => void playerStore.next() : undefined}
                disabled={!canAdvance}
                aria-disabled={!canAdvance}
                title={canAdvance ? "Next track" : NO_NEXT_REASON}
                aria-label={canAdvance ? "Next track" : `Next — ${NO_NEXT_REASON}`}
              >
                <NextIcon />
              </button>

              <button
                type="button"
                className={repeat !== "off" ? "icon-btn toggle on" : "icon-btn toggle"}
                onClick={() => playerStore.cycleRepeat()}
                title={
                  repeat === "one"
                    ? "Repeat this track"
                    : repeat === "all"
                      ? "Repeat the queue"
                      : "Repeat off"
                }
                aria-label={`Repeat: ${repeat === "off" ? "off" : repeat}`}
              >
                <RepeatIcon />
                {repeat === "one" ? <span className="repeat-one" aria-hidden="true">1</span> : null}
              </button>
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}
