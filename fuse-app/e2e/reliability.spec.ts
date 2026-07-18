import { test, expect } from "@playwright/test";
import { E2E_READY, NOT_READY_REASON, STORAGE_STATE, TEXT } from "./fixtures";

// AE1 (R2/R18): a stalled track must SAY it stalled and let the user skip — never a
// silent freeze. The playback-health machine flips a track to "stalled" when position
// stops advancing while still marked playing; here we force that by loading a track and
// suppressing progress, then assert the banner and the Skip control appear.
test.use({ storageState: STORAGE_STATE });
test.describe("reliability — stall then skip", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);

  test("a stall shows 'retrying' then offers Skip (AE1)", async ({ page }) => {
    await page.goto("/search");
    await page.getByLabel(TEXT.searchInputLabel).fill("paper cities");
    await page.locator(".sresult-actions button.icon-btn.primary:not([disabled])").first().click();

    await page.locator(".mini-open").first().click();
    const nowPlaying = page.getByRole("dialog", { name: "Now playing" });
    await expect(nowPlaying).toBeVisible();

    // Force a REAL stall by dropping the network mid-playback: the video stops buffering,
    // position stops advancing while the store still marks the track playing, and the
    // health machine detects the stall exactly as it would on a live network hiccup.
    await page.context().setOffline(true);

    try {
      // The honest banner appears within a few health ticks (R18), and after the automatic
      // retries are exhausted the Skip control is offered — never a silent freeze (AE1).
      await expect(nowPlaying.getByText(TEXT.stallRetry)).toBeVisible({ timeout: 10_000 });
      await expect(nowPlaying.getByRole("button", { name: /Skip/ })).toBeVisible({ timeout: 20_000 });
    } finally {
      await page.context().setOffline(false);
    }
  });
});
