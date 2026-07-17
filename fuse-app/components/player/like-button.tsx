"use client";

// Like heart for Now Playing (U10, R8). The primary way a user likes the track they
// are listening to; liked tracks show up in Library on every device they sign into.
//
// HONESTY (R17): the heart reflects the TRUE saved state. When the current track
// changes it reads the real liked status from the server; toggling performs the real
// persisted write and only keeps the flipped state if the write succeeds (revert on
// failure). Until the status for the CURRENT track has loaded, the control is disabled
// so it can never show or claim a state that is not saved.
//
// The loaded status is stored WITH the track key it belongs to and compared against
// the current key in render (the searchbar's pattern), so a status that resolves after
// the track already changed is simply ignored — no ref writes during render, no
// synchronous setState inside the effect.

import { useEffect, useState } from "react";
import type { TrackRef } from "@/lib/repos/track";
import { isTrackLikedAction, setTrackLikedAction } from "@/lib/library-actions";
import { HeartIcon } from "@/components/ui/icons";

// The liked status for one specific track key. `key` lets render tell whether this
// status is for the track currently showing.
type LikeStatus = { key: string; liked: boolean };

export default function LikeButton({ track }: { track: TrackRef }) {
  const [status, setStatus] = useState<LikeStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const key = `${track.source}:${track.nativeId}`;

  useEffect(() => {
    let alive = true;
    isTrackLikedAction({ source: track.source, nativeId: track.nativeId })
      .then((liked) => {
        if (alive) setStatus({ key, liked });
      })
      .catch(() => {
        // Status unknown (e.g. no DB) — treat as not-liked but still allow toggling;
        // a failed toggle simply reverts, so the control never lies.
        if (alive) setStatus({ key, liked: false });
      });
    return () => {
      alive = false;
    };
  }, [key, track.source, track.nativeId]);

  // Is the loaded status for the track currently showing?
  const known = status?.key === key;
  const isLiked = known && status.liked;

  async function toggle() {
    if (saving || !known) return;
    const next = !status.liked;
    setSaving(true);
    setStatus({ key, liked: next }); // optimistic
    try {
      await setTrackLikedAction(track, next);
    } catch {
      setStatus({ key, liked: !next }); // revert — the write did not stick
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      className={isLiked ? "icon-btn liked on" : "icon-btn liked"}
      onClick={() => void toggle()}
      disabled={!known || saving}
      aria-pressed={isLiked}
      title={!known ? "Checking…" : isLiked ? "Remove from liked" : "Add to liked"}
      aria-label={
        !known
          ? `Checking whether ${track.title} is liked`
          : isLiked
            ? `Remove ${track.title} from liked songs`
            : `Add ${track.title} to liked songs`
      }
    >
      <HeartIcon filled={isLiked} />
    </button>
  );
}
