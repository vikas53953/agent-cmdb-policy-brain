"use client";

// Persistent mini-player — SCAFFOLD (U4). There is no player engine yet (that is
// U5/U7), so this deliberately does NOT pretend to play anything. It renders the
// prototype's mini-player shell in an honest empty state: "Nothing playing yet",
// with the play and next controls DISABLED and a plain reason on hover (R17). When
// U7 lands real YouTube playback it replaces this empty state with a live track,
// a visible video thumbnail, and enabled transport.

import { MusicIcon, PlayIcon, NextIcon } from "@/components/ui/icons";

const NOT_WIRED_REASON = "Playback starts once the player engine is connected";

export default function MiniPlayer() {
  return (
    <div className="mini" aria-label="Mini player">
      <div className="mini-art" aria-hidden="true">
        <MusicIcon size={20} />
      </div>
      <div className="mini-meta">
        <div className="mini-title">Nothing playing yet</div>
        <div className="mini-sub">Search and tap a song once playback is wired</div>
      </div>
      <div className="mini-controls">
        {/* Disabled, not hidden: the control is honest about why it can't act. */}
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
