"use client";

// Per-row queue actions (Wave 1) — "Play next" and "Add to queue" on every track row
// app-wide (search results, home carousels, library lists). A compact overflow (⋯) that
// opens a small menu, so the two actions are reachable everywhere without crowding a row.
//
// HONESTY (R17): these actions are only offered when the track can ACTUALLY play — the
// same resultPlayability rule the row's Play button uses. Queuing a track the app cannot
// stream would be a promise it can't keep, so when a source has no working adapter the
// trigger renders disabled with the same plain-English reason (never a dead menu item).

import { useEffect, useRef, useState } from "react";
import type { TrackRef } from "@/lib/repos/track";
import { adapterRegistry } from "@/lib/player/adapters";
import { resultPlayability } from "@/lib/search/playability";
import { playerStore } from "@/lib/player/store";
import { MoreIcon, NextIcon, PlusIcon } from "@/components/ui/icons";

export default function QueueActions({ track }: { track: TrackRef }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const hasAdapter = adapterRegistry.get(track.source) !== undefined;
  const { playable, reason } = resultPlayability(track.source, hasAdapter);

  // Close on outside click or Escape (keyboard-operable, no dangling menu).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function playNext() {
    playerStore.playNext(track);
    setOpen(false);
  }
  function addToQueue() {
    playerStore.addToQueue(track);
    setOpen(false);
  }

  return (
    <div className="qmenu" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        data-testid="queue-menu-trigger"
        onClick={playable ? () => setOpen((v) => !v) : undefined}
        disabled={!playable}
        aria-disabled={!playable}
        aria-haspopup="menu"
        aria-expanded={open}
        title={playable ? "Queue options" : (reason ?? undefined)}
        aria-label={
          playable ? `Queue options for ${track.title}` : `Queue options — ${reason}`
        }
      >
        <MoreIcon />
      </button>

      {open ? (
        <div className="qmenu-pop" role="menu" data-testid="queue-menu">
          <button
            type="button"
            role="menuitem"
            className="qmenu-item"
            data-testid="queue-play-next"
            onClick={playNext}
          >
            <NextIcon size={18} />
            <span>Play next</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="qmenu-item"
            data-testid="queue-add"
            onClick={addToQueue}
          >
            <PlusIcon size={18} />
            <span>Add to queue</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
