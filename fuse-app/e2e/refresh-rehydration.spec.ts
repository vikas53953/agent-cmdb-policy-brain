import { test, expect, requires, STABLE } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

// Refresh rehydration (FIX 2), the owner's P2 repro turned DETERMINISTIC against the in-DOM
// fake engine. THE BUG: refreshing mid-song reset the mini-player to "Nothing playing yet"
// and blanked the search screen. THE HONEST FIX: on reload the mini-player comes back with
// the SAME track PAUSED at the saved position (a play button, never auto-play), and the
// search query + results view are restored. Tapping play continues from where it left off.
//
// Deterministic like playback-intent.spec: the fake engine makes position exact and
// network-free; search still returns real rows (an evergreen query), which is why
// E2E_EXTERNAL is also required.

test.describe("refresh rehydration — reload restores the paused song + search (FIX 2)", () => {
  requires("fake", "external");

  async function firstYouTube(page: Page): Promise<Locator> {
    await page.getByTestId("tab-search").click();
    await page.getByTestId("search-input").fill(STABLE.query);
    const ytRows = page.locator('[data-testid="search-result"][data-source="youtube"]');
    await expect(ytRows.first()).toBeVisible({ timeout: 30_000 });
    return ytRows.first();
  }

  const posOf = async (mini: Locator) =>
    Number(await mini.getAttribute("data-player-position"));
  const stateOf = async (mini: Locator) => mini.getAttribute("data-player-state");

  test("play → refresh → same track paused at ~saved position → tap play advances from there; search restored", async ({
    page,
  }) => {
    const firstYt = await firstYouTube(page);
    const playedTitle = (await firstYt.locator(".sresult-title").textContent())?.trim() ?? "";
    await firstYt.getByTestId("result-play").click();

    const mini = page.getByTestId("mini-player");
    // Let it genuinely play a few seconds so there is a real position to restore.
    await expect.poll(() => posOf(mini), { timeout: 20_000 }).toBeGreaterThan(3);
    const savedPos = await posOf(mini);

    // RELOAD — the bug reset everything; the fix restores it.
    await page.reload();

    // The mini-player is back with the SAME track (not "Nothing playing yet") …
    const mini2 = page.getByTestId("mini-player");
    await expect(mini2).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".mini-title")).toHaveText(playedTitle, { timeout: 20_000 });

    // … PAUSED (never auto-played) at approximately the saved position.
    expect(await stateOf(mini2)).not.toBe("playing");
    await expect
      .poll(() => posOf(mini2), { timeout: 10_000 })
      .toBeGreaterThan(Math.max(1, savedPos - 3));

    const restoredPos = await posOf(mini2);

    // The search query + results view are restored (re-run through the normal search path).
    await page.getByTestId("tab-search").click();
    await expect(page.getByTestId("search-input")).toHaveValue(STABLE.query);
    await expect(
      page.locator('[data-testid="search-result"]').first(),
    ).toBeVisible({ timeout: 30_000 });

    // Tap play — position advances FROM the restored spot, not from 0:00.
    await mini2.getByTestId("mini-play").click();
    await expect.poll(() => stateOf(mini2), { timeout: 20_000 }).toBe("playing");
    await expect
      .poll(() => posOf(mini2), { timeout: 20_000 })
      .toBeGreaterThan(restoredPos + 0.5);
  });
});
