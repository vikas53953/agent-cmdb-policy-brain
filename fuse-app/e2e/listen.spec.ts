import { test, expect, E2E_READY, NOT_READY_REASON, TEXT, STABLE } from "./fixtures";
import type { Locator } from "@playwright/test";

// THE CORE journey (the heart moment): search → results with REAL loaded covers →
// tap play → the player actually reaches "playing" and its position strictly advances
// (this is what catches the old app's silent stalls) → lyrics scroll or say so
// honestly → like shows up in the Library.
//
// These are outcome assertions on the machine-readable player surface (data-player-
// state / data-player-position on the mini-player), not "the button exists" checks.

test.describe("listen — the heart moment", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);

  // Search for a stable query and return the first playable YouTube result row. Fails
  // LOUDLY (never silently passes) if search returns nothing — that means YouTube
  // search is refusing (quota/keys), which is a real, reportable failure of the core.
  async function searchAndFirstYouTube(page: import("@playwright/test").Page): Promise<Locator> {
    await page.getByTestId("tab-search").click();
    await page.getByTestId("search-input").fill(STABLE.query);

    const results = page.getByTestId("search-results");
    const ytRows = page.locator('[data-testid="search-result"][data-source="youtube"]');
    await expect(
      results,
      "Search returned no results for a stable query — YouTube search is refusing " +
        "(missing YOUTUBE_API_KEY or quota exhausted). The heart moment cannot work.",
    ).toBeVisible({ timeout: 30_000 });
    await expect(ytRows.first(), "No playable YouTube result appeared.").toBeVisible({
      timeout: 30_000,
    });
    return ytRows.first();
  }

  test("covers actually load, play reaches 'playing', and position advances", async ({ page }) => {
    const firstYt = await searchAndFirstYouTube(page);

    // Covers are REAL and LOADED — naturalWidth > 0 catches broken cover art. Check the
    // first few result covers.
    const covers = page.getByTestId("result-cover");
    await expect(covers.first()).toBeVisible({ timeout: 30_000 });
    const coverCount = Math.min(await covers.count(), 4);
    for (let i = 0; i < coverCount; i += 1) {
      await expect
        .poll(
          async () =>
            covers.nth(i).evaluate((img) => (img as HTMLImageElement).naturalWidth),
          {
            message: `Cover #${i} never loaded (naturalWidth stayed 0) — broken cover art.`,
            timeout: 15_000,
          },
        )
        .toBeGreaterThan(0);
    }

    // Tap play on the first YouTube result.
    await firstYt.getByTestId("result-play").click();

    // The player must actually reach "playing" (resilient wait up to 30s for the embed).
    const mini = page.getByTestId("mini-player");
    await expect(
      mini,
      "Player never reached the 'playing' state within 30s — a stall or a refused embed.",
    ).toHaveAttribute("data-player-state", "playing", { timeout: 30_000 });

    // And position must STRICTLY ADVANCE across 5s — a stall would freeze it here.
    const p0 = Number(await mini.getAttribute("data-player-position"));
    await page.waitForTimeout(5_000);
    const state1 = await mini.getAttribute("data-player-state");
    const p1 = Number(await mini.getAttribute("data-player-position"));
    expect(
      p1,
      `Position did not advance in 5s (p0=${p0}, p1=${p1}, state=${state1}). ` +
        "This is exactly the silent-stall bug the tester exists to catch.",
    ).toBeGreaterThan(p0);
  });

  test("Now Playing shows scrolling lyrics or an honest no-lyrics message", async ({ page }) => {
    const firstYt = await searchAndFirstYouTube(page);
    await firstYt.getByTestId("result-play").click();

    const mini = page.getByTestId("mini-player");
    await expect(mini).toHaveAttribute("data-player-state", "playing", { timeout: 30_000 });

    // Open Now Playing.
    await page.getByTestId("mini-open").click();
    const np = page.getByTestId("now-playing");
    await expect(np).toHaveAttribute("data-np-open", "true");

    // Lyrics settle to one of two HONEST outcomes: real synced lyrics (>5 lines with a
    // highlighted active line driven by position), or the plain "no lyrics" message.
    await expect
      .poll(
        async () => {
          const lines = await np.locator(".lyric").count();
          const empty = await np.getByText(TEXT.noLyrics).count();
          const plain = await np.locator(".lyrics-plain").count();
          if (empty > 0) return "empty";
          if (lines > 5) return "synced";
          if (plain > 0) return "plain";
          return "loading";
        },
        {
          message: "Lyrics never settled to synced / plain / honest-empty.",
          timeout: 25_000,
        },
      )
      .not.toBe("loading");

    // If synced lyrics rendered, an active line must be highlighted (the highlight is
    // driven by playback position — proof the scroll mechanism is real, not static).
    if ((await np.locator(".lyric").count()) > 5) {
      await expect(np.locator(".lyric.active").first()).toBeVisible({ timeout: 20_000 });
    }
  });

  test("liking the current track makes it appear in Library → Liked", async ({ page }) => {
    const firstYt = await searchAndFirstYouTube(page);
    const title = (await firstYt.locator(".sresult-title").textContent())?.trim() ?? "";
    await firstYt.getByTestId("result-play").click();

    const mini = page.getByTestId("mini-player");
    await expect(mini).toHaveAttribute("data-player-state", "playing", { timeout: 30_000 });

    await page.getByTestId("mini-open").click();
    const np = page.getByTestId("now-playing");
    const like = np.getByTestId("like-button");
    // The heart is disabled until its saved state loads; wait, then like.
    await expect(like).toBeEnabled({ timeout: 15_000 });
    if ((await like.getAttribute("data-liked")) !== "true") {
      await like.click();
    }
    await expect(
      like,
      "Like did not stick (data-liked stayed false) — the write did not persist " +
        "(needs a database).",
    ).toHaveAttribute("data-liked", "true", { timeout: 15_000 });

    // Close Now Playing and go to the Library → Liked tab; the liked title must be there.
    await page.keyboard.press("Escape");
    await page.getByTestId("tab-library").click();
    await page.getByRole("tab", { name: "Liked" }).click();
    await expect(
      page.getByText(title, { exact: false }).first(),
      `Liked track "${title}" did not appear in Library → Liked.`,
    ).toBeVisible({ timeout: 15_000 });
  });
});
