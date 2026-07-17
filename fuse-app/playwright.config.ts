import { defineConfig, devices } from "@playwright/test";

// Playwright is WIRED here at the scaffold (U1) but carries no specs yet — the
// e2e suite (heart moment + honesty rules) lands in U16. Until then the `e2e/`
// directory holds only this config's target and `playwright test` finds no specs.
// The command joins the CI gate from U16 (see the plan's Verification Contract);
// the U1 gate is `tsc --noEmit && eslint . && vitest run && next build`.
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
