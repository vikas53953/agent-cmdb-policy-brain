import { test, expect, requires, STABLE } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

// The owner's live repro (2026-07-19), turned into DETERMINISTIC specs against the in-DOM
// fake engine. Each journey mirrors one of R1-R4 exactly:
//   R1 opening the app / Now Playing must NEVER self-play.
//   R2 pressing Next must actually change the loaded track.
//   R3 minimizing Now Playing must NOT interrupt playback (position keeps advancing).
//   R4 during normal playback the activity log must gain ZERO stall events.
//
// The fake engine makes position exact and playback network-free; search still returns real
// rows (an evergreen query), which is why E2E_EXTERNAL is also required. Playback — the
// thing under test — is fully deterministic.

test.describe("playback intent — the owner's R1-R4 repro (deterministic)", () => {
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

  // The fake mirrors a TYPE/LEVEL-only view of the activity log to window.__fuseActivityLog.
  async function stallEventCount(page: Page): Promise<number> {
    return page.evaluate(() => {
      const log = window.__fuseActivityLog ?? [];
      return log.filter((e) => e.type.startsWith("stall-")).length;
    });
  }

  test("R1: opening the app and Now Playing never self-plays", async ({ page }) => {
    const firstYt = await firstYouTube(page);
    await firstYt.getByTestId("result-play").click();
    const mini = page.getByTestId("mini-player");

    // Let it genuinely start, then PAUSE — the user's explicit choice to have no sound.
    await expect.poll(() => posOf(mini), { timeout: 20_000 }).toBeGreaterThan(1);
    await page.getByTestId("mini-play").click(); // pause
    await expect.poll(() => stateOf(mini)).not.toBe("playing");
    const pausedAt = await posOf(mini);

    // Now open and close Now Playing repeatedly. The old bug: each open re-parented the
    // iframe → reload → autoplay re-applied → it self-played. It must stay paused and not
    // jump position.
    for (let i = 0; i < 3; i += 1) {
      await page.getByTestId("mini-open").click();
      await expect(page.getByTestId("now-playing")).toHaveAttribute("data-np-open", "true");
      await page.waitForTimeout(400);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("now-playing")).toHaveAttribute("data-np-open", "false");
    }
    expect(await stateOf(mini)).not.toBe("playing"); // never self-started
    const after = await posOf(mini);
    expect(Math.abs(after - pausedAt)).toBeLessThan(1.5); // position did not run on
  });

  test("R2: pressing Next actually changes the loaded track", async ({ page }) => {
    const firstYt = await firstYouTube(page);
    await firstYt.getByTestId("result-play").click();
    const mini = page.getByTestId("mini-player");
    await expect.poll(() => posOf(mini), { timeout: 20_000 }).toBeGreaterThan(1);

    await page.getByTestId("mini-open").click();
    const np = page.getByTestId("now-playing");
    const titleOf = async () => (await np.locator(".np-title").textContent())?.trim() ?? "";

    const first = await titleOf();
    // Next must be ENABLED (the queue was seeded from the remaining results) …
    const next = page.getByTestId("np-next");
    await expect(next).toBeEnabled();
    await next.click();
    await expect.poll(titleOf, { timeout: 15_000 }).not.toBe(first);
    const second = await titleOf();

    await next.click();
    await expect.poll(titleOf, { timeout: 15_000 }).not.toBe(second);
    const third = await titleOf();

    // Three distinct tracks — never stuck replaying the same one (the "Shape of You" bug),
    // and each advance produced advancing position, not a frozen reload.
    expect(new Set([first, second, third]).size).toBe(3);
    await expect
      .poll(() => posOf(mini), { timeout: 15_000 })
      .toBeGreaterThan(0.5);
  });

  test("R3: minimizing Now Playing keeps the same song playing from where it was", async ({
    page,
  }) => {
    const firstYt = await firstYouTube(page);
    await firstYt.getByTestId("result-play").click();
    const mini = page.getByTestId("mini-player");

    await page.getByTestId("mini-open").click();
    const np = page.getByTestId("now-playing");
    await expect(np).toHaveAttribute("data-np-open", "true");
    const idBefore = (await np.locator(".np-title").textContent())?.trim() ?? "";

    // Play until at least 3s in.
    await expect.poll(() => posOf(mini), { timeout: 25_000 }).toBeGreaterThan(3);
    const before = await posOf(mini);
    const stallsBefore = await stallEventCount(page);

    // Minimize (close) Now Playing — the old bug stopped the song and switched to another.
    await page.keyboard.press("Escape");
    await expect(np).toHaveAttribute("data-np-open", "false");

    // Same track, still playing, position CONTINUED (never reset to 0), no stall spam,
    // no auto-advance to a different id.
    await page.waitForTimeout(1500);
    expect(await stateOf(mini)).toBe("playing");
    const after = await posOf(mini);
    expect(after).toBeGreaterThanOrEqual(before - 0.5); // monotonic, not reset to 0
    await page.getByTestId("mini-open").click();
    const idAfter = (await np.locator(".np-title").textContent())?.trim() ?? "";
    expect(idAfter).toBe(idBefore); // never switched tracks
    expect(await stallEventCount(page)).toBe(stallsBefore); // zero new stall events
  });

  test("R4: no false stall spam during healthy playback, and none while paused/idle", async ({
    page,
  }) => {
    const firstYt = await firstYouTube(page);
    await firstYt.getByTestId("result-play").click();
    const mini = page.getByTestId("mini-player");
    await expect.poll(() => posOf(mini), { timeout: 20_000 }).toBeGreaterThan(1);

    // ~15s of healthy playback (compressed real time): ZERO stall-* events.
    await page.waitForTimeout(15_000);
    expect(await stateOf(mini)).toBe("playing");
    expect(await stallEventCount(page)).toBe(0);

    // Pause and idle ~8s: still nothing, and never an auto-advance.
    const title = await page.evaluate(() => document.querySelector(".mini-title")?.textContent);
    await page.getByTestId("mini-play").click(); // pause
    await page.waitForTimeout(8_000);
    expect(await stallEventCount(page)).toBe(0);
    const titleAfter = await page.evaluate(
      () => document.querySelector(".mini-title")?.textContent,
    );
    expect(titleAfter).toBe(title); // paused/idle never auto-advanced
  });
});
