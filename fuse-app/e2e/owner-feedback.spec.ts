import { test, expect, requires, STABLE } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

// Owner direct-feedback journeys (the numbered fix list). Playback-dependent checks run
// against the in-DOM FAKE engine so a real transition/overlap is deterministic (search still
// returns real rows, so E2E_EXTERNAL is also required). The pure-DOM checks (carousel cue)
// need only a signed-in robot.

async function firstYouTube(page: Page): Promise<Locator> {
  await page.getByTestId("tab-search").click();
  await page.getByTestId("search-input").fill(STABLE.query);
  const ytRows = page.locator('[data-testid="search-result"][data-source="youtube"]');
  await expect(ytRows.first()).toBeVisible({ timeout: 30_000 });
  return ytRows.first();
}

const posOf = async (mini: Locator) => Number(await mini.getAttribute("data-player-position"));

async function startPlaybackAndOpenNowPlaying(page: Page): Promise<Locator> {
  const firstYt = await firstYouTube(page);
  await firstYt.getByTestId("result-play").click();
  const mini = page.getByTestId("mini-player");
  await expect.poll(() => posOf(mini), { timeout: 20_000 }).toBeGreaterThan(1);
  await page.getByTestId("mini-open").click();
  const np = page.getByTestId("now-playing");
  await expect(np).toHaveAttribute("data-np-open", "true");
  return np;
}

test.describe("Owner feedback — playback journeys (fake engine)", () => {
  requires("fake", "external");

  // Item 1: the sleep-timer popup must render ABOVE the playing video, not behind it.
  test("sleep menu renders above the playing video (portaled overlay wins the stack)", async ({
    page,
  }) => {
    const np = await startPlaybackAndOpenNowPlaying(page);
    // Open the sleep menu from the Now Playing header (this is the exact surface that used to
    // render behind the YouTube iframe).
    await np.getByTestId("sleep-trigger").click();
    const menu = page.getByTestId("sleep-menu");
    await expect(menu).toBeVisible();

    // It escaped to the top-level overlay layer …
    const inOverlay = await menu.evaluate((el) => !!el.closest("#fuse-overlay-root"));
    expect(inOverlay).toBe(true);

    // … and nothing (least of all the video host) is painted over its centre.
    const onTop = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && el.contains(hit);
    });
    expect(onTop).toBe(true);
  });

  // Item 3: a real volume control (slider + mute) wired to playback.
  test("volume control: slider + mute are present and mute toggles state", async ({ page }) => {
    const np = await startPlaybackAndOpenNowPlaying(page);
    const control = np.getByTestId("volume-control");
    await expect(control).toBeVisible();
    await expect(control).toHaveAttribute("data-muted", "false");

    // Mute, then confirm the control reflects the real muted state.
    await np.getByTestId("volume-mute").click();
    await expect(control).toHaveAttribute("data-muted", "true");
    // The slider reads the effective (muted → 0) level.
    await expect(np.getByTestId("volume-range")).toHaveValue("0");

    // Unmute restores.
    await np.getByTestId("volume-mute").click();
    await expect(control).toHaveAttribute("data-muted", "false");
  });

  // Item 2: "Up next" is never empty after a track starts.
  test("queue view is never an empty 'Up next: Nothing' while a track plays", async ({ page }) => {
    await startPlaybackAndOpenNowPlaying(page);
    await page.getByTestId("np-queue").click();
    const queue = page.getByTestId("queue-panel");
    await expect(queue).toHaveAttribute("data-queue-open", "true");
    // There is a real up-next list, not the empty-state message.
    await expect(page.getByTestId("queue-list")).toBeVisible();
    await expect(page.getByTestId("queue-empty")).toHaveCount(0);
  });

  // Item 8: a manual Next produces a genuine audible overlap (the melt engages).
  test("manual Next engages the crossfade melt (a real overlap, not a hard cut)", async ({
    page,
  }) => {
    const np = await startPlaybackAndOpenNowPlaying(page);
    await np.getByTestId("np-next").click();
    // The melt panel renders ONLY while a real two-player blend is underway (it is driven by
    // the same state that ramps the audio), so its appearance is evidence of the overlap.
    await expect(page.getByTestId("video-slot-melt")).toBeVisible({ timeout: 8_000 });
  });

  // Item 9: the Songs filter shows songs (or an honest reason), never a silent empty pane.
  test("Songs filter is populated or honestly explains the empty pane", async ({ page }) => {
    await firstYouTube(page);
    await expect(page.getByTestId("result-filters")).toBeVisible();
    await page.getByTestId("filter-songs").click();
    const rows = page.getByTestId("search-result");
    const songCount = await rows.count();
    if (songCount === 0) {
      // Never a silent blank: an honest explanation must be shown instead.
      await expect(page.getByTestId("filter-empty")).toBeVisible();
    } else {
      // Every shown row is a song (kind is Audio, or a source with no video kind at all).
      const kinds = await page.getByTestId("result-kind").allInnerTexts();
      expect(kinds.every((k) => k.trim() !== "Video")).toBe(true);
    }
  });
});

test.describe("Owner feedback — carousel cue (signed-in robot)", () => {
  requires();

  // Item 7: the left scroll button appears once a rail has been scrolled right.
  test("carousel shows a left scroll button after scrolling right", async ({ page }) => {
    await page.getByTestId("tab-home").click();
    // Home rails only exist when the feed has content; count is instant (no auto-wait), so an
    // empty/short home skips honestly instead of hanging on a missing element.
    const railCount = await page.locator(".rail").count();
    test.skip(railCount === 0, "No home carousel to exercise on this account's feed.");
    const rail = page.locator(".rail").first();

    const overflows = await rail.evaluate((el) => el.scrollWidth > el.clientWidth + 8);
    test.skip(!overflows, "No overflowing carousel to exercise on this account's home feed.");

    await rail.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect(page.locator(".rail-chev-left").first()).toBeVisible();
  });
});
