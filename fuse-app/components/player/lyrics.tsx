"use client";

// Synced lyrics panel (U9, R6/R7, AE2).
//
// Shows real time-synced lyrics that scroll with the song, the current line
// highlighted with the fuse gradient. It reads the single playback truth (current
// track + position) from the store and fetches lyrics from the cache-first
// /api/lyrics route when the Now Playing screen is open.
//
// HONESTY (R7/R17):
//   • When the user turns lyrics OFF in settings, the panel is HIDDEN entirely
//     (renders nothing) — the toggle does something real.
//   • When LRCLIB has no lyrics for the track, it says "No lyrics available for this
//     song" — never an empty or faked panel.
//   • A track with only unsynced (plain) lyrics shows them as static text and says
//     so, rather than pretending to scroll in time.

import { useEffect, useRef, useState } from "react";
import { usePlayerState } from "@/lib/player/use-player";
import { playerStore } from "@/lib/player/store";
import { activeLineIndex, type LrcLine } from "@/lib/lyrics";

type LyricsData =
  | { status: "loading" }
  | { status: "none" }
  | { status: "synced"; lines: LrcLine[] }
  | { status: "plain"; text: string };

const EMPTY_MSG = "No lyrics available for this song";

// Bound the lyrics fetch so a hung LRCLIB never leaves the panel spinning (it must
// settle to the honest empty state well inside the robot tester's 25s lyrics window).
const LYRICS_FETCH_TIMEOUT_MS = 12_000;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function Lyrics({
  enabled,
  active,
}: {
  // The lyrics on/off setting (R16). When false the panel is hidden.
  enabled: boolean;
  // Whether Now Playing is open — gates the fetch so lyrics load only when visible.
  active: boolean;
}) {
  const { current, positionSec } = usePlayerState();
  // The result is tagged with the track key it belongs to. While the loaded key does
  // not match the current track, the panel derives a "loading" state — so we never
  // call setState synchronously inside the effect (only in its async callbacks).
  const [loaded, setLoaded] = useState<{ key: string; data: LyricsData } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastScrolledIndex = useRef<number>(-1);

  const trackKey = current ? `${current.source}:${current.nativeId}` : null;

  // Fetch lyrics when the visible track changes (only while enabled + open, so a
  // hidden or off panel spends no requests).
  useEffect(() => {
    if (!enabled || !active || !current || !trackKey) return;
    let cancelled = false;

    const params = new URLSearchParams({ title: current.title });
    if (current.artist) params.set("artist", current.artist);
    if (current.durationSec != null) params.set("duration", String(current.durationSec));

    const settle = (data: LyricsData) => {
      if (cancelled) return;
      lastScrolledIndex.current = -1;
      setLoaded({ key: trackKey, data });
    };

    // A slow or unreachable LRCLIB (seen from datacenter IPs) must never leave the panel
    // spinning forever — an unresolved fetch is exactly the silent hang this app kills.
    // Abort after a bounded wait so we always settle to the honest "no lyrics" state.
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), LYRICS_FETCH_TIMEOUT_MS);

    fetch(`/api/lyrics?${params.toString()}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((payload: { found: boolean; synced: LrcLine[] | null; plain: string | null }) => {
        if (!payload.found) return settle({ status: "none" });
        if (payload.synced && payload.synced.length > 0) {
          return settle({ status: "synced", lines: payload.synced });
        }
        if (payload.plain) return settle({ status: "plain", text: payload.plain });
        return settle({ status: "none" });
      })
      .catch(() => {
        // A fetch failure OR a timeout abort is honest, not fatal: show the plain empty
        // message rather than a spinner that never resolves.
        settle({ status: "none" });
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [enabled, active, current, trackKey]);

  // Derived display state: still loading until the result for THIS track arrives.
  const data: LyricsData =
    loaded && loaded.key === trackKey ? loaded.data : { status: "loading" };

  // The currently-highlighted line (synced only).
  const activeIndex =
    data.status === "synced" ? activeLineIndex(data.lines, positionSec) : -1;

  // Keep the active line scrolled into view as the song advances.
  useEffect(() => {
    if (data.status !== "synced" || activeIndex < 0) return;
    if (activeIndex === lastScrolledIndex.current) return;
    lastScrolledIndex.current = activeIndex;
    const container = containerRef.current;
    const el = container?.querySelector<HTMLElement>(`[data-line="${activeIndex}"]`);
    if (el) {
      el.scrollIntoView({
        block: "center",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
  }, [activeIndex, data.status]);

  // Hidden when the user turned lyrics off (R16) or nothing is loaded.
  if (!enabled || !current) return null;

  if (data.status === "loading") {
    return (
      <div className="lyrics" aria-live="polite">
        <p className="lyrics-status">Loading lyrics…</p>
      </div>
    );
  }

  if (data.status === "none") {
    return (
      <div className="lyrics" aria-live="polite">
        <p className="lyrics-empty">{EMPTY_MSG}</p>
      </div>
    );
  }

  if (data.status === "plain") {
    return (
      <div className="lyrics" ref={containerRef}>
        <p className="lyrics-note">Lyrics (not time-synced — tap-to-jump isn’t available)</p>
        <div className="lyrics-plain">{data.text}</div>
      </div>
    );
  }

  // Synced: each line carries a real timestamp, so TAP-TO-SEEK is honest — tapping a line
  // jumps playback there (Wave 1). Rendered as buttons so it is keyboard-operable and
  // announced as an interactive control, not decorative text.
  return (
    <div
      className="lyrics lyrics-synced"
      ref={containerRef}
      aria-label="Lyrics — tap a line to jump there"
    >
      {data.lines.map((line, i) => (
        <button
          type="button"
          key={`${line.timeSec}-${i}`}
          data-line={i}
          data-testid="lyric-line"
          className={i === activeIndex ? "lyric active" : "lyric"}
          aria-current={i === activeIndex ? "true" : undefined}
          onClick={() => playerStore.seek(line.timeSec)}
          title="Jump to this line"
          aria-label={`Jump to lyric: ${line.text || "instrumental"}`}
        >
          {line.text || " "}
        </button>
      ))}
    </div>
  );
}
