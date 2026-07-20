// Navigation-pending store (F-5).
//
// THE BUG: tapping a bottom tab left the PREVIOUS screen on display, looking current,
// until the new route's server payload arrived. Every tab route is `force-dynamic`, so
// every tap is a real server round-trip; React keeps the outgoing tree visible for the
// whole of it (a router navigation is a transition, and a transition deliberately does
// NOT blank the screen). The `loading.tsx` boundary only takes over once the router has
// something to commit — so on a phone, on mobile data, the old screen can sit there for
// most of a second reading as "your tap did nothing".
//
// THE HONEST FIX is not to hide the old screen behind a spinner — that trades one lie
// ("this is the current screen") for another ("we have nothing to show you"). It is to
// SAY a move is under way: the tapped tab lights up the instant it is tapped, and the
// outgoing screen visibly steps back so it can never be mistaken for the new one.
//
// This module is the small shared truth behind that. Links report their own pending
// state in (Next's `useLinkStatus` gives it per-link, with no round-trip), and the app
// shell reads ONE boolean out: is any navigation in flight? Keeping it here — framework-
// free and pure — means it is unit-testable without a DOM, and any future link or route
// gets the same treatment by reporting in, rather than by re-solving this per screen.

type Listener = () => void;

// Which link keys are currently pending. A set, not a counter: a link that reports
// "pending" twice (re-render, StrictMode double-invoke) must not leave the shell stuck
// on, and a link that unmounts mid-navigation must be able to remove exactly itself.
const pendingKeys = new Set<string>();
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

// Is any navigation currently in flight?
export function isNavPending(): boolean {
  return pendingKeys.size > 0;
}

// Report one link's pending state. Idempotent in both directions, so a component can
// call this on every render with its current status and the store stays correct.
export function setNavPending(key: string, pending: boolean): void {
  const had = pendingKeys.has(key);
  if (pending === had) return; // no change — do not wake subscribers
  if (pending) pendingKeys.add(key);
  else pendingKeys.delete(key);
  emit();
}

// Subscribe to changes. Returns an unsubscribe function, matching the shape the rest of
// the app's small stores use (and `useSyncExternalStore`).
export function subscribeNavPending(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Test-only reset so one spec's leftover pending link cannot leak into the next.
export function resetNavPending(): void {
  pendingKeys.clear();
  listeners.clear();
}
