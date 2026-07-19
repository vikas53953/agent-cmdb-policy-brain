// Recent searches (Wave 1 — search extras).
//
// Remembers the last few queries a person searched so Search can offer them as tappable
// chips and a clear button. PER-USER on a shared browser: every entry is namespaced by
// a user key (the signed-in user's id, or "anon"), so switching accounts never leaks one
// person's history to another. Persisted in localStorage (survives across tab sessions,
// unlike the sessionStorage used for the ephemeral player snapshot) — recent searches are
// a convenience that should still be there tomorrow.
//
// Pure over an INJECTED storage so it is unit-tested in node with a fake Map-backed store
// and never throws in a locked-down/private browser (a blocked store degrades to "no
// history" rather than breaking Search). The list is capped, de-duplicated (a repeated
// search moves to the top), and trimmed.

// The smallest slice of the Web Storage API we use, so tests pass a fake and the module
// never hard-depends on a real `localStorage`.
export type SimpleStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

// How many recent queries to keep. Small on purpose — this is a shortcut, not a log.
export const RECENT_SEARCH_MAX = 8;

const KEY_PREFIX = "fuse:recent-searches:v1:";

function keyFor(userKey: string): string {
  return `${KEY_PREFIX}${userKey || "anon"}`;
}

// The real browser localStorage, or null when it is unavailable (SSR, private mode).
export function browserStorage(): SimpleStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

// Read the user's recent queries, newest first. A missing/corrupt entry reads as [].
export function loadRecentSearches(store: SimpleStorage | null, userKey: string): string[] {
  if (!store) return [];
  try {
    const raw = store.getItem(keyFor(userKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, RECENT_SEARCH_MAX);
  } catch {
    return [];
  }
}

// Add `query` to the top of the user's recent list (de-duped, trimmed, capped) and
// return the new list. An empty/whitespace query is ignored (returns the current list).
export function addRecentSearch(
  store: SimpleStorage | null,
  userKey: string,
  query: string,
): string[] {
  const current = loadRecentSearches(store, userKey);
  // No storage (SSR / private mode): nothing can be saved, so return the current list
  // unchanged rather than a list that only looks saved — the honest degradation.
  if (!store) return current;
  const trimmed = query.trim();
  if (trimmed === "") return current;
  const deduped = current.filter((q) => q.toLowerCase() !== trimmed.toLowerCase());
  const next = [trimmed, ...deduped].slice(0, RECENT_SEARCH_MAX);
  try {
    store.setItem(keyFor(userKey), JSON.stringify(next));
  } catch {
    /* best-effort — a full/blocked store must never break search */
  }
  return next;
}

// Clear the user's recent searches entirely (the "clear" control). Returns [].
export function clearRecentSearches(store: SimpleStorage | null, userKey: string): string[] {
  if (store) {
    try {
      store.removeItem(keyFor(userKey));
    } catch {
      /* best-effort */
    }
  }
  return [];
}
