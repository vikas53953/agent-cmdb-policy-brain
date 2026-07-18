import { defineConfig, devices } from "@playwright/test";

// Playwright config for the Robot Tester.
//
// TWO PROJECTS, selected with --project:
//   • local — boots the dev server on this machine (E2E_TEST_SECRET provided to it so
//     the Robot Test Door exists) and runs every spec against it. This is the release
//     gate's project (CI).
//   • live  — runs the SAME specs against a deployed URL (BASE_URL) using the door
//     secret from the environment. This is the watchman's project. No dev server.
//
// Which mode we are in is decided by BASE_URL: set it → live (no webServer, baseURL is
// the deployment); unset → local (webServer on localhost). You run ONE project at a
// time, so only the matching one is exercised.
//
// Browser binaries are NOT installed by `npm install`; run
// `npx playwright install chromium` once before the first run.

const LIVE_URL = process.env.BASE_URL;
const PORT = Number(process.env.E2E_PORT ?? 3300);
const LOCAL_URL = `http://localhost:${PORT}`;

// Chromium flags so autoplay works headlessly (no user-gesture requirement) and no
// sound actually plays on the runner.
const CHROMIUM_ARGS = [
  "--autoplay-policy=no-user-gesture-required",
  "--mute-audio",
];

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // YouTube embeds can be flaky in CI, so retry once per spec (the specs also build in
  // resilient waits up to 30s for a playing state).
  retries: 1,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    // Evidence on failure only (keeps green runs cheap): full trace, screenshot, video.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: { args: CHROMIUM_ARGS },
  },
  projects: [
    {
      name: "local",
      use: { ...devices["Desktop Chrome"], baseURL: LOCAL_URL },
    },
    {
      name: "live",
      use: { ...devices["Desktop Chrome"], baseURL: LIVE_URL },
    },
  ],
  // Local mode boots the dev server and hands it the door secret so the robot can sign
  // in; live mode targets a deployment that already has the door, so no server here.
  webServer: LIVE_URL
    ? undefined
    : {
        command: `npm run dev -- -p ${PORT}`,
        url: LOCAL_URL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        env: {
          // The door secret the local app needs to open the door. Inherited from the
          // process env (a GitHub secret in CI, the shell locally). Never committed.
          E2E_TEST_SECRET: process.env.E2E_TEST_SECRET ?? "",
        },
      },
});
