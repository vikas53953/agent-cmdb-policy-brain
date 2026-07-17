"use client";

// "Add to playlist" control (U10, R9 — playlists mix tracks from ANY source).
//
// This is the real entry point for putting a track into a playlist. It works for a
// YouTube OR a Spotify track (adding is not playing — a Spotify track can be
// organised into a playlist now even though its playback lands in U15), which is
// exactly how a playlist comes to "mix sources".
//
// It opens a small menu listing the user's playlists (loaded on first open via a
// server action) plus a "New playlist" inline field. Every choice performs a real,
// persisted write and shows an honest result — "Added", or a plain error if the
// write failed. No optimistic lie: the confirmation only shows after the server
// action resolves.

import { useId, useRef, useState } from "react";
import type { TrackRef } from "@/lib/repos/track";
import type { PlaylistDTO } from "@/lib/library/dto";
import {
  listPlaylistsAction,
  createPlaylistAction,
  addTrackToPlaylistAction,
} from "@/lib/library-actions";
import { PlusIcon } from "@/components/ui/icons";

type LoadState = "idle" | "loading" | "ready" | "error";

export default function AddToPlaylist({ track }: { track: TrackRef }) {
  const [open, setOpen] = useState(false);
  const [playlists, setPlaylists] = useState<PlaylistDTO[]>([]);
  const [load, setLoad] = useState<LoadState>("idle");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const menuId = useId();
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flash(msg: string) {
    setStatus(msg);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 2500);
  }

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && load === "idle") {
      setLoad("loading");
      try {
        setPlaylists(await listPlaylistsAction());
        setLoad("ready");
      } catch {
        setLoad("error");
      }
    }
  }

  async function addTo(playlist: PlaylistDTO) {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await addTrackToPlaylistAction(playlist.id, track);
      if (updated) {
        setPlaylists((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        flash(`Added to ${updated.name}`);
      } else {
        flash("Couldn't add — try again");
      }
    } catch {
      flash("Couldn't add — try again");
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  async function createAndAdd() {
    const name = newName.trim();
    if (busy || !name) return;
    setBusy(true);
    try {
      const created = await createPlaylistAction(name);
      const updated = await addTrackToPlaylistAction(created.id, track);
      setNewName("");
      flash(updated ? `Added to ${created.name}` : `Created ${created.name}`);
    } catch {
      flash("Couldn't create — try again");
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <div className="add-pl">
      <button
        type="button"
        className="icon-btn"
        onClick={toggleOpen}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={`Add ${track.title} to a playlist`}
        aria-label={`Add ${track.title} to a playlist`}
      >
        <PlusIcon />
      </button>

      {open ? (
        <div id={menuId} className="add-pl-menu" role="menu">
          {load === "loading" ? <p className="add-pl-note">Loading your playlists…</p> : null}
          {load === "error" ? (
            <p className="add-pl-note">Couldn&apos;t load playlists — close and try again.</p>
          ) : null}

          {load === "ready" && playlists.length === 0 ? (
            <p className="add-pl-note">No playlists yet — make one below.</p>
          ) : null}

          {load === "ready"
            ? playlists.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  className="add-pl-item"
                  onClick={() => void addTo(p)}
                  disabled={busy}
                >
                  {p.name}
                  <span className="add-pl-count">{p.tracks.length}</span>
                </button>
              ))
            : null}

          <div className="add-pl-new">
            <input
              type="text"
              className="add-pl-input"
              placeholder="New playlist name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              aria-label="New playlist name"
              onKeyDown={(e) => {
                if (e.key === "Enter") void createAndAdd();
              }}
            />
            <button
              type="button"
              className="add-pl-create"
              onClick={() => void createAndAdd()}
              disabled={busy || newName.trim() === ""}
              title={newName.trim() === "" ? "Type a name first" : "Create and add"}
            >
              Create
            </button>
          </div>
        </div>
      ) : null}

      {status ? (
        <span className="add-pl-status" role="status">
          {status}
        </span>
      ) : null}
    </div>
  );
}
