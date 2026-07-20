// Pure queue operations (Wave 1 — the visible, controllable queue).
//
// The player store holds the up-next queue as the single source of truth, but the
// ARRAY MATH for the queue actions users reach for everywhere — "play next", "add to
// queue", remove a row, drag to reorder — lives here as pure functions so it is
// unit-tested in node with no store and no DOM, and neither the store nor any row
// component open-codes an off-by-one that would drop or duplicate a track.
//
// Every function returns a NEW array and never mutates its input (the store swaps the
// reference so subscribers re-render). Out-of-range indices are treated as honest
// no-ops (the array is returned unchanged) rather than throwing, so a stale index from
// a fast double-tap can never crash playback.

import type { TrackRef } from "@/lib/repos/track";

// Stable identity for a queue track (same rule the rest of the app uses).
function sameTrack(a: TrackRef, b: TrackRef): boolean {
  return a.source === b.source && a.nativeId === b.nativeId;
}

// "Play next": put `track` at the FRONT of the queue so it plays immediately after the
// current one. If the exact track is already queued we move it (remove the old copy
// first) rather than leaving a duplicate — "play next" should mean one authoritative
// next slot, not silently pile up copies of the same song.
export function playNext(queue: readonly TrackRef[], track: TrackRef): TrackRef[] {
  return [track, ...queue.filter((t) => !sameTrack(t, track))];
}

// "Add to queue": append `track` to the END. Same de-dup discipline as playNext so a
// double-tap does not stack the same song twice — it stays where it already is unless
// it was not queued, in which case it lands last.
export function addToQueue(queue: readonly TrackRef[], track: TrackRef): TrackRef[] {
  if (queue.some((t) => sameTrack(t, track))) return [...queue];
  return [...queue, track];
}

// Remove the track at `index`. Out-of-range → unchanged (an honest no-op).
//
// GENERIC in the row type on purpose: the store now holds queue entries tagged with where
// they came from (user queue vs context list), not bare tracks. The index math is identical
// either way, so it stays in ONE tested place rather than being re-typed — or worse,
// re-implemented with a fresh off-by-one — inside the store.
export function removeAt<T>(queue: readonly T[], index: number): T[] {
  if (index < 0 || index >= queue.length) return [...queue];
  return queue.filter((_, i) => i !== index);
}

// Move the track at `from` to position `to` (arbitrary reorder — what a drag produces).
// Clamps `to` into range; a no-op move (from === to, or either index out of range)
// returns the list unchanged so the caller can treat "identical array" as "nothing
// moved" and skip a needless persist/re-render.
export function moveTrack<T>(queue: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= queue.length) return [...queue];
  const clampedTo = Math.max(0, Math.min(queue.length - 1, to));
  if (from === clampedTo) return [...queue];
  const next = [...queue];
  const [moved] = next.splice(from, 1);
  next.splice(clampedTo, 0, moved);
  return next;
}
