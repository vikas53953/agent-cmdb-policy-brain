import {
  test,
  expect,
  E2E_READY,
  NOT_READY_REASON,
  E2E_EXTERNAL,
  NO_EXTERNAL_REASON,
  E2E_FAKE_ENGINE,
  NO_FAKE_REASON,
  STABLE,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";

// Wave 1 feature-parity journeys (queue, true previous, sleep timer, recent searches,
// result filters, tap-to-seek lyrics). Playback journeys run against the in-DOM FAKE engine
// so positions and track switches are deterministic (search still returns real rows, so
// E2E_EXTERNAL is also required). The settings-only journeys (sleep arming, recent searches)
// need only a signed-in robot, so they run more widely.

async function firstYouTube(page: Page): Promise<Locator> {
  await page.getByTestId("tab-search").click();
  await page.getByTestId("search-input").fill(STABLE.query);
  const ytRows = page.locator('[data-testid="search-result"][data-source="youtube"]');
  await expect(ytRows.first()).toBeVisible({ timeout: 30_000 });
  return ytRows.first();
}

const posOf = async (mini: Locator) => Number(await mini.getAttribute("data-player-position"));

test.describe("Wave 1 — deterministic playback journeys (fake engine)", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);
  test.skip(!E2E_FAKE_ENGINE, NO_FAKE_REASON);
  test.skip(!E2E_EXTERNAL, NO_EXTERNAL_REASON);

  test("queue: Play next inserts at the front and the queue screen reorders it", async ({
    page,
  }) => {
    const firstYt = await firstYouTube(page);
    // Start the first result (this seeds the rest of the list as the up-next queue).
    await firstYt.getByTestId("result-play").click();
    const mini = page.getByTestId("mini-player");
    await expect.poll(() => posOf(mini), { timeout: 20_000 }).toBeGreaterThan(1);

    // Open the queue from the mini-player.
    await page.getByTestId("mini-queue").click();
    const queue = page.getByTestId("queue-panel");
    await expect(queue).toHaveAttribute("data-queue-open", "true");

    const rows = page.getByTestId("queue-row");
    await expect(rows.first()).toBeVisible();
    const before = (await rows.first().locator(".q-row-title").textContent())?.trim();

    // Move the first up-next row down, then confirm the order actually changed.
    await page.getByTestId("queue-down").first().click();
    await expect
      .poll(async () => (await rows.first().locator(".q-row-title").textContent())?.trim())
      .not.toBe(before);

    // Remove the (new) first row — the list must shrink by one.
    const countBefore = await rows.count();
    await page.getByTestId("queue-remove").first().click();
    await expect.poll(() => rows.count()).toBe(countBefore - 1);
  });

  test("true previous: goes back to the last song through history", async ({ page }) => {
    const firstYt = await firstYouTube(page);
    await firstYt.getByTestId("result-play").click();
    const mini = page.getByTestId("mini-player");
    await expect.poll(() => posOf(mini), { timeout: 20_000 }).toBeGreaterThan(1);

    await page.getByTestId("mini-open").click();
    const np = page.getByTestId("now-playing");
    const titleOf = async () => (await np.locator(".np-title").textContent())?.trim() ?? "";
    const first = await titleOf();

    // Advance to the next track…
    await page.getByTestId("np-next").click();
    await expect.poll(titleOf, { timeout: 15_000 }).not.toBe(first);
    const second = await titleOf();

    // …then Previous should go BACK to the first (history), not restart the second. Press it
    // quickly (near the start of the track) so it goes back rather than restarting.
    await page.getByTestId("np-prev").click();
    await expect.poll(titleOf, { timeout: 15_000 }).toBe(first);
    expect(second).not.toBe(first);
  });

  test("tap-to-seek lyrics: tapping a synced line jumps playback (when synced lyrics exist)", async ({
    page,
  }) => {
    const firstYt = await firstYouTube(page);
    await firstYt.getByTestId("result-play").click();
    const mini = page.getByTestId("mini-player");
    await expect.poll(() => posOf(mini), { timeout: 20_000 }).toBeGreaterThan(1);
    await page.getByTestId("mini-open").click();

    // Synced lyrics are only present for some tracks; assert only when they render (the plain
    // / no-lyrics states are honestly non-interactive, so there is nothing to tap).
    const lines = page.getByTestId("lyric-line");
    await page.waitForTimeout(3000); // allow the lyrics fetch to settle
    const count = await lines.count();
    if (count < 4) return; // no synced lyrics for this track — nothing to seek, pass honestly

    const target = lines.nth(count - 1); // a late line, clearly ahead of the current spot
    await target.click();
    // Position should jump forward toward that line's timestamp.
    await expect.poll(() => posOf(mini), { timeout: 8_000 }).toBeGreaterThan(5);
  });

  test("result filters narrow the list without lying (Songs / Videos)", async ({ page }) => {
    await firstYouTube(page);
    const filters = page.getByTestId("result-filters");
    await expect(filters).toBeVisible();
    const rows = page.getByTestId("search-result");
    const all = await rows.count();

    await page.getByTestId("filter-videos").click();
    // Every remaining row must be labelled Video (the filter matches the row's own label).
    const afterVideos = await rows.count();
    if (afterVideos > 0) {
      const kinds = await page.getByTestId("result-kind").allInnerTexts();
      expect(kinds.every((k) => k.trim() === "Video")).toBe(true);
    }
    expect(afterVideos).toBeLessThanOrEqual(all);

    await page.getByTestId("filter-all").click();
    await expect.poll(() => rows.count()).toBe(all);
  });
});

test.describe("Wave 1 — settings journeys (signed-in robot)", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);

  test("sleep timer arms from settings and shows a live chip, then cancels", async ({ page }) => {
    await page.getByTestId("open-settings").click();
    const sheet = page.getByTestId("profile-sheet");
    await expect(sheet).toBeVisible();

    // Arm a 15-minute timer from the profile sheet's sleep control.
    await sheet.getByTestId("sleep-trigger").click();
    await sheet.getByTestId("sleep-15").click();

    // The armed chip appears in the top bar, visible app-wide.
    const chip = page.getByTestId("topbar-sleep-chip");
    await expect(chip).toBeVisible();

    // Cancel via the top-bar chip — it must disarm honestly.
    await chip.click();
    await expect(page.getByTestId("topbar-sleep-chip")).toHaveCount(0);
  });

  test("recent searches remembers a query, re-runs it, and clears", async ({ page }) => {
    await page.getByTestId("tab-search").click();
    const input = page.getByTestId("search-input");
    await input.fill("daft punk");
    await input.press("Enter"); // records the search
    await input.fill(""); // empty box → the idle recent-searches view shows

    const recent = page.getByTestId("recent-searches");
    await expect(recent).toBeVisible();
    const chip = page.getByTestId("recent-chip").filter({ hasText: "daft punk" });
    await expect(chip).toBeVisible();

    // Tapping the chip re-runs the search (the input is refilled).
    await chip.click();
    await expect(input).toHaveValue("daft punk");

    // Clear empties the list.
    await input.fill("");
    await page.getByTestId("recent-clear").click();
    await expect(page.getByTestId("recent-searches")).toHaveCount(0);
  });
});
