// Per-user playlists repository (R9). Playlists mix tracks from any source.
// Every function is scoped to a `userId`:
//   - reads filter `where: { ownerId: userId }` (or `{ id, ownerId }`);
//   - create sets `ownerId: userId`;
//   - rename/reorder/delete use updateMany/deleteMany keyed on `{ id, ownerId }`,
//     so a playlist owned by someone else affects ZERO rows (BOLA-safe) instead of
//     leaking or mutating.
//
// PlaylistTrack tenancy is enforced transitively: a track is only reachable by
// first resolving a playlist the caller owns. Every mutation that touches tracks
// re-checks ownership of the parent playlist before writing.

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toTrackColumns } from "./track";

// A track to add to a playlist. Same source-agnostic identity as everywhere else.
export type PlaylistTrackInput = {
  source: string;
  nativeId: string;
  title: string;
  artist?: string | null;
  artUrl?: string | null;
  durationSec?: number | null;
};

const withTracks = {
  include: { tracks: { orderBy: { position: "asc" as const } } },
} as const;

// List the caller's playlists (newest first), each with its ordered tracks.
export function listPlaylists(userId: string, db: PrismaClient = prisma) {
  return db.playlist.findMany({
    where: { ownerId: userId },
    ...withTracks,
    orderBy: { createdAt: "desc" },
  });
}

// Get one playlist the caller owns, with ordered tracks — or null when the id is
// unknown OR owned by another user (both look identical to the caller).
export function getPlaylist(userId: string, id: string, db: PrismaClient = prisma) {
  return db.playlist.findFirst({ where: { id, ownerId: userId }, ...withTracks });
}

// Create an empty playlist owned by the caller.
export function createPlaylist(userId: string, name: string, db: PrismaClient = prisma) {
  return db.playlist.create({ data: { ownerId: userId, name }, ...withTracks });
}

// Rename a playlist the caller owns. updateMany keyed on { id, ownerId } — a foreign
// playlist matches zero rows. Returns the updated playlist, or null when nothing matched.
export async function renamePlaylist(
  userId: string,
  id: string,
  name: string,
  db: PrismaClient = prisma,
) {
  const res = await db.playlist.updateMany({ where: { id, ownerId: userId }, data: { name } });
  if (res.count === 0) return null;
  return getPlaylist(userId, id, db);
}

// Delete a playlist the caller owns. deleteMany keyed on { id, ownerId }; cascade
// removes its PlaylistTrack rows. Returns rows removed (0 when unknown/foreign).
export async function deletePlaylist(userId: string, id: string, db: PrismaClient = prisma): Promise<number> {
  const res = await db.playlist.deleteMany({ where: { id, ownerId: userId } });
  return res.count;
}

// Append a track to the end of a playlist the caller owns. Ownership is re-checked
// first (findFirst keyed on { id, ownerId }); a foreign playlist returns null and
// writes nothing. Position is the current track count (0-based append).
export async function addTrack(
  userId: string,
  playlistId: string,
  track: PlaylistTrackInput,
  db: PrismaClient = prisma,
) {
  const owned = await db.playlist.findFirst({ where: { id: playlistId, ownerId: userId }, select: { id: true } });
  if (!owned) return null;
  const count = await db.playlistTrack.count({ where: { playlistId } });
  const cols = toTrackColumns(track);
  return db.playlistTrack.create({ data: { playlistId, position: count, ...cols } });
}

// Remove a track from a playlist the caller owns, then re-pack positions so the
// order stays gap-free. Ownership re-checked first. Returns the number removed.
export async function removeTrack(
  userId: string,
  playlistId: string,
  playlistTrackId: string,
  db: PrismaClient = prisma,
): Promise<number> {
  const owned = await db.playlist.findFirst({ where: { id: playlistId, ownerId: userId }, select: { id: true } });
  if (!owned) return 0;
  return db.$transaction(async (tx) => {
    const res = await tx.playlistTrack.deleteMany({ where: { id: playlistTrackId, playlistId } });
    if (res.count === 0) return 0;
    // Re-pack remaining positions to 0..n-1 in current order.
    const remaining = await tx.playlistTrack.findMany({
      where: { playlistId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    for (let i = 0; i < remaining.length; i++) {
      await tx.playlistTrack.update({ where: { id: remaining[i].id }, data: { position: i } });
    }
    return res.count;
  });
}

// Persist a new track order for a playlist the caller owns (R9 reorder). Ownership
// re-checked first. `orderedTrackIds` must be the playlist's own PlaylistTrack ids;
// only ids that belong to the playlist are repositioned, so a foreign or bogus id is
// ignored rather than trusted. Returns the reloaded playlist, or null if not owned.
export async function reorderTracks(
  userId: string,
  playlistId: string,
  orderedTrackIds: string[],
  db: PrismaClient = prisma,
) {
  const owned = await db.playlist.findFirst({ where: { id: playlistId, ownerId: userId }, select: { id: true } });
  if (!owned) return null;
  await db.$transaction(async (tx) => {
    const existing = await tx.playlistTrack.findMany({ where: { playlistId }, select: { id: true } });
    const belongs = new Set(existing.map((t) => t.id));
    let position = 0;
    for (const id of orderedTrackIds) {
      if (!belongs.has(id)) continue; // never reposition a track from another playlist
      await tx.playlistTrack.update({ where: { id }, data: { position } });
      position++;
    }
  });
  return getPlaylist(userId, playlistId, db);
}
