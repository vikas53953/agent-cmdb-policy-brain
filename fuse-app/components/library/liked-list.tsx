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

export default function LikedList({ initial }: { initial: LikedTrackDTO[] }) {
  const [likes, setLikes] = useState<LikedTrackDTO[]>(initial);
  const [removing, setRemoving] = useState<string | null>(null);

  async function unlike(row: LikedTrackDTO) {
    if (removing) return;
    setRemoving(row.likeId);
    try {
      await setTrackLikedAction(row, false);
      setLikes((prev) => prev.filter((l) => l.likeId !== row.likeId));
    } catch {
      // Leave the row in place on failure — honest: it is still liked.
    } finally {
      setRemoving(null);
    }
  }

  if (likes.length === 0) {
    return (
      <p className="lib-empty">
        No liked songs yet. Tap the heart on a song and it will live here — on every
        device you sign into.
      </p>
    );
  }

  return (
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
  );
}
