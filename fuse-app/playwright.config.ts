import { defineConfig, devices } from "@playwright/test";
import { E2E_READY } from "./e2e/fixtures";

// Playwright was WIRED at the scaffold (U1); the e2e suite (heart moment, honesty rules,
// stall/retry) lands here in U16. `playwright test` joins the CI gate from U16 (see the
// plan's Verification Contract; the U1..U15 gate is `tsc --noEmit && eslint . &&
// vitest run && next build`).
//
// The specs GATE on E2E_READY: running them end-to-end needs a provisioned environment
// (a signed-in storage state + the app's runtime secrets, none of which live on the
// build machine or in the repo). With `E2E_READY=1` the setup project runs and the
// specs execute against a signed-in browser; otherwise every spec skips with a clear
// reason instead of failing a bare run.
//
// Browser binaries are NOT installed by `npm install`; run
// `npx playwright install chromium` once before the first e2e run.

const PORT = Number(process.env.E2E_PORT ?? 3300);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // Validates the injected signed-in session before the specs run (skips when the
    // suite isn't provisioned). Only wired as a dependency once E2E_READY is set, so a
    // bare run doesn't try to authenticate against nothing.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // The signed-in state is applied per-spec via test.use(storageState); the file is
      // only required when the suite is actually running.
      dependencies: E2E_READY ? ["setup"] : [],
    },
  ],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
