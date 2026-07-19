"use client";

// Playlists (U10, R9). Create, rename, reorder, delete — all real, persisted writes;
// each playlist can mix tracks from any source. Adding tracks happens from Search or
// the Liked list (the "add to playlist" control); this pane owns everything else.
//
// Reorder uses move-up / move-down controls (honest, keyboard-operable) backed by the
// pure moveItem/canMove helpers, then persists the new order. Every mutation reconciles
// against the server's returned playlist, so the UI reflects saved truth, and a failed
// write reverts rather than showing a change that did not stick (R17).

import { useState } from "react";
import type { PlaylistDTO, PlaylistTrackDTO } from "@/lib/library/dto";
import { moveItem, canMove } from "@/lib/library/reorder";
import {
  createPlaylistAction,
  renamePlaylistAction,
  deletePlaylistAction,
  removeTrackFromPlaylistAction,
  reorderPlaylistTracksAction,
} from "@/lib/library-actions";
import LibraryTrackRow from "@/components/library/track-row";
import {
  PlusIcon,
  TrashIcon,
  PencilIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ChevronDownIcon,
} from "@/components/ui/icons";
import WriteStatus, { useWriteStatus } from "@/components/ui/write-status";
import { couldNot } from "@/lib/ui/write-status";

export default function PlaylistsPane({ initial }: { initial: PlaylistDTO[] }) {
  const [playlists, setPlaylists] = useState<PlaylistDTO[]>(initial);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  // AUDIT 14: creating a playlist used to fail into an empty catch — the core save path
  // gave the user nothing at all. Every write in this pane now reports through the one
  // shared status (lib/ui/write-status.ts).
  const { message, report } = useWriteStatus();

  async function create() {
    const name = newName.trim();
    if (creating || !name) return;
    setCreating(true);
    await report(() => createPlaylistAction(name), {
      ok: (created) => `Created ${created.name}`,
      failed: couldNot("create the playlist"),
      onOk: (created) => {
        setPlaylists((prev) => [created, ...prev]);
        setNewName("");
      },
    });
    setCreating(false);
  }

  function replace(updated: PlaylistDTO) {
    setPlaylists((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  function drop(id: string) {
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="pl-pane">
      <div className="pl-create">
        <input
          type="text"
          className="pl-create-input"
          data-testid="playlist-name"
          placeholder="New playlist name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          aria-label="New playlist name"
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
        />
        <button
          type="button"
          className="pl-create-btn"
          data-testid="playlist-create"
          onClick={() => void create()}
          disabled={creating || newName.trim() === ""}
          title={newName.trim() === "" ? "Type a name first" : "Create playlist"}
          aria-label="Create playlist"
        >
          <PlusIcon size={18} />
          <span>Create</span>
        </button>
      </div>

      <WriteStatus message={message} className="write-status-block" testId="playlists-status" />

      {playlists.length === 0 ? (
        <p className="lib-empty">
          No playlists yet. Name one above, then add songs from Search or your liked
          list — mix YouTube and Spotify freely.
        </p>
      ) : (
        <ul className="pl-list" aria-label="Your playlists" data-testid="playlist-list">
          {playlists.map((p) => (
            <li key={p.id}>
              <PlaylistCard playlist={p} onReplace={replace} onDelete={drop} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlaylistCard({
  playlist,
  onReplace,
  onDelete,
}: {
  playlist: PlaylistDTO;
  onReplace: (p: PlaylistDTO) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(playlist.name);
  const [busy, setBusy] = useState(false);
  // AUDIT 15/16/17/18: delete, remove-track, rename and reorder all used to fail
  // silently — the row stayed, the name snapped back, the order jumped back, and the
  // user was told nothing. Each now reports through the one shared status.
  const { message, report } = useWriteStatus();

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === playlist.name) {
      setEditing(false);
      setName(playlist.name);
      return;
    }
    setBusy(true);
    await report(() => renamePlaylistAction(playlist.id, trimmed), {
      ok: (updated) => `Renamed to ${updated.name}`,
      failed: couldNot("save the new name"),
      onOk: (updated) => onReplace(updated),
      onFail: () => setName(playlist.name), // put the old name back — it is what is saved
    });
    setBusy(false);
    setEditing(false);
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    await report(() => deletePlaylistAction(playlist.id), {
      ok: `Deleted ${playlist.name}`,
      failed: couldNot("delete this playlist"),
      onOk: () => onDelete(playlist.id),
    });
    setBusy(false);
  }

  async function reorder(index: number, direction: "up" | "down") {
    if (busy || !canMove(playlist.tracks.length, index, direction)) return;
    const reordered = moveItem(playlist.tracks, index, direction);
    // Optimistic: show the new order immediately, then persist and reconcile.
    const optimistic: PlaylistDTO = { ...playlist, tracks: reordered };
    onReplace(optimistic);
    setBusy(true);
    await report(
      () => reorderPlaylistTracksAction(playlist.id, reordered.map((t) => t.itemId)),
      {
        ok: "New order saved",
        failed: couldNot("save the new order"),
        onOk: (updated) => onReplace(updated),
        onFail: () => onReplace(playlist), // back to the last order that is actually saved
      },
    );
    setBusy(false);
  }

  async function removeTrack(item: PlaylistTrackDTO) {
    if (busy) return;
    setBusy(true);
    await report(() => removeTrackFromPlaylistAction(playlist.id, item.itemId), {
      ok: `Removed ${item.title}`,
      failed: couldNot("remove that song"),
      onOk: (updated) => onReplace(updated),
    });
    setBusy(false);
  }

  const count = playlist.tracks.length;

  return (
    <div className="pl-card" data-testid="playlist-card" data-playlist-name={playlist.name} data-track-count={count}>
      <div className="pl-card-head">
        <button
          type="button"
          className={open ? "pl-expand open" : "pl-expand"}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? `Collapse ${playlist.name}` : `Expand ${playlist.name}`}
        >
          <ChevronDownIcon size={18} />
        </button>

        {editing ? (
          <input
            type="text"
            className="pl-name-input"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void saveName()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName();
              if (e.key === "Escape") {
                setName(playlist.name);
                setEditing(false);
              }
            }}
            aria-label={`Rename ${playlist.name}`}
            disabled={busy}
          />
        ) : (
          <button type="button" className="pl-name" data-testid="playlist-open" onClick={() => setOpen((v) => !v)}>
            <span className="pl-name-text">{playlist.name}</span>
            <span className="pl-name-count" data-testid="playlist-count">
              {count} {count === 1 ? "song" : "songs"}
            </span>
          </button>
        )}

        <button
          type="button"
          className="icon-btn"
          onClick={() => setEditing(true)}
          disabled={busy || editing}
          title={`Rename ${playlist.name}`}
          aria-label={`Rename ${playlist.name}`}
        >
          <PencilIcon size={18} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => void remove()}
          disabled={busy}
          title={`Delete ${playlist.name}`}
          aria-label={`Delete ${playlist.name}`}
        >
          <TrashIcon size={18} />
        </button>
      </div>

      <WriteStatus message={message} className="write-status-block" testId="playlist-card-status" />

      {open ? (
        count === 0 ? (
          <p className="pl-empty">
            Empty for now. Add songs from Search or your liked list.
          </p>
        ) : (
          <ul className="pl-tracks" aria-label={`Songs in ${playlist.name}`}>
            {playlist.tracks.map((t, i) => (
              <li key={t.itemId}>
                <LibraryTrackRow
                  track={t}
                  queue={playlist.tracks.slice(i + 1)}
                  actions={
                    <>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => void reorder(i, "up")}
                        disabled={busy || !canMove(count, i, "up")}
                        title="Move up"
                        aria-label={`Move ${t.title} up`}
                      >
                        <ArrowUpIcon size={18} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => void reorder(i, "down")}
                        disabled={busy || !canMove(count, i, "down")}
                        title="Move down"
                        aria-label={`Move ${t.title} down`}
                      >
                        <ArrowDownIcon size={18} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => void removeTrack(t)}
                        disabled={busy}
                        title={`Remove ${t.title}`}
                        aria-label={`Remove ${t.title} from ${playlist.name}`}
                      >
                        <TrashIcon size={18} />
                      </button>
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
