// Per-user liked-tracks repository (R8). Every function is scoped to a `userId`:
//   - reads filter `where: { ownerId: userId }`, so another user's like — or a
//     row that isn't the caller's — can NEVER be returned;
//   - the write sets `ownerId: userId`;
//   - unlike uses deleteMany keyed on `{ ownerId, source, nativeId }`, so a
//     foreign like affects zero rows instead of being removed.
//
// Route handlers and server components must go through this layer rather than
// calling `prisma.like` directly for owned data (the tenancy boundary).
//
// Track identity is stored source-agnostically (see lib/repos/track.ts); a like is
// unique per (owner, source, nativeId), so liking twice is idempotent.

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toTrackColumns, type TrackRef } from "./track";

// List the caller's likes, newest first. Scoped to ownerId — a cross-tenant read
// (user B asking for likes after only user A liked something) returns an empty list.
export function listLikes(userId: string, db: PrismaClient = prisma) {
  return db.like.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: "desc" },
  });
}

// Whether the caller has liked a specific track. Scoped to ownerId.
export async function isLiked(
  userId: string,
  track: Pick<TrackRef, "source" | "nativeId">,
  db: PrismaClient = prisma,
): Promise<boolean> {
  const row = await db.like.findFirst({
    where: { ownerId: userId, source: track.source, nativeId: track.nativeId },
    select: { id: true },
  });
  return row !== null;
}

// Like a track (idempotent). Uses upsert on the (owner, source, nativeId) unique key
// so re-liking refreshes the display fields rather than erroring or duplicating.
export function like(
  userId: string,
  track: {
    source: string;
    nativeId: string;
    title: string;
    artist?: string | null;
    artUrl?: string | null;
    durationSec?: number | null;
  },
  db: PrismaClient = prisma,
) {
  const cols = toTrackColumns(track);
  return db.like.upsert({
    where: {
      ownerId_source_nativeId: {
        ownerId: userId,
        source: cols.source,
        nativeId: cols.nativeId,
      },
    },
    create: { ownerId: userId, ...cols },
    update: { title: cols.title, artist: cols.artist, artUrl: cols.artUrl, durationSec: cols.durationSec },
  });
}

// Unlike a track. Keyed on { ownerId, source, nativeId } via deleteMany, so a like
// owned by another user affects zero rows. Returns the number removed (0 or 1).
export async function unlike(
  userId: string,
  track: Pick<TrackRef, "source" | "nativeId">,
  db: PrismaClient = prisma,
): Promise<number> {
  const res = await db.like.deleteMany({
    where: { ownerId: userId, source: track.source, nativeId: track.nativeId },
  });
  return res.count;
}
