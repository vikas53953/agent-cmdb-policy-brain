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
import { usePlayerSelector } from "@/lib/player/use-player-selector";
import { usePlaybackTruth } from "@/lib/player/use-playback-truth";
import { playerStore } from "@/lib/player/store";
import { nextWithBlend } from "@/lib/player/blend-controller";
import { playerHostCoordinator } from "@/lib/player/host-coordinator";
import { adapterRegistry } from "@/lib/player/adapters";
import { SOURCE_BADGES } from "@/lib/ui/shell";
import { isAudioTrack } from "@/lib/search/audio-kind";
import VideoSurface from "@/components/player/video-surface";
import VolumeControl from "@/components/player/volume-control";
import Scrub from "@/components/player/scrub";
import Lyrics from "@/components/player/lyrics";
import MeltPanel from "@/components/player/melt-panel";
import TransitionMoment from "@/components/player/transition-moment";
import LikeButton from "@/components/player/like-button";
import SleepTimerControl from "@/components/player/sleep-timer-control";
import {
  PlayIcon,
  PauseIcon,
  NextIcon,
  PrevIcon,
  ShuffleIcon,
  RepeatIcon,
  ChevronDownIcon,
  MusicIcon,
  QueueIcon,
  FullscreenIcon,
  ExpandIcon,
} from "@/components/ui/icons";

const STALL_MSG = "Playback stalled — retrying";
const STILL_STUCK_MSG = "Still stuck — this track won't play right now";
const NO_ENGINE_REASON = "Playback starts once the player engine is connected";
const NO_NEXT_REASON = "Nothing queued up next";
const NO_SKIP_REASON = "Nothing queued to skip to";

export default function NowPlaying({
  open,
  onClose,
  onQueue,
  lyricsEnabled,
}: {
  open: boolean;
  onClose: () => void;
  // Open the queue screen (Wave 1) — the second place, besides the mini-player, a listener
  // reaches the up-next list.
  onQueue?: () => void;
  // Lyrics on/off setting (U9, R16). Threaded from the shell so the toggle in the
  // profile sheet shows/hides this screen's lyrics panel instantly.
  lyricsEnabled: boolean;
}) {
  // Subscribe to the rarely-changing slice — deliberately NOT positionSec/durationSec, so
  // the 500ms position poll never re-renders this whole screen. The scrub bar owns those
  // itself (R5).
  const { current, queue, shuffle, repeat, notice, radioActive } =
    usePlayerSelector((s) => ({
      current: s.current,
      queue: s.queue,
      shuffle: s.shuffle,
      repeat: s.repeat,
      notice: s.notice,
      radioActive: s.radioActive,
    }));

  // The ONE playback reading (lib/player/playback-truth.ts). The transport, the stall
  // banner, and the Transition Moment all render from this same answer, so this screen
  // cannot show a Pause button and a "won't play" banner at the same moment again.
  const truth = usePlaybackTruth();
  const showPause = truth.transportShowsPause;

  // "Bigger player" — the plain-words larger-player LAYOUT toggle for VIDEO tracks (owner
  // fix 4, replacing the confusing "theater" wording): it expands the video to fill the full
  // width of the Now Playing surface, still inline. This is the honest in-page layout control;
  // true full screen is the separate Fullscreen API button below. Reset on track change so a
  // new song never opens unexpectedly enlarged.
  const [bigger, setBigger] = useState(false);

  // Close on Escape while open (accessibility parity with the profile sheet).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // A new track resets theater — the maximise state belongs to the video you were
  // watching, not the next one. This is React's documented "adjust state when a prop
  // changes" pattern (a guarded setState during render), not an effect, so it applies
  // in the same render with no cascading re-render.
  const currentId = current ? `${current.source}:${current.nativeId}` : null;
  const prevIdRef = useRef(currentId);
  if (prevIdRef.current !== currentId) {
    prevIdRef.current = currentId;
    // A new video opens with the bigger player BY DEFAULT on a desktop-width viewport (owner
    // fix 4), and the padded default on a phone. The user's Bigger/Smaller control overrides
    // it. Guarded setState during render (React's "adjust state on prop change" pattern); the
    // guard only fires on a real track change, never on first render, so SSR stays consistent.
    const desktopDefault =
      typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 700px)").matches;
    if (bigger !== desktopDefault) setBigger(desktopDefault);
  }

  // Enter REAL full screen (owner fix 4) via the Fullscreen API, on the single persistent
  // player host (the element that actually holds the YouTube iframe — the art slot is only
  // an empty geometry box the video is laid over, so fullscreening it would show nothing).
  // Honest fallback: if the browser has no Fullscreen API or refuses, we do nothing rather
  // than pretend — the inline "Bigger player" layout is always available as the plain option.
  function enterFullscreen() {
    const host = playerHostCoordinator.primaryHost();
    if (!host) return;
    const req = host.requestFullscreen?.bind(host);
    if (!req) return;
    // The host is pointer-events:none for normal overlay behaviour; allow interaction while
    // it owns the whole screen so the browser's fullscreen affordances work.
    const prevPE = host.style.pointerEvents;
    host.style.pointerEvents = "auto";
    void Promise.resolve(req()).catch(() => {
      host.style.pointerEvents = prevPE;
    });
    const restore = () => {
      if (!document.fullscreenElement) {
        host.style.pointerEvents = prevPE;
        document.removeEventListener("fullscreenchange", restore);
      }
    };
    document.addEventListener("fullscreenchange", restore);
  }

  // The recovery ladder is driven app-wide by the single monitor in the shell
  // (use-playback-recovery.ts). This screen only RENDERS its honest phase from the store
  // truth — so the banner and the mini-player's data-player-state can never disagree.
  const showOpen = open && !!current;
  const hasEngine = current ? adapterRegistry.get(current.source) !== undefined : false;
  const canAdvance = queue.length > 0;
  const badge = current
    ? SOURCE_BADGES[current.source] ?? { className: "mp3", label: current.source }
    : null;

  // Show the honest banner whenever playback is stuck: "retrying" while the ladder works,
  // then the terminal "won't play" + Skip once it gives up. Read from the same one truth
  // as the transport, so the two can never contradict each other.
  const stalled = truth.stuck;

  // Audio-vs-video presentation (Complaint 1/2). A YouTube track that is an official audio
  // upload ("- Topic" channel, "Official Audio" title) is shown ART-FORWARD: the (static-
  // image) video renders as a compact, album-art square rather than a wide black video
  // surface. An ordinary video keeps the 16:9 surface and gains the theater toggle.
  const isYouTube = current?.source === "youtube";
  const isAudio = current ? isAudioTrack(current) : false;
  const isVideoTrack = isYouTube && !isAudio;
  const artClass = isAudio
    ? "np-art np-art-audio"
    : bigger && isVideoTrack
      ? "np-art np-art-bigger"
      : "np-art";

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
          <div className="np-inner">
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
              {/* Now Playing overflow (Wave 1): the sleep timer and the queue screen. */}
              <span className="np-head-actions">
                <SleepTimerControl />
                <button
                  type="button"
                  className="icon-btn"
                  data-testid="np-queue"
                  onClick={onQueue}
                  disabled={!onQueue}
                  aria-disabled={!onQueue}
                  title="Open the queue"
                  aria-label="Open the queue"
                >
                  <QueueIcon />
                </button>
              </span>
              {/* Honest kind chip: says plainly whether you're hearing an audio version or
                  watching a video (Complaint 1). */}
              {isYouTube ? (
                <span
                  className={`kind-badge kind-${isAudio ? "audio" : "video"}`}
                  data-testid="np-kind"
                  data-kind={isAudio ? "audio" : "video"}
                >
                  {isAudio ? "Audio" : "Video"}
                </span>
              ) : null}
            </header>

            {/* The content stage centres its column so leftover height is split evenly
                rather than pooling into a dead blank band below the controls (Complaint 2). */}
            <div className="np-stage" data-theater={bigger && isVideoTrack ? "on" : "off"}>
            <div className={artClass} data-testid="np-art">
              {open && current.source === "youtube" ? (
                // The visible YouTube video IS the artwork surface (KTD-7). For an audio
                // upload the surrounding box is square (album-art framed); for a video it
                // is 16:9 and can be maximised via the theater toggle below.
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

            {/* Video controls (owner fix 4) — only for a real video track (an audio upload is
                already presented art-forward). Two plain-words controls, no "theater" jargon:
                a "Bigger/Smaller player" inline LAYOUT toggle, and a standard Full screen
                button that uses the Fullscreen API. */}
            {isVideoTrack ? (
              <div className="np-theater-bar">
                <button
                  type="button"
                  className={bigger ? "np-theater-btn on" : "np-theater-btn"}
                  data-testid="np-bigger"
                  aria-pressed={bigger}
                  onClick={() => setBigger((b) => !b)}
                  title={bigger ? "Use the smaller player" : "Use a bigger player"}
                  aria-label={bigger ? "Smaller player" : "Bigger player"}
                >
                  <ExpandIcon size={16} />
                  <span>{bigger ? "Smaller player" : "Bigger player"}</span>
                </button>
                <button
                  type="button"
                  className="np-theater-btn"
                  data-testid="np-fullscreen"
                  onClick={enterFullscreen}
                  title="Full screen"
                  aria-label="Full screen"
                >
                  <FullscreenIcon size={16} />
                  <span>Full screen</span>
                </button>
              </div>
            ) : null}

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

            {/* RADIO CONTINUATION banner (Wave 1). Shown only while radio is truly carrying
                listening past the end of the queue. It announces the one sanctioned auto-play
                on screen and points to the setting that turns it off — user-consented and
                honest, never a silent surprise. */}
            {radioActive ? (
              <p
                className="np-radio-banner"
                role="status"
                aria-live="polite"
                data-testid="np-radio-banner"
              >
                Autoplay: playing similar tracks — turn off in settings
              </p>
            ) : null}

            {/* THE TRANSITION MOMENT (F-0 item 1) — the hero: NOW / NEXT with small art and
                a live "Fusing in N seconds" countdown reflecting the ACTUAL adapted melt
                length. Honest — it shows only what is true for the current pair, and says
                plainly when playback will end. Owns its own position subscription so the
                countdown ticks without re-rendering the whole screen. */}
            <TransitionMoment />

            {/* Auto-crossfade visual (U11, R3/F2): shown only while a blend is truly
                under way — the incoming track melting in with a progress bar. */}
            <MeltPanel />

            {/* Real synced lyrics (U9). Hidden entirely when the user turns lyrics
                off; honest "no lyrics" message when LRCLIB has none. */}
            <Lyrics enabled={lyricsEnabled} active={showOpen} />

            {stalled ? (
              <div className="np-stall" role="status" aria-live="polite" data-testid="np-stall">
                {truth.giveUp ? (
                  // The ladder gave up: honest terminal + a working Skip. Never a silent
                  // freeze and never an endless "retrying" (AE1).
                  <>
                    <span className="np-stall-msg">{STILL_STUCK_MSG}</span>
                    <button
                      type="button"
                      className="np-stall-skip"
                      data-testid="np-skip"
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

            <Scrub />

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

              {/* TRUE PREVIOUS (Wave 1): goes back a song when near the start of the track,
                  or restarts it when you are further in — the industry-standard behaviour.
                  The label is honest about doing both, never claiming "restart" only. */}
              <button
                type="button"
                className="icon-btn"
                data-testid="np-prev"
                onClick={hasEngine ? () => void playerStore.previous() : undefined}
                disabled={!hasEngine}
                aria-disabled={!hasEngine}
                title={hasEngine ? "Previous — back a song, or restart if you're further in" : NO_ENGINE_REASON}
                aria-label={
                  hasEngine
                    ? "Previous — go back a song, or restart the track if you're further in"
                    : `Previous — ${NO_ENGINE_REASON}`
                }
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
                title={hasEngine ? (showPause ? "Pause" : "Play") : NO_ENGINE_REASON}
                aria-label={
                  hasEngine
                    ? showPause
                      ? `Pause ${current.title}`
                      : `Play ${current.title}`
                    : `Play — ${NO_ENGINE_REASON}`
                }
              >
                {showPause ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
              </button>

              <button
                type="button"
                className="icon-btn"
                data-testid="np-next"
                onClick={canAdvance ? () => nextWithBlend() : undefined}
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

            {/* Volume slider + mute (owner fix 3), inline on the full player. */}
            <VolumeControl variant="full" />
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
