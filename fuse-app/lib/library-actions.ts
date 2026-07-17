"use server";

// Server actions for Library — likes and playlists (U10, R8/R9).
//
// One server module so client components (the Library screen, the Now Playing like
// heart, the search "add to playlist" menu) can call these by reference without
// pulling the auth/db runtime into the client bundle. EVERY action begins with
// requireUser(), so:
//   - the write is scoped to the caller's own rows (the repos enforce ownerId /
//     { id, ownerId } tenancy — these actions never trust an ownerId from the client);
//   - in a keyless / no-DATABASE_URL environment these are simply never reachable
//     (there is no session to satisfy requireUser), and they are never invoked at
//     build time, so a keyless build is unaffected.
//
// Actions RETURN the updated shape (a DTO or a boolean) so the client can reconcile
// its optimistic state against server truth, and revalidatePath("/library") keeps a
// fresh navigation to Library correct.

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth-session";
import type { TrackRef } from "@/lib/repos/track";
import { like, unlike, isLiked } from "@/lib/repos/likes";
import {
  listPlaylists,
  createPlaylist,
  renamePlaylist,
  deletePlaylist,
  addTrack,
  removeTrack,
  reorderTracks,
  getPlaylist,
} from "@/lib/repos/playlists";
import { toPlaylistDTO, type PlaylistDTO } from "@/lib/library/dto";

// --- Likes (R8) ---------------------------------------------------------------

// Whether the signed-in user has liked a track. A read the Now Playing heart calls
// when the current track changes so the control reflects true state, never a guess.
export async function isTrackLikedAction(
  track: Pick<TrackRef, "source" | "nativeId">,
): Promise<boolean> {
  const user = await requireUser();
  return isLiked(user.id, track);
}

// Like or unlike a track, returning the resulting liked state so the client's heart
// reflects exactly what was persisted. The caller passes `liked` = the state it wants.
export async function setTrackLikedAction(track: TrackRef, liked: boolean): Promise<boolean> {
  const user = await requireUser();
  if (liked) {
    await like(user.id, track);
  } else {
    await unlike(user.id, { source: track.source, nativeId: track.nativeId });
  }
  revalidatePath("/library");
  return liked;
}

// --- Playlists (R9) -----------------------------------------------------------

// The caller's playlists (with ordered tracks) as DTOs. Used by the search
// "add to playlist" menu to list where a track can go.
export async function listPlaylistsAction(): Promise<PlaylistDTO[]> {
  const user = await requireUser();
  const rows = await listPlaylists(user.id);
  return rows.map(toPlaylistDTO);
}

export async function createPlaylistAction(name: string): Promise<PlaylistDTO> {
  const user = await requireUser();
  const trimmed = name.trim() || "New playlist";
  const row = await createPlaylist(user.id, trimmed);
  revalidatePath("/library");
  return toPlaylistDTO(row);
}

// Rename a playlist the caller owns. Returns the updated playlist, or null when the
// id is unknown or owned by someone else (the repo affects zero rows — BOLA-safe).
export async function renamePlaylistAction(id: string, name: string): Promise<PlaylistDTO | null> {
  const user = await requireUser();
  const trimmed = name.trim();
  if (!trimmed) return null; // never persist an empty name
  const row = await renamePlaylist(user.id, id, trimmed);
  revalidatePath("/library");
  return row ? toPlaylistDTO(row) : null;
}

// Delete a playlist the caller owns. Returns true only when a row was actually removed.
export async function deletePlaylistAction(id: string): Promise<boolean> {
  const user = await requireUser();
  const removed = await deletePlaylist(user.id, id);
  revalidatePath("/library");
  return removed > 0;
}

// Add a track (from any source — R9) to a playlist the caller owns. Returns the
// reloaded playlist, or null when the caller does not own it.
export async function addTrackToPlaylistAction(
  playlistId: string,
  track: TrackRef,
): Promise<PlaylistDTO | null> {
  const user = await requireUser();
  const added = await addTrack(user.id, playlistId, track);
  if (!added) return null;
  const row = await getPlaylist(user.id, playlistId);
  revalidatePath("/library");
  return row ? toPlaylistDTO(row) : null;
}

// Remove one track entry from a playlist the caller owns; positions re-pack in the
// repo. Returns the reloaded playlist, or null when not owned / nothing removed.
export async function removeTrackFromPlaylistAction(
  playlistId: string,
  itemId: string,
): Promise<PlaylistDTO | null> {
  const user = await requireUser();
  const removed = await removeTrack(user.id, playlistId, itemId);
  if (removed === 0) return null;
  const row = await getPlaylist(user.id, playlistId);
  revalidatePath("/library");
  return row ? toPlaylistDTO(row) : null;
}

// Persist a new track order for a playlist the caller owns. `orderedItemIds` are the
// playlist's own PlaylistTrack ids in the desired order; the repo ignores any id that
// is not part of this playlist. Returns the reloaded playlist, or null when not owned.
export async function reorderPlaylistTracksAction(
  playlistId: string,
  orderedItemIds: string[],
): Promise<PlaylistDTO | null> {
  const user = await requireUser();
  const row = await reorderTracks(user.id, playlistId, orderedItemIds);
  revalidatePath("/library");
  return row ? toPlaylistDTO(row) : null;
}
