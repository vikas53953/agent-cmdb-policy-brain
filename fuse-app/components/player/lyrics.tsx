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
//   • When the lookup itself FAILS (a bad response or a timeout), it says "couldn't
//     load" — never "no lyrics", which would blame the song for our problem.

import { useEffect, useRef, useState } from "react";
import { usePlayerState } from "@/lib/player/use-player";
import { playerStore } from "@/lib/player/store";
import { activeLineIndex, type LrcLine } from "@/lib/lyrics";

type LyricsData =
  | { status: "loading" }
  | { status: "none" }
  // AUDIT 25: "we asked and this song has none" and "we couldn't ask" are DIFFERENT
  // facts. Merging them told the user a song had no lyrics when the truth was a failed
  // request — a lie the honest empty state was hiding.
  | { status: "unavailable" }
  | { status: "synced"; lines: LrcLine[] }
  | { status: "plain"; text: string };

const EMPTY_MSG = "No lyrics available for this song";
const UNAVAILABLE_MSG = "Couldn't load lyrics — reopen this screen to try again";

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
  // Plain (unsynced) lyrics live behind a compact toggle (owner fix 5b), like Apple Music —
  // collapsed by default so a wall of text never pushes the transport off-screen. Reset when
  // the track changes so a new song opens collapsed.
  const [plainOpen, setPlainOpen] = useState(false);
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
      setPlainOpen(false); // a freshly-loaded track opens with plain lyrics collapsed
      setLoaded({ key: trackKey, data });
    };

    // A slow or unreachable LRCLIB (seen from datacenter IPs) must never leave the panel
    // spinning forever — an unresolved fetch is exactly the silent hang this app kills.
    // Abort after a bounded wait so we always settle to the honest "no lyrics" state.
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), LYRICS_FETCH_TIMEOUT_MS);

    fetch(`/api/lyrics?${params.toString()}`, { signal: controller.signal })
      .then((r) => {
        // The route's own error responses were being parsed as an honest "no lyrics".
        // A non-OK response means we never got an answer about this song.
        if (!r.ok) throw new Error(`lyrics ${r.status}`);
        return r.json();
      })
      .then((payload: { found: boolean; synced: LrcLine[] | null; plain: string | null }) => {
        if (!payload.found) return settle({ status: "none" });
        if (payload.synced && payload.synced.length > 0) {
          return settle({ status: "synced", lines: payload.synced });
        }
        if (payload.plain) return settle({ status: "plain", text: payload.plain });
        return settle({ status: "none" });
      })
      .catch(() => {
        // A failed request, a bad response, or a timeout abort: still not fatal, and
        // still settles (never a spinner that hangs) — but it settles as "couldn't
        // load", NOT as "this song has no lyrics".
        settle({ status: "unavailable" });
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
    // Compact (owner fix 5c): a one-line status, not a tall block, so the transport stays
    // visible without scrolling while lyrics load.
    return (
      <div className="lyrics lyrics-compact" aria-live="polite">
        <p className="lyrics-status">Loading lyrics…</p>
      </div>
    );
  }

  if (data.status === "none") {
    // Compact honest empty state (owner fix 5c) — a small line, never a huge dead gap that
    // shoves the controls off-screen.
    return (
      <div className="lyrics lyrics-compact" aria-live="polite">
        <p className="lyrics-empty" data-testid="lyrics-empty">{EMPTY_MSG}</p>
      </div>
    );
  }

  if (data.status === "unavailable") {
    // Same compact shape as the empty state, different fact — and it says what to do.
    return (
      <div className="lyrics lyrics-compact" role="status" aria-live="polite">
        <p className="lyrics-empty" data-testid="lyrics-error">{UNAVAILABLE_MSG}</p>
      </div>
    );
  }

  if (data.status === "plain") {
    // Plain lyrics behind a compact toggle (owner fix 5b), Apple-Music style: a small
    // "Lyrics" button by default (transport stays visible); expanding shows the text in a
    // bounded, scrollable panel rather than an inline wall.
    return (
      <div className="lyrics lyrics-compact" ref={containerRef}>
        <button
          type="button"
          className="lyrics-toggle"
          data-testid="lyrics-toggle"
          aria-expanded={plainOpen}
          onClick={() => setPlainOpen((v) => !v)}
          title={plainOpen ? "Hide lyrics" : "Show lyrics"}
        >
          {plainOpen ? "Hide lyrics" : "Lyrics"}
        </button>
        {plainOpen ? (
          <div className="lyrics-plain-panel" data-testid="lyrics-plain-panel">
            <p className="lyrics-note">Lyrics (not time-synced — tap-to-jump isn’t available)</p>
            <div className="lyrics-plain">{data.text}</div>
          </div>
        ) : null}
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
