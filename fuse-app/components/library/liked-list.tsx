"use client";

// Liked songs (U10, R8). Lists the tracks the signed-in user has liked — present on
// any device they sign into, because the list is read from their account server-side
// and handed here as initial data.
//
// Each row can Play (honest per source — see LibraryTrackRow), be added to a playlist
// (any source — R9), and be unliked. Unlike performs the real persisted write and
// removes the row only after the server confirms, so the list never lies about what
// is saved.

import { useState } from "react";
import type { LikedTrackDTO } from "@/lib/library/dto";
import { setTrackLikedAction } from "@/lib/library-actions";
import LibraryTrackRow from "@/components/library/track-row";
import AddToPlaylist from "@/components/library/add-to-playlist";
import { HeartIcon } from "@/components/ui/icons";
import WriteStatus, { useWriteStatus } from "@/components/ui/write-status";
import { couldNot } from "@/lib/ui/write-status";

export default function LikedList({ initial }: { initial: LikedTrackDTO[] }) {
  const [likes, setLikes] = useState<LikedTrackDTO[]>(initial);
  const [removing, setRemoving] = useState<string | null>(null);
  // AUDIT 19: leaving the row in place was honest, but saying nothing made the tap look
  // dead. The row still stays (it IS still liked) — now the reason is said out loud.
  const { message, report } = useWriteStatus();

  async function unlike(row: LikedTrackDTO) {
    if (removing) return;
    setRemoving(row.likeId);
    // The action resolves with nothing on success, so "it landed" is simply "it did not
    // throw" — the shared runner still turns a throw into an honest failure.
    await report(() => setTrackLikedAction(row, false), {
      succeeded: () => true,
      ok: `Removed ${row.title} from liked`,
      failed: couldNot("remove that song from liked"),
      onOk: () => setLikes((prev) => prev.filter((l) => l.likeId !== row.likeId)),
    });
    setRemoving(null);
  }

  if (likes.length === 0) {
    return (
      <>
        <WriteStatus message={message} className="write-status-block" testId="liked-status" />
        <p className="lib-empty">
          No liked songs yet. Tap the heart on a song and it will live here — on every
          device you sign into.
        </p>
      </>
    );
  }

  return (
    <>
      <WriteStatus message={message} className="write-status-block" testId="liked-status" />
      <ul className="lib-list" aria-label="Liked songs">
      {likes.map((row, i) => (
        <li key={row.likeId}>
          <LibraryTrackRow
            track={row}
            queue={likes.slice(i + 1)}
            actions={
              <>
                <AddToPlaylist track={row} />
                <button
                  type="button"
                  className="icon-btn liked"
                  onClick={() => void unlike(row)}
                  disabled={removing === row.likeId}
                  title={`Remove ${row.title} from liked`}
                  aria-label={`Remove ${row.title} from liked songs`}
                >
                  <HeartIcon filled />
                </button>
              </>
            }
          />
        </li>
      ))}
      </ul>
    </>
  );
}
