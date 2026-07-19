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
import WriteStatus, { useWriteStatus } from "@/components/ui/write-status";
import { couldNot } from "@/lib/ui/write-status";

// The liked status for one specific track key. `key` lets render tell whether this
// status is for the track currently showing.
//
// AUDIT 26: `liked` was a plain boolean, and a FAILED status check was recorded as
// `false`. That is the exact lie this app forbids: an already-liked song showed an
// empty heart, and the user's next tap issued an UNLIKE-shaped write against a like
// they never made. `null` is the third, honest answer — "we don't know yet".
type LikeStatus = { key: string; liked: boolean | null };

export default function LikeButton({ track }: { track: TrackRef }) {
  const [status, setStatus] = useState<LikeStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const { message, report } = useWriteStatus();
  const key = `${track.source}:${track.nativeId}`;

  useEffect(() => {
    let alive = true;
    isTrackLikedAction({ source: track.source, nativeId: track.nativeId })
      .then((liked) => {
        if (alive) setStatus({ key, liked });
      })
      .catch(() => {
        // We could not find out. Say so and stay out of the way, rather than guessing
        // "not liked" and letting the next tap write the wrong thing.
        if (alive) setStatus({ key, liked: null });
      });
    return () => {
      alive = false;
    };
  }, [key, track.source, track.nativeId]);

  // Is the loaded status for the track currently showing, and did it actually answer?
  const forThisTrack = status?.key === key;
  const known = forThisTrack && status.liked !== null;
  const unknown = forThisTrack && status.liked === null;
  const isLiked = known && status.liked === true;

  async function toggle() {
    if (saving || !known) return;
    const next = !status.liked;
    setSaving(true);
    setStatus({ key, liked: next }); // optimistic
    // AUDIT 27: a failed toggle used to revert with no word — the heart flicked and
    // sprang back like a bug. It still reverts (that IS the saved truth) and now says why.
    await report(() => setTrackLikedAction(track, next), {
      succeeded: () => true, // resolves with nothing; a throw is the only failure
      ok: next ? "Added to liked" : "Removed from liked",
      failed: couldNot(next ? "add this to liked" : "remove this from liked"),
      onFail: () => setStatus({ key, liked: !next }),
    });
    setSaving(false);
  }

  const label = unknown
    ? `Couldn't check whether ${track.title} is liked`
    : !known
      ? `Checking whether ${track.title} is liked`
      : isLiked
        ? `Remove ${track.title} from liked songs`
        : `Add ${track.title} to liked songs`;

  return (
    <>
      <button
        type="button"
        className={isLiked ? "icon-btn liked on" : "icon-btn liked"}
        data-testid="like-button"
        data-liked={isLiked ? "true" : "false"}
        data-like-known={unknown ? "unknown" : known ? "yes" : "checking"}
        onClick={() => void toggle()}
        disabled={!known || saving}
        aria-pressed={known ? isLiked : undefined}
        title={
          unknown
            ? "Couldn't check if this is liked — reopen this screen to try again"
            : !known
              ? "Checking…"
              : isLiked
                ? "Remove from liked"
                : "Add to liked"
        }
        aria-label={label}
      >
        <HeartIcon filled={isLiked} />
      </button>
      <WriteStatus message={message} testId="like-status" />
    </>
  );
}
