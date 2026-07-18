"use client";

// One search result row (U6, R1/R5/R17).
//
// Shows the track's REAL cover art (YouTube thumbnail or Spotify album cover),
// its title/artist, and a source badge. The play control is HONEST: it renders
// enabled only when `resultPlayability` says tapping it actually plays in this
// commit; otherwise it is disabled with a plain-English reason (never a clickable
// dead result). Tapping a playable result hands the track — and the rest of the
// list as the up-next queue — to the single player store.

import { useState } from "react";
import type { TrackRef } from "@/lib/repos/track";
import { SOURCE_BADGES } from "@/lib/ui/shell";
import { resultPlayability } from "@/lib/search/playability";
import { playerStore } from "@/lib/player/store";
import AddToPlaylist from "@/components/library/add-to-playlist";
import { PlayIcon, MusicIcon } from "@/components/ui/icons";

export default function ResultRow({
  result,
  rest,
  hasAdapter,
}: {
  result: TrackRef;
  rest: readonly TrackRef[];
  hasAdapter: boolean;
}) {
  const [artFailed, setArtFailed] = useState(false);
  const badge = SOURCE_BADGES[result.source] ?? { className: "mp3", label: result.source };
  const { playable, reason } = resultPlayability(result.source, hasAdapter);

  function handlePlay() {
    // Queue the tracks after this one, then start this track (R2 — instant play).
    playerStore.setQueue(rest);
    void playerStore.play(result);
  }

  const showArt = result.artUrl && !artFailed;

  return (
    <div className="sresult" data-testid="search-result" data-source={result.source}>
      <div className="sresult-art">
        {showArt ? (
          // eslint-disable-next-line @next/next/no-img-element -- external source CDN (i.ytimg.com / i.scdn.co); allowed by CSP img-src, next/image remote config is out of U6 scope
          <img
            src={result.artUrl ?? undefined}
            alt=""
            data-testid="result-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setArtFailed(true)}
          />
        ) : (
          <span className="sresult-art-fallback" aria-hidden="true">
            <MusicIcon size={20} />
          </span>
        )}
      </div>

      <div className="sresult-meta">
        <div className="sresult-title">{result.title}</div>
        <div className="sresult-sub">
          {result.artist ? <span className="sresult-artist">{result.artist}</span> : null}
          <span className={`badge ${badge.className}`}>{badge.label}</span>
        </div>
      </div>

      <div className="sresult-actions">
        {/* Add to a playlist (U10, R9). Works for any source — adding a Spotify or
            YouTube track to a playlist is real even before Spotify playback lands. */}
        <AddToPlaylist track={result} />

        <button
          type="button"
          className="icon-btn primary"
          data-testid="result-play"
          onClick={playable ? handlePlay : undefined}
          disabled={!playable}
          aria-disabled={!playable}
          title={playable ? `Play ${result.title}` : (reason ?? undefined)}
          aria-label={playable ? `Play ${result.title}` : `Play ${result.title} — ${reason}`}
        >
          <PlayIcon />
        </button>
      </div>
    </div>
  );
}
