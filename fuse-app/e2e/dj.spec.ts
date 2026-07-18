import {
  test,
  expect,
  E2E_READY,
  NOT_READY_REASON,
  E2E_EXTERNAL,
  NO_EXTERNAL_REASON,
  TEXT,
  STABLE,
} from "./fixtures";

// DJ console journey. The honesty rules made concrete (R13/R17, AE3/AE4) plus a real
// playing-deck check: a YouTube deck greys out the full-engine controls with a reason
// and keeps speed; loading a known video really advances; Spotify is honest about not
// playing yet; My Files reflects its current (now-live) support.

test.describe("dj — capability honesty and a really-playing deck", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);

  test("Deck A on YouTube: EQ/Loops/FX/Scratch disabled with a reason, speed present", async ({
    page,
  }) => {
    await page.getByTestId("tab-dj").click();
    const deckA = page.getByTestId("deck-A");
    await page.getByTestId("deck-A-source-youtube").click();

    // The full-engine powers render as greyed capability chips carrying the YouTube
    // reason — never live knobs (AE3). The interactive EQ ranges / Loop / Echo buttons
    // (which only exist for a My Files deck) are absent here.
    await expect(deckA.getByText(TEXT.ytCapabilityReason).first()).toBeVisible();
    await expect(deckA.locator(".cap.off")).not.toHaveCount(0);
    await expect(deckA.locator(".deck-eq-range")).toHaveCount(0);
    await expect(deckA.getByRole("button", { name: /^Loop$|^Echo$/ })).toHaveCount(0);

    // Speed control is present (it is the one full-engine-adjacent control YouTube keeps).
    await expect(deckA.getByRole("slider", { name: /playback speed/i })).toBeVisible();
  });

  test("Deck A on YouTube: a known video loads and the deck really advances", async ({ page }) => {
    test.skip(!E2E_EXTERNAL, NO_EXTERNAL_REASON);
    await page.getByTestId("tab-dj").click();
    const deckA = page.getByTestId("deck-A");
    await page.getByTestId("deck-A-source-youtube").click();

    await page.getByTestId("deck-A-link").fill(STABLE.youtubeVideoId);
    await page.getByTestId("deck-A-load").click();

    await expect(
      deckA,
      "Deck A never reached 'playing' within 30s — a refused embed or a stall.",
    ).toHaveAttribute("data-deck-state", "playing", { timeout: 30_000 });

    const p0 = Number(await deckA.getAttribute("data-deck-position"));
    await page.waitForTimeout(5_000);
    const p1 = Number(await deckA.getAttribute("data-deck-position"));
    expect(
      p1,
      `Deck A position did not advance in 5s (p0=${p0}, p1=${p1}) — the deck is stalled.`,
    ).toBeGreaterThan(p0);
  });

  test("Spotify on a deck is honest that playback is not wired yet", async ({ page }) => {
    await page.getByTestId("tab-dj").click();
    await page.getByTestId("deck-B-source-spotify").click();
    // The deck states plainly, in plain English, that Spotify playback is not available.
    await expect(page.getByTestId("deck-B").locator(".deck-notice")).toBeVisible();
  });

  test("Spotify locks the OTHER deck (one deck at a time — AE4)", async ({ page }) => {
    await page.getByTestId("tab-dj").click();
    await page.getByTestId("deck-A-source-spotify").click();

    // Deck B's Spotify option is now locked with its reason.
    const spotifyOnB = page.getByTestId("deck-B-source-spotify");
    await expect(spotifyOnB).toBeDisabled();
    await expect(page.getByTestId("deck-B").getByText(TEXT.spotifyOneDeck)).toBeVisible();
  });

  test("My Files reflects current support (local engine is live)", async ({ page }) => {
    await page.getByTestId("tab-dj").click();
    // U14 flipped My Files live, so the source option is now SELECTABLE (not locked).
    const localOnA = page.getByTestId("deck-A-source-local");
    await expect(localOnA).toBeEnabled();
    await localOnA.click();
    // Selecting it surfaces the on-device promise (files never uploaded — R14).
    await expect(page.getByTestId("deck-A").getByText(new RegExp(TEXT.onDeviceNotice))).toBeVisible();
  });
});
