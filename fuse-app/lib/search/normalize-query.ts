// Shared search-query normalizer (F2).
//
// ONE place that BOTH the client input box and the server /api/search route
// funnel every query through, so the length cap can never be bypassed by hitting
// the API directly (an authenticated user can call /api/search?q=… themselves).
//
// It trims, collapses internal whitespace runs to a single space, and caps the
// length. Script-like text is deliberately left AS text — it is escaped safely
// downstream and never executed — so this is not a security filter; the cap's job
// is simply to stop absurd input from burning a real, quota-costing provider
// search on junk.
//
// NOTE: this is a different job from `normalizeQuery` in lib/repos/search-cache.ts.
// That one builds the CACHE KEY (it also lowercases), so trivially-different
// spellings share a cache entry. This one shapes the INPUT and preserves the
// user's original casing for the provider search and for display.

// 100 characters. Real music searches — "Artist - Title (feat. Someone)" — sit
// far below this, and the longest query a person actually types is comfortably
// under 100. Past that point the extra characters are paste-junk or abuse that
// only spends YouTube's small daily quota, so we cap rather than pass it through.
// Chosen at the low end of the 100–150 range to protect quota harder while still
// leaving generous headroom above any genuine query.
export const MAX_SEARCH_QUERY_LENGTH = 100;

// Trim, collapse whitespace, and cap. A query that is empty or whitespace-only
// returns "" — the caller (client and server) treats that as a no-op, never an
// error. Over-long input is silently truncated to the cap, never rejected.
export function normalizeSearchQuery(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_QUERY_LENGTH)
    .trim();
}
