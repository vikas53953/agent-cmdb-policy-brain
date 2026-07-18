// Pure reorder helpers for the Library playlist UI (U10, R9 reorder).
//
// The playlist UI reorders tracks with move-up / move-down controls (honest and
// keyboard-operable — no drag-and-drop guesswork). The new order is then persisted
// through the playlists repo's reorderTracks. This module is the pure order math so
// it is unit-tested in node without a DOM, and the client never open-codes an
// off-by-one that would send a wrong order to the server.

// Move the item at `index` one slot in `direction`, returning a NEW array. Out-of-
// range moves (first item up, last item down, bad index) return the array unchanged
// so the caller can treat "no move happened" as "arrays are identical".
export function moveItem<T>(items: readonly T[], index: number, direction: "up" | "down"): T[] {
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= items.length) return [...items];
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// Whether the item at `index` can move in `direction` — drives the disabled state of
// the up/down buttons so the first row's Up and the last row's Down render disabled
// (R17: a control that cannot do anything is not shown as if it can).
export function canMove(length: number, index: number, direction: "up" | "down"): boolean {
  if (direction === "up") return index > 0;
  return index < length - 1;
}
