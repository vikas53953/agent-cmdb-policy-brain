"use client";

// Queue screen (Wave 1 — the #1 parity gap: a real, visible, controllable queue).
//
// A slide-up sheet reachable from the mini-player and Now Playing. It shows the CURRENT
// track plus the UP-NEXT list, and lets the listener reorder (drag, or the keyboard-
// operable up/down controls), remove a track, all against the single player store — which
// already holds the queue and persists it through the session snapshot. Nothing here holds
// its own copy of the queue; it renders from the store truth and calls store actions.
//
// HONESTY (R17): every control does something real. Reorder and remove mutate the actual
// queue; an empty queue says so plainly rather than showing a fake list. When radio
// continuation is streaming, a plain line says the queue is being extended with similar
// tracks (the same consented behaviour the Now Playing banner announces).

import Sheet from "@/components/ui/sheet";
import { occurrenceKeys } from "@/components/ui/list-keys";
import { usePlayerSelector } from "@/lib/player/use-player-selector";
import { playerStore } from "@/lib/player/store";
import { SOURCE_BADGES } from "@/lib/ui/shell";
import {
  ChevronDownIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  TrashIcon,
  MusicIcon,
  MoreIcon,
} from "@/components/ui/icons";
import { useRef } from "react";
import type { TrackRef } from "@/lib/repos/track";

function RowArt({ track }: { track: TrackRef }) {
  if (track.artUrl) {
    return (
      <div className="q-row-art">
        {/* eslint-disable-next-line @next/next/no-img-element -- external source CDN, allowed by CSP img-src */}
        <img src={track.artUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
      </div>
    );
  }
  return (
    <div className="q-row-art q-row-art-fallback" aria-hidden="true">
      <MusicIcon size={18} />
    </div>
  );
}

export default function QueuePanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { current, queue, radioActive, autoplayQueued } = usePlayerSelector((s) => ({
    current: s.current,
    queue: s.queue,
    radioActive: s.radioActive,
    autoplayQueued: s.autoplayQueued,
  }));

  // The index currently being dragged, so onDrop knows the source position. A ref (not
  // state) because it changes mid-drag and must not trigger re-renders.
  const dragFrom = useRef<number | null>(null);

  function onDrop(to: number) {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from == null || from === to) return;
    playerStore.moveInQueue(from, to);
  }

  // Identity-based row keys. The index used to be baked into the key, so ONE Move-up
  // changed the key of every row from the move onward and React remounted them all —
  // dropped artwork and lost focus on the very button being pressed, which is why
  // repeated up-taps did not work. The same song can legitimately sit in the queue
  // twice, so the key is identity + WHICH occurrence, never identity alone.
  const rowKeys = occurrenceKeys(queue.map((t) => `${t.source}:${t.nativeId}`));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      label="Play queue"
      className="queue"
      overlayClassName="q-overlay"
      as="section"
      data-testid="queue-panel"
      data-queue-open={open ? "true" : "false"}
    >
        <header className="q-head">
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close queue"
          >
            <ChevronDownIcon />
          </button>
          <span className="q-head-label">Queue</span>
        </header>

        {current ? (
          <div className="q-now">
            <div className="q-section-label">Now playing</div>
            <div className="q-row q-row-current" data-testid="queue-current">
              <RowArt track={current} />
              <div className="q-row-meta">
                <div className="q-row-title">{current.title}</div>
                <div className="q-row-sub">
                  {current.artist ? <span>{current.artist}</span> : null}
                  <span className={`badge ${SOURCE_BADGES[current.source]?.className ?? "mp3"}`}>
                    {SOURCE_BADGES[current.source]?.label ?? current.source}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="q-up">
          <div className="q-section-label">
            {autoplayQueued && !radioActive ? "Up next — Autoplay" : "Up next"}
            {radioActive ? (
              <span className="q-radio-note" data-testid="queue-radio-note">
                {" "}· radio is adding similar tracks
              </span>
            ) : autoplayQueued ? (
              <span className="q-radio-note" data-testid="queue-autoplay-note">
                {" "}· similar songs, from your Autoplay setting
              </span>
            ) : null}
          </div>

          {queue.length === 0 ? (
            <p className="q-empty" data-testid="queue-empty">
              {current
                ? radioActive
                  ? "Radio will keep the music going with similar tracks."
                  : "Nothing up next. Add songs with “Play next” or “Add to queue”."
                : "Nothing playing yet — search and tap a song to start."}
            </p>
          ) : (
            <ul className="q-list" aria-label="Up next" data-testid="queue-list">
              {queue.map((t, i) => (
                <li
                  key={rowKeys[i]}
                  className="q-row"
                  data-testid="queue-row"
                  data-index={i}
                  draggable
                  onDragStart={() => {
                    dragFrom.current = i;
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(i)}
                >
                  <span className="q-drag" aria-hidden="true" title="Drag to reorder">
                    <MoreIcon size={16} />
                  </span>
                  <RowArt track={t} />
                  <div className="q-row-meta">
                    <div className="q-row-title">{t.title}</div>
                    <div className="q-row-sub">
                      {t.artist ? <span>{t.artist}</span> : null}
                      <span className={`badge ${SOURCE_BADGES[t.source]?.className ?? "mp3"}`}>
                        {SOURCE_BADGES[t.source]?.label ?? t.source}
                      </span>
                    </div>
                  </div>
                  <div className="q-row-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      data-testid="queue-up"
                      onClick={() => playerStore.moveInQueue(i, i - 1)}
                      disabled={i === 0}
                      aria-label={`Move ${t.title} up`}
                      title="Move up"
                    >
                      <ArrowUpIcon size={18} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      data-testid="queue-down"
                      onClick={() => playerStore.moveInQueue(i, i + 1)}
                      disabled={i === queue.length - 1}
                      aria-label={`Move ${t.title} down`}
                      title="Move down"
                    >
                      <ArrowDownIcon size={18} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      data-testid="queue-remove"
                      onClick={() => playerStore.removeFromQueue(i)}
                      aria-label={`Remove ${t.title} from the queue`}
                      title="Remove from queue"
                    >
                      <TrashIcon size={18} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
    </Sheet>
  );
}
