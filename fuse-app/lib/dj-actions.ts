"use server";

// Server actions for the DJ console — hot-cue persistence (DJ-1).
//
// One server module so the DJ deck (a client component) can save and load hot cues by
// reference without pulling the auth/db runtime into the client bundle. EVERY action
// begins with requireUser(), so the write is scoped to the caller's own rows (the repo
// enforces ownerId tenancy — these actions never trust an ownerId from the client).
//
// HONESTY / DEGRADE-SAFE: in a keyless / no-DATABASE_URL environment the repo call would
// throw; each action swallows that and returns an empty/false result so the deck still
// works in-session (cues just don't persist), never surfacing a crash to the DJ. The DJ
// page is auth-gated by the proxy, so requireUser resolves a real user in production.
//
// The track a cue is keyed by is (source, nativeId). For a LOCAL file the client passes
// a content fingerprint as nativeId (lib/dj/fingerprint.ts) — the file's bytes never
// leave the device (R14); only the derived id and the cue position (seconds) are stored.

import { requireUser } from "@/lib/auth-session";
import { isTrackSource, type TrackSource } from "@/lib/repos/track";
import { listCues, setCue, deleteCue, isValidSlot } from "@/lib/repos/dj-cues";

export type CueDTO = { slot: number; positionSec: number };

type CueTrackInput = { source: string; nativeId: string };

function normalizeTrack(track: CueTrackInput): { source: TrackSource; nativeId: string } | null {
  if (!isTrackSource(track.source)) return null;
  if (typeof track.nativeId !== "string" || track.nativeId === "") return null;
  return { source: track.source, nativeId: track.nativeId };
}

// The caller's saved cues for one track, as plain { slot, positionSec } rows. Empty on a
// signed-out / keyless run rather than an error.
export async function listCuesAction(track: CueTrackInput): Promise<CueDTO[]> {
  const t = normalizeTrack(track);
  if (!t) return [];
  try {
    const user = await requireUser();
    const rows = await listCues(user.id, t);
    return rows.map((r) => ({ slot: r.slot, positionSec: r.positionSec }));
  } catch {
    return [];
  }
}

// Set (or move) a hot cue on a pad, returning the saved cue so the client reconciles its
// optimistic state. Returns null on an invalid slot or a failed persist.
export async function setCueAction(
  track: CueTrackInput,
  slot: number,
  positionSec: number,
): Promise<CueDTO | null> {
  const t = normalizeTrack(track);
  if (!t || !isValidSlot(slot)) return null;
  try {
    const user = await requireUser();
    const row = await setCue(user.id, t, slot, positionSec);
    return { slot: row.slot, positionSec: row.positionSec };
  } catch {
    return null;
  }
}

// Clear a hot cue from a pad. Returns true only when a row was actually removed.
export async function deleteCueAction(track: CueTrackInput, slot: number): Promise<boolean> {
  const t = normalizeTrack(track);
  if (!t || !isValidSlot(slot)) return false;
  try {
    const user = await requireUser();
    const removed = await deleteCue(user.id, t, slot);
    return removed > 0;
  } catch {
    return false;
  }
}
