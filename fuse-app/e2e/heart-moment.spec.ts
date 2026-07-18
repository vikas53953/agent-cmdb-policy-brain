import { test, expect } from "@playwright/test";
import { E2E_READY, NOT_READY_REASON, STORAGE_STATE, TEXT } from "./fixtures";

// The heart moment (F1, R1/R2/R5/R6): type in Search → real results appear with covers
// and a source badge → tap a YouTube result → it plays → open Now Playing → lyrics are
// there (scrolling, or the honest "no lyrics" message — never a fake/empty panel).
test.use({ storageState: STORAGE_STATE });
test.describe("the heart moment", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);

  test("search → instant play → Now Playing with lyrics", async ({ page }) => {
    await page.goto("/search");

    const input = page.getByLabel(TEXT.searchInputLabel);
    await input.fill("paper cities");

    // Results render as a real list; each row carries art and a source badge (R1/R5).
    const results = page.locator("ul.sresult-list li");
    await expect(results.first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".sresult .badge").first()).toBeVisible();

    // Tap the first enabled play control (a YouTube result is playable from U7).
    const play = page.locator(".sresult-actions button.icon-btn.primary:not([disabled])").first();
    await expect(play).toBeVisible();
    await play.click();

    // Open the full Now Playing surface from the mini-player, then confirm the dialog.
    await page.locator(".mini-open").first().click();
    const nowPlaying = page.getByRole("dialog", { name: "Now playing" });
    await expect(nowPlaying).toBeVisible();

    // Lyrics are honest: either timed lines OR the plain "no lyrics" message (R6/R7/AE2).
    const lyricsPanel = nowPlaying.locator(".lyrics");
    const emptyMsg = nowPlaying.getByText(TEXT.noLyrics);
    await expect(lyricsPanel.or(emptyMsg).first()).toBeVisible({ timeout: 15_000 });
  });
});
