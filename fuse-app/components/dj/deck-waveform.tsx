"use client";

// DJ deck waveform (DJ-1). Two canvases drawn from the decoded buffer's peaks (computed
// on the audio thread, lib/dj/analysis.computePeaks) — the honest "see the music" view
// that only a LOCAL deck can show (YouTube hands us no samples, so a YouTube deck never
// mounts this; it shows the video instead, per the honesty matrix).
//
//   • overview strip — the whole track, with cue markers, a moving playhead and a window
//     box showing where the scrolling lane is looking. Click it to seek anywhere.
//   • scrolling lane — a zoomed window that moves with the playhead, with the beatgrid
//     laid over it (from the detected/tapped BPM) and cue flags, so loops and cues visibly
//     snap to the beat. Click it to seek within the window.
//
// Everything drawn here is real: the peaks are the actual audio, the grid is the actual
// tempo, the playhead is the engine's actual position. Nothing is decorative.

import { useEffect, useRef } from "react";
import { beatTimes } from "@/lib/dj/analysis";

// Seconds visible in the zoomed scrolling lane (a few bars at typical tempo).
const WINDOW_SEC = 8;

const ACCENT = {
  a: { wave: "#ff7a45", grid: "rgba(255,122,69,0.28)", playhead: "#ffd9c7" },
  b: { wave: "#2fd6c2", grid: "rgba(47,214,194,0.28)", playhead: "#c7f4ee" },
} as const;

const CUE_COLOR = "#e7b34a";

export type CueMarker = { slot: number; positionSec: number };

function peakAt(peaks: readonly number[], timeSec: number, durationSec: number): number {
  if (peaks.length === 0 || durationSec <= 0) return 0;
  const idx = Math.floor((timeSec / durationSec) * peaks.length);
  if (idx < 0 || idx >= peaks.length) return 0;
  return peaks[idx];
}

// A spoken-friendly position ("1 minute 4 seconds" reads badly; "1:04 of 3:20" is what a
// screen reader user actually wants from a seek control).
export function clockLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss < 10 ? "0" : ""}${ss}`;
}

function paintLane(
  canvas: HTMLCanvasElement,
  peaks: readonly number[],
  fromSec: number,
  toSec: number,
  durationSec: number,
  waveColor: string,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const mid = h / 2;
  ctx.fillStyle = waveColor;
  const span = toSec - fromSec;
  if (span <= 0) return;
  for (let x = 0; x < w; x++) {
    const t = fromSec + (x / w) * span;
    if (t < 0 || t > durationSec) continue;
    const amp = peakAt(peaks, t, durationSec);
    const barH = Math.max(1, amp * (h - 2));
    ctx.fillRect(x, mid - barH / 2, 1, barH);
  }
}

export default function DeckWaveform({
  deckId,
  accent,
  peaks,
  durationSec,
  positionSec,
  bpm,
  firstBeatSec,
  cues,
  onSeek,
}: {
  deckId: string;
  accent: "a" | "b";
  peaks: readonly number[];
  durationSec: number;
  positionSec: number;
  bpm: number;
  firstBeatSec: number;
  cues: readonly CueMarker[];
  onSeek: (positionSec: number) => void;
}) {
  const overviewRef = useRef<HTMLCanvasElement>(null);
  const laneRef = useRef<HTMLCanvasElement>(null);
  const colors = ACCENT[accent];

  // Redraw whenever the position, peaks, grid or cues change (the parent's animation loop
  // bumps positionSec each frame while playing, so this repaints the moving playhead).
  useEffect(() => {
    const overview = overviewRef.current;
    const lane = laneRef.current;
    if (!overview || !lane) return;

    // ── Overview: the whole track ──
    paintLane(overview, peaks, 0, durationSec, durationSec, colors.wave);
    const octx = overview.getContext("2d");
    if (octx) {
      const w = overview.width;
      const h = overview.height;
      const xOf = (t: number) => (durationSec > 0 ? (t / durationSec) * w : 0);
      // Window box (where the lane is looking).
      const winFrom = xOf(positionSec - WINDOW_SEC / 2);
      const winTo = xOf(positionSec + WINDOW_SEC / 2);
      octx.strokeStyle = "rgba(255,255,255,0.35)";
      octx.strokeRect(winFrom, 0.5, Math.max(2, winTo - winFrom), h - 1);
      // Cue flags.
      octx.fillStyle = CUE_COLOR;
      for (const c of cues) octx.fillRect(xOf(c.positionSec) - 1, 0, 2, h);
      // Playhead.
      octx.fillStyle = colors.playhead;
      octx.fillRect(xOf(positionSec) - 1, 0, 2, h);
    }

    // ── Scrolling lane: a zoomed window around the playhead ──
    const from = positionSec - WINDOW_SEC / 2;
    const to = positionSec + WINDOW_SEC / 2;
    paintLane(lane, peaks, from, to, durationSec, colors.wave);
    const lctx = lane.getContext("2d");
    if (lctx) {
      const w = lane.width;
      const h = lane.height;
      const xOf = (t: number) => ((t - from) / (to - from)) * w;
      // Beatgrid.
      if (bpm > 0) {
        lctx.strokeStyle = colors.grid;
        lctx.lineWidth = 1;
        for (const t of beatTimes(bpm, firstBeatSec, Math.max(0, from), Math.min(durationSec, to))) {
          const x = Math.round(xOf(t)) + 0.5;
          lctx.beginPath();
          lctx.moveTo(x, 0);
          lctx.lineTo(x, h);
          lctx.stroke();
        }
      }
      // Cue flags in view.
      lctx.fillStyle = CUE_COLOR;
      for (const c of cues) {
        if (c.positionSec >= from && c.positionSec <= to) lctx.fillRect(xOf(c.positionSec) - 1, 0, 2, h);
      }
      // Playhead at the centre.
      lctx.fillStyle = colors.playhead;
      lctx.fillRect(w / 2 - 1, 0, 2, h);
    }
  }, [peaks, durationSec, positionSec, bpm, firstBeatSec, cues, colors]);

  function seekFromOverview(e: React.MouseEvent<HTMLCanvasElement>) {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, Math.min(1, frac)) * durationSec);
  }

  // Both strips are real seek controls, so they are real sliders: focusable, arrow-key
  // driven, and announced with a time rather than a raw number. Promising "click to seek"
  // to someone who cannot click was the lie this fixes.
  const STEP_SEC = 1;
  const BIG_STEP_SEC = 5;

  function seekBy(deltaSec: number) {
    onSeek(Math.max(0, Math.min(durationSec, positionSec + deltaSec)));
  }

  function onSeekKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    let handled = true;
    switch (e.key) {
      case "ArrowLeft":
        seekBy(-STEP_SEC);
        break;
      case "ArrowRight":
        seekBy(STEP_SEC);
        break;
      case "ArrowDown":
      case "PageDown":
        seekBy(-BIG_STEP_SEC);
        break;
      case "ArrowUp":
      case "PageUp":
        seekBy(BIG_STEP_SEC);
        break;
      case "Home":
        onSeek(0);
        break;
      case "End":
        onSeek(durationSec);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  }

  function seekFromLane(e: React.MouseEvent<HTMLCanvasElement>) {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const from = positionSec - WINDOW_SEC / 2;
    onSeek(Math.max(0, Math.min(durationSec, from + frac * WINDOW_SEC)));
  }

  return (
    <div className="deck-wave" data-testid={`deck-${deckId}-waveform`}>
      {/* Focus ring for the two seek strips. Scoped to this component's own class so it
          needs no change to the shared stylesheet. */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            ".deck-wave-seek:focus-visible{outline:2px solid #ffffff;outline-offset:2px;}",
        }}
      />
      <canvas
        ref={overviewRef}
        className="deck-wave-overview deck-wave-seek"
        width={640}
        height={36}
        onClick={seekFromOverview}
        onKeyDown={onSeekKeyDown}
        role="slider"
        tabIndex={0}
        aria-label={`Deck ${deckId} track position`}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.round(durationSec))}
        aria-valuenow={Math.max(0, Math.round(positionSec))}
        aria-valuetext={`${clockLabel(positionSec)} of ${clockLabel(durationSec)}`}
      />
      <canvas
        ref={laneRef}
        className="deck-wave-lane deck-wave-seek"
        width={640}
        height={96}
        onClick={seekFromLane}
        onKeyDown={onSeekKeyDown}
        role="slider"
        tabIndex={0}
        aria-label={`Deck ${deckId} waveform position`}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.round(durationSec))}
        aria-valuenow={Math.max(0, Math.round(positionSec))}
        aria-valuetext={`${clockLabel(positionSec)} of ${clockLabel(durationSec)}`}
      />
    </div>
  );
}
