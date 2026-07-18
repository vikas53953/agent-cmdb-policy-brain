// Shared e2e helpers (U16).
//
// The Playwright specs below lock the app's headline behaviours and honesty rules
// (AE1–AE5, the heart moment, and the "no decorative controls" sweep). Running them
// end-to-end needs a PROVISIONED environment: a signed-in browser (Google OAuth can't
// be scripted here, so a storage-state file is injected — see auth.setup.ts), plus the
// runtime env the app reads at request time (DATABASE_URL, YOUTUBE_API_KEY, AUTH_SECRET,
// GOOGLE_* ). None of those secrets exist on the build machine, and none are ever
// committed. So the suite GATES on readiness: with `E2E_READY=1` it runs; otherwise
// every spec skips with a clear reason rather than failing a bare CI run.
//
// This mirrors the honesty rule at the test layer: a spec never pretends to have
// verified something it could not actually exercise.

export const STORAGE_STATE = process.env.E2E_STORAGE_STATE ?? "e2e/.auth/user.json";

// The suite is "ready" only when an operator has provisioned the environment above and
// opted in explicitly. Kept as a single source of truth so every spec gates the same way.
export const E2E_READY = process.env.E2E_READY === "1";

export const NOT_READY_REASON =
  "e2e not provisioned — set E2E_READY=1 with a signed-in storage state and the app's " +
  "runtime env (DATABASE_URL, YOUTUBE_API_KEY, AUTH_SECRET, GOOGLE_*). Secrets are never committed.";

// Stable UI strings the app renders — asserted verbatim so a copy change that would
// break the honesty contract fails a test rather than slipping through silently.
export const TEXT = {
  searchInputLabel: "Search for songs and artists",
  noLyrics: "No lyrics available for this song",
  stallRetry: "Playback stalled — retrying",
  ytCapabilityReason: "Not available for YouTube tracks",
  spotifyOneDeck: "Spotify allows one deck at a time",
  spotifyFallbackNotice: "Spotify needs Premium — playing the YouTube version",
} as const;
