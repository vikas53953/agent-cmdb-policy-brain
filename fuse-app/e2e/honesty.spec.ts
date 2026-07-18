import { test, expect, type Page } from "@playwright/test";
import { E2E_READY, NOT_READY_REASON, STORAGE_STATE, TEXT } from "./fixtures";

// The honesty rules (R17/R13, AE2–AE5) plus the "zero decorative controls" sweep. This
// is the class-level guarantee the old app failed: nothing on screen pretends to work.
test.use({ storageState: STORAGE_STATE });
test.describe("honesty rules", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);

  // AE3 — a YouTube deck greys out EQ/loops/FX/scratch with a plain reason, keeping
  // crossfade + speed live.
  test("YouTube deck disables the full-engine controls with a reason (AE3)", async ({ page }) => {
    await page.goto("/dj");
    const deckA = page.getByRole("region", { name: "Deck A" });
    await deckA.getByRole("button", { name: "YouTube" }).click();

    // The capability reason is shown, and the EQ/loops/FX/scratch controls are absent or
    // disabled for a YouTube deck (only crossfade + speed remain).
    await expect(deckA.getByText(TEXT.ytCapabilityReason).first()).toBeVisible();
    await expect(deckA.locator(".deck-eq-range")).toHaveCount(0);
    await expect(deckA.getByRole("button", { name: /Loop|Echo/ })).toHaveCount(0);
  });

  // AE4 — with Spotify on Deck A, Deck B's Spotify option locks with its reason.
  test("Spotify locks the second deck with a reason (AE4)", async ({ page }) => {
    await page.goto("/dj");
    const deckA = page.getByRole("region", { name: "Deck A" });
    const deckB = page.getByRole("region", { name: "Deck B" });

    await deckA.getByRole("button", { name: "Spotify" }).click();

    const spotifyOnB = deckB.getByRole("button", { name: /Spotify/ });
    await expect(spotifyOnB).toBeDisabled();
    await expect(deckB.getByText(TEXT.spotifyOneDeck)).toBeVisible();
  });

  // AE5 — a non-Premium user tapping a Spotify result hears the matched YouTube version,
  // labelled honestly. (Provisioned env has Spotify configured but the test user is not
  // an allowlisted Premium account, so the fallback path runs.)
  test("Spotify track falls back to YouTube, labelled (AE5)", async ({ page }) => {
    await page.goto("/search");
    await page.getByLabel(TEXT.searchInputLabel).fill("paper cities");

    const spotifyRow = page.locator(".sresult", {
      has: page.locator(".badge.sp"),
    }).first();
    await expect(spotifyRow).toBeVisible({ timeout: 15_000 });
    const spotifyPlay = spotifyRow.locator("button.icon-btn.primary:not([disabled])");
    await spotifyPlay.click();

    await page.locator(".mini-open").first().click();
    const nowPlaying = page.getByRole("dialog", { name: "Now playing" });
    await expect(nowPlaying.getByText(TEXT.spotifyFallbackNotice)).toBeVisible({ timeout: 15_000 });
  });

  // The sweep: on every screen, every visible, enabled button has a real accessible name
  // (no nameless/decorative control), and every disabled control carries a reason
  // (title or aria-label) so its unavailability is explained (R17).
  for (const path of ["/", "/search", "/dj", "/library"]) {
    test(`no decorative controls on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await assertNoDecorativeControls(page);
    });
  }
});

async function assertNoDecorativeControls(page: Page): Promise<void> {
  const buttons = page.locator("button:visible");
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const btn = buttons.nth(i);
    const name = ((await btn.getAttribute("aria-label")) ?? (await btn.textContent()) ?? "").trim();
    const disabled = (await btn.isDisabled()) || (await btn.getAttribute("aria-disabled")) === "true";
    if (disabled) {
      // A disabled control must EXPLAIN itself (R17): a reason lives in title or aria-label.
      const title = (await btn.getAttribute("title")) ?? "";
      const aria = (await btn.getAttribute("aria-label")) ?? "";
      expect(
        (title + aria).trim().length,
        `disabled control #${i} on the page has no plain-English reason`,
      ).toBeGreaterThan(0);
    } else {
      // An enabled control must have a name a user (and a screen reader) can act on.
      expect(name.length, `enabled control #${i} on the page has no accessible name`).toBeGreaterThan(0);
    }
  }
}
