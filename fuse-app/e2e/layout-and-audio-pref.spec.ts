import {
  test,
  expect,
  E2E_READY,
  NOT_READY_REASON,
} from "./fixtures";
import type { Page } from "@playwright/test";

// Layout + audio-preference honesty (Complaints 1 & 2), the DETERMINISTIC half that runs
// in the release gate — no external keys, no database needed. Two invariants:
//   • No horizontal overflow (no dead white/blank bands bleeding off the frame) on every
//     main screen, at a small phone (390x844) AND a desktop (1280x800).
//   • The "Prefer audio versions" setting exists, is ON by default (music-first), and is a
//     real switch — the honest control the owner asked for.

// The two viewports the owner cares about.
const VIEWPORTS = [
  { name: "phone 390x844", width: 390, height: 844 },
  { name: "desktop 1280x800", width: 1280, height: 800 },
] as const;

// Every signed-in screen the shell renders.
const ROUTES = ["/", "/search", "/dj", "/library"] as const;

// The horizontal overflow of the document, in px. <= 1 means the page never scrolls
// sideways (1px slack absorbs sub-pixel rounding).
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
}

test.describe("layout — no horizontal overflow on any screen, phone and desktop", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);

  for (const vp of VIEWPORTS) {
    test(`no sideways overflow at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of ROUTES) {
        await page.goto(route);
        // Let the shell settle (mini-player / tabs mount).
        await expect(page.getByTestId("open-settings")).toBeVisible({ timeout: 15_000 });
        const overflow = await horizontalOverflow(page);
        expect(
          overflow,
          `Screen ${route} at ${vp.name} overflows horizontally by ${overflow}px — a dead ` +
            "blank band / sideways scroll the owner reported.",
        ).toBeLessThanOrEqual(1);
      }
    });
  }
});

test.describe("prefer-audio setting — the honest, music-first control (Complaint 1)", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);

  test("is present, ON by default, and a real switch with an honest description", async ({
    page,
  }) => {
    await page.getByTestId("open-settings").click();
    const toggle = page.getByTestId("prefer-audio-toggle");
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    // Default ON — Fuse behaves like a music app out of the box.
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    // It is a real switch, never a decorative row (reachable by its switch role + name).
    await expect(
      page.getByRole("switch", { name: "Prefer audio versions" }),
    ).toBeVisible();
    // The honest description is shown so the owner knows exactly what it does and does not
    // do (P2: it floats official audio "when a search has any"; videos still appear below).
    await expect(page.getByText(/floats official audio to the top/i)).toBeVisible();
  });
});
