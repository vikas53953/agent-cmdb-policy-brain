"use client";

// One track row in the Library (U10). Shared by the Liked list and each playlist's
// track list so cover art (R5), the source badge, and the honest Play button look
// and behave identically everywhere.
//
// HONESTY (R17): the Play button is enabled only when tapping it actually plays in
// this commit — decided by resultPlayability(source, hasAdapter), the same rule the
// search results use. A Spotify like is real data you can keep and organise, but it
// renders with Play disabled and the plain reason "Plays after Spotify support
// arrives" until U15 — never a clickable dead control. Trailing actions (unlike,
// remove, reorder) are passed in as `actions`.

import { useState } from "react";
import type { TrackRef } from "@/lib/repos/track";
import { SOURCE_BADGES } from "@/lib/ui/shell";
import { resultPlayability } from "@/lib/search/playability";
import { adapterRegistry } from "@/lib/player/adapters";
import { playerStore } from "@/lib/player/store";
import { PlayIcon, MusicIcon } from "@/components/ui/icons";

export default function LibraryTrackRow({
  track,
  queue,
  actions,
}: {
  track: TrackRef;
  // The tracks to line up after this one when it is played (the rest of the list).
  queue?: readonly TrackRef[];
  // Trailing control(s) for this row — unlike, remove, reorder, etc.
  actions?: React.ReactNode;
}) {
  const [artFailed, setArtFailed] = useState(false);
  const badge = SOURCE_BADGES[track.source] ?? { className: "mp3", label: track.source };
  const hasAdapter = adapterRegistry.get(track.source) !== undefined;
  const { playable, reason } = resultPlayability(track.source, hasAdapter);
  const showArt = track.artUrl && !artFailed;

  function handlePlay() {
    playerStore.setQueue(queue ?? []);
    void playerStore.play(track);
  }

  return (
    <div className="lib-row">
      <div className="lib-row-art">
        {showArt ? (
          // eslint-disable-next-line @next/next/no-img-element -- external source CDN (i.ytimg.com / i.scdn.co); allowed by CSP img-src
          <img
            src={track.artUrl ?? undefined}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setArtFailed(true)}
          />
        ) : (
          <span className="lib-row-art-fallback" aria-hidden="true">
            <MusicIcon size={20} />
          </span>
        )}
      </div>

      <div className="lib-row-meta">
        <div className="lib-row-title">{track.title}</div>
        <div className="lib-row-sub">
          {track.artist ? <span className="lib-row-artist">{track.artist}</span> : null}
          <span className={`badge ${badge.className}`}>{badge.label}</span>
        </div>
      </div>

      <div className="lib-row-actions">
        <button
          type="button"
          className="icon-btn primary"
          onClick={playable ? handlePlay : undefined}
          disabled={!playable}
          aria-disabled={!playable}
          title={playable ? `Play ${track.title}` : (reason ?? undefined)}
          aria-label={playable ? `Play ${track.title}` : `Play ${track.title} — ${reason}`}
        >
          <PlayIcon />
        </button>
        {actions}
      </div>
    </div>
  );
}
