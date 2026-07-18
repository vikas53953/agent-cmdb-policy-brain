import { test as base } from "@playwright/test";
import { test, expect, E2E_READY, NOT_READY_REASON } from "./fixtures";

// Auth journey. Outcome assertions, not existence checks: the branded login screen
// actually renders, a signed-out visitor is actually bounced to it, and the Robot Test
// Door actually establishes a signed-in session that lands OFF /login.

base.describe("auth — signed out", () => {
  base.skip(!E2E_READY, NOT_READY_REASON);

  base("login page renders branded (not the bare Auth.js page)", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-screen")).toBeVisible();
    // The Fuse wordmark and its real tagline — proof it is the branded surface.
    await expect(page.locator(".login-wordmark")).toHaveText("Fuse");
    await expect(page.getByText("Music that melts together.")).toBeVisible();
    // The one real control: Continue with Google.
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
  });

  base("a protected route bounces a signed-out visitor to /login", async ({ page }) => {
    // No robot sign-in on this base test → the proxy must redirect the home route.
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("auth — robot door signed in", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);

  test("the robot door signs in and lands in the app, off /login", async ({ page }) => {
    // The fixture already signed the robot in. The home route must render the app, NOT
    // redirect to /login.
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);
    // The signed-in shell is present (the mini-player dock only renders for a session).
    await expect(page.getByTestId("mini-player")).toBeVisible();
  });

  test("a signed-in robot visiting /login is redirected into the app", async ({ page }) => {
    await page.goto("/login");
    await expect(page).not.toHaveURL(/\/login/);
  });
});
