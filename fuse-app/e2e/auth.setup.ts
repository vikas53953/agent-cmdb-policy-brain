import { test as setup, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { E2E_READY, NOT_READY_REASON, STORAGE_STATE } from "./fixtures";

// Auth setup project (U16). Every spec runs as a signed-in user, so the suite needs a
// browser storage state that carries a valid Auth.js database session.
//
// Google OAuth cannot be driven headlessly here (real consent screen), and no test-only
// credentials provider is added to production auth — that would be a login bypass we
// refuse to ship. Instead the operator provisions a signed-in session ONCE (sign in
// manually, export the browser storage to the path in E2E_STORAGE_STATE) and this setup
// validates it is present and still authenticated before the specs run.
//
// When the suite isn't provisioned (the default on the build machine), this skips — it
// never fabricates a session.
setup("authenticated session is available", async ({ page }) => {
  setup.skip(!E2E_READY, NOT_READY_REASON);

  expect(
    existsSync(STORAGE_STATE),
    `Expected a signed-in storage state at ${STORAGE_STATE}. Sign in once in a real browser ` +
      "and save its storage state there (see e2e/README.md).",
  ).toBe(true);

  // Sanity-check the injected session actually reaches the app without being bounced to
  // sign-in — a stale/expired state should fail loudly here, not mid-spec.
  await page.goto("/");
  await expect(page).not.toHaveURL(/\/api\/auth\/signin/);
});
