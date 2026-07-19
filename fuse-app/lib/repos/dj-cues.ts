// Per-user DJ hot-cue repository (DJ-1). Like every repo in this layer, every function
// is scoped to a `userId`:
//   - reads filter `where: { ownerId: userId, ... }`, so another user's cues — or a row
//     that isn't the caller's — can NEVER be returned;
//   - the write sets `ownerId: userId`;
//   - clearing a cue uses deleteMany keyed on { ownerId, source, nativeId, slot }, so a
//     foreign cue affects zero rows instead of being removed.
//
// A cue is unique per (owner, source, nativeId, slot), so setting a pad twice is an
// idempotent upsert (it moves the pad, never duplicates it). The DJ server actions
// (lib/dj-actions.ts) are the only callers; the client never sees an ownerId.

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { TrackRef } from "./track";

// The DJ-1 pad count. Slots are 0-based (0..MAX_CUE_SLOTS-1). DJ-2 grows this to 8; the
// repo already accepts any non-negative slot, so that change needs no migration here.
export const MAX_CUE_SLOTS = 4;

export type CueTrack = Pick<TrackRef, "source" | "nativeId">;

export function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < MAX_CUE_SLOTS;
}

// List the caller's cues for one track, in slot order. Scoped to ownerId + the track's
// identity — a cross-tenant read (user B asking for user A's cues) returns an empty list.
export function listCues(
  userId: string,
  track: CueTrack,
  db: PrismaClient = prisma,
) {
  return db.djCue.findMany({
    where: { ownerId: userId, source: track.source, nativeId: track.nativeId },
    orderBy: { slot: "asc" },
  });
}

// Set (or move) a hot cue on a pad. Idempotent via upsert on the composite key, so
// re-setting the same pad updates its position rather than erroring or duplicating.
export function setCue(
  userId: string,
  track: CueTrack,
  slot: number,
  positionSec: number,
  db: PrismaClient = prisma,
) {
  const pos = Number.isFinite(positionSec) && positionSec > 0 ? positionSec : 0;
  return db.djCue.upsert({
    where: {
      ownerId_source_nativeId_slot: {
        ownerId: userId,
        source: track.source,
        nativeId: track.nativeId,
        slot,
      },
    },
    create: {
      ownerId: userId,
      source: track.source,
      nativeId: track.nativeId,
      slot,
      positionSec: pos,
    },
    update: { positionSec: pos },
  });
}

// Clear a hot cue from a pad. Keyed on { ownerId, source, nativeId, slot } via
// deleteMany, so a cue owned by another user affects zero rows. Returns the number
// removed (0 or 1).
export async function deleteCue(
  userId: string,
  track: CueTrack,
  slot: number,
  db: PrismaClient = prisma,
): Promise<number> {
  const res = await db.djCue.deleteMany({
    where: { ownerId: userId, source: track.source, nativeId: track.nativeId, slot },
  });
  return res.count;
}
