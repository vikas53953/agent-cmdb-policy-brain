// Shared e2e harness for the Robot Tester.
//
// These specs drive the REAL signed-in app — the release gate runs them against a local
// dev server, the watchman runs them against production. Both sign in through the Robot
// Test Door (lib/robot-door.ts): a secret-gated Credentials provider that lets an
// automated robot in without Google (which correctly blocks robots). Google OAuth is
// never scripted here.
//
// PROVISIONING: the suite needs E2E_TEST_SECRET (the door secret, >= 32 chars) in the
// environment of BOTH the app (so the door exists) and this test process (so the robot
// can present the secret). When it is unset the specs SKIP with a clear reason rather
// than failing a bare run — a spec never pretends to have verified something it could
// not exercise.

import { test as base, expect, type APIRequestContext } from "@playwright/test";
import { ROBOT_SECRET_MIN_LENGTH } from "../lib/robot-door";

// The door secret this process will present. Read from the environment only — never
// hard-coded, never logged. Empty when not provisioned.
const SECRET = process.env.E2E_TEST_SECRET ?? "";

// The suite is "ready" only when a strong door secret is present (same floor the app's
// door enforces). Kept as one source of truth so every spec gates identically.
export const E2E_READY = SECRET.length >= ROBOT_SECRET_MIN_LENGTH;

export const NOT_READY_REASON =
  "Robot Tester not provisioned — set E2E_TEST_SECRET (>= 32 chars) so the robot can " +
  "sign in through the secret-gated door. The secret is never committed.";

// Some journeys (likes, playlists, settings persistence) are only meaningful against a
// real database. E2E_DB=1 declares one is reachable (production has one; the live
// watchman and a local run with a pulled DATABASE_URL set it). Without it those specs
// SKIP rather than fail on an environment the run never claimed to have — the DB-free
// journeys (auth, the listen heart-moment, dj honesty, navigation) still run and gate.
export const E2E_DB = process.env.E2E_DB === "1";

export const NO_DB_REASON =
  "No database declared for this run (set E2E_DB=1 with a reachable DATABASE_URL). " +
  "Likes / playlists / settings persistence need one.";

// Sign the robot in through the door, programmatically (no UI): fetch the Auth.js CSRF
// token, POST the secret to the e2e-robot Credentials callback, and confirm a session
// landed. Cookies live in the shared browser context, so every subsequent page load in
// the test is authenticated. The secret is sent in the POST body only — never logged.
export async function signInRobot(
  request: APIRequestContext,
  baseURL: string | undefined,
): Promise<void> {
  const csrfRes = await request.get("/api/auth/csrf");
  if (!csrfRes.ok()) {
    throw new Error(`Could not fetch CSRF token (HTTP ${csrfRes.status()}). Is the app up?`);
  }
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  // Auth.js credentials callback: form-encoded, redirects on success. We do not follow
  // the redirect (maxRedirects 0) — the Set-Cookie is captured into the context jar
  // regardless, which is all we need.
  await request.post("/api/auth/callback/e2e-robot", {
    form: { csrfToken, secret: SECRET, callbackUrl: baseURL ?? "/" },
    maxRedirects: 0,
    failOnStatusCode: false,
  });

  // Confirm the session is real before the spec proceeds — a closed door or wrong secret
  // fails loudly here, not mid-spec with a confusing redirect.
  const session = (await request.get("/api/auth/session").then((r) => r.json())) as {
    user?: { email?: string };
  };
  if (!session?.user) {
    throw new Error(
      "Robot sign-in did not establish a session. The door may be closed on this " +
        "deployment (E2E_TEST_SECRET unset there) or the secret does not match.",
    );
  }
}

// The `test` every spec imports: a signed-in-robot page. The fixture signs in against
// the page's own request context (shared cookie jar) before handing the page over, so
// specs open already authenticated.
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    await signInRobot(page.request, baseURL);
    // Land on the app so specs can interact with the shell (tabs, mini-player) straight
    // away — without this the page sits on about:blank and every getByTestId waits out.
    await page.goto("/");
    await use(page);
  },
});

export { expect };

// Stable UI strings the app renders — asserted verbatim so a copy change that would
// break a contract fails a test rather than slipping through silently.
export const TEXT = {
  searchInputLabel: "Search for songs and artists",
  noLyrics: "No lyrics available for this song",
  stallRetry: "Playback stalled — retrying",
  ytCapabilityReason: "Not available for YouTube tracks",
  spotifyOneDeck: "Spotify allows one deck at a time",
  onDeviceNotice: "never uploaded",
} as const;

// A known-stable search query and a known-stable YouTube video id the specs lean on.
// "lofi hip hop radio" is an evergreen, always-populated YouTube search; the video id
// is a long-lived, embeddable music video used only to prove the deck advances.
export const STABLE = {
  query: "lofi hip hop",
  // Rick Astley — Never Gonna Give You Up: famously always available and embeddable.
  youtubeVideoId: "dQw4w9WgXcQ",
} as const;
