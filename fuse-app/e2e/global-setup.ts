// Global setup — runs ONCE before the whole Playwright suite.
//
// Its single job is to make a test result mean what it says. Every spec here signs a
// robot in through the secret-gated Robot Test Door; without E2E_TEST_SECRET (the door
// secret) NONE of them can run, so all 126 specs SKIP — and a suite where every spec
// skips exits GREEN. That green is a lie: nothing was tested, yet the docs' command
// ("npx playwright test") reads "all passed".
//
// So: if the door secret is still missing after playwright.config.ts has loaded
// .env.local, we print a LOUD banner and FAIL the run. An all-skip can never again be
// misread as a pass. When the secret IS present the run proceeds normally (capability
// specs — DB / external / fake engine — still skip honestly with their own reasons).

import { ROBOT_SECRET_MIN_LENGTH } from "../lib/robot-door";

export default function globalSetup(): void {
  const secret = process.env.E2E_TEST_SECRET ?? "";

  // Provisioned: the door secret is present and strong enough — let the suite run.
  if (secret.length >= ROBOT_SECRET_MIN_LENGTH) return;

  // Not provisioned: refuse to let a run that can test nothing report success.
  const banner = [
    "",
    "  ================================================================",
    "   NOT PROVISIONED - 0 tests ran. THIS IS NOT A PASS.",
    "  ================================================================",
    "   The Robot Test Door secret is missing, so every end-to-end",
    "   spec would skip and the run would falsely look green.",
    "",
    "   To really test the app, provide E2E_TEST_SECRET (32+ chars):",
    "     - on your machine: put it in fuse-app/.env.local",
    "       (playwright.config.ts loads that file automatically), or",
    "     - in CI / against the live site: set it in the environment",
    "       before running the tests.",
    "",
    "   Failing on purpose so an all-skip is never read as success.",
    "  ================================================================",
    "",
  ].join("\n");

  console.error(banner);

  throw new Error(
    "E2E not provisioned: E2E_TEST_SECRET is missing (or under 32 chars). " +
      "0 tests ran - this is not a pass. See the banner above.",
  );
}
