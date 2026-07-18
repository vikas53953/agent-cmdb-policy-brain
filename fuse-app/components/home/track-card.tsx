"use client";

// One track card in a Home carousel (U12, R5/R10/R17).
//
// Shows the track's REAL cover art (YouTube thumbnail / Spotify cover), title, artist,
// and source badge — never a plain colored box (R5). The play button is HONEST: it is
// enabled only when tapping it actually plays in this commit, decided by the same
// resultPlayability rule the search results and library rows use. A source without a
// working adapter yet (or Spotify, deferred to U15) renders the button DISABLED with a
// plain-English reason — never a clickable dead control (R17). Tapping a playable card
// hands the track, and the rest of the row as the up-next queue, to the single store.

import { useState } from "react";
import type { TrackRef } from "@/lib/repos/track";
import { SOURCE_BADGES } from "@/lib/ui/shell";
import { resultPlayability } from "@/lib/search/playability";
import { adapterRegistry } from "@/lib/player/adapters";
import { playerStore } from "@/lib/player/store";
import { PlayIcon, MusicIcon } from "@/components/ui/icons";

export default function TrackCard({
  track,
  queue,
}: {
  track: TrackRef;
  // The tracks to line up after this one when it is played (the rest of the row).
  queue?: readonly TrackRef[];
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
    <div className="tcard">
      <div className="tcard-art">
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
          <span className="tcard-art-fallback" aria-hidden="true">
            <MusicIcon size={26} />
          </span>
        )}
        <button
          type="button"
          className="tcard-play"
          onClick={playable ? handlePlay : undefined}
          disabled={!playable}
          aria-disabled={!playable}
          title={playable ? `Play ${track.title}` : (reason ?? undefined)}
          aria-label={playable ? `Play ${track.title}` : `Play ${track.title} — ${reason}`}
        >
          <PlayIcon />
        </button>
      </div>

      <div className="tcard-title">{track.title}</div>
      <div className="tcard-sub">
        {track.artist ? <span className="tcard-artist">{track.artist}</span> : null}
        <span className={`badge ${badge.className}`}>{badge.label}</span>
      </div>
    </div>
  );
}
