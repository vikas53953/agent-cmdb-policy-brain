import {
  test,
  expect,
  E2E_READY,
  NOT_READY_REASON,
  E2E_FAKE_ENGINE,
  NO_FAKE_REASON,
  E2E_EXTERNAL,
  NO_EXTERNAL_REASON,
  STABLE,
} from "./fixtures";
import type { Page } from "@playwright/test";

// The maximize/theater toggle on Now Playing (Complaint 2), exercised deterministically
// against the in-DOM fake engine so it never depends on a live embed actually painting.
// Search still returns real rows (an evergreen query), so E2E_EXTERNAL is also required —
// the same gating as the R1-R4 playback specs. The toggle itself is fully deterministic.

test.describe("now playing — video maximize / theater toggle (Complaint 2)", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);
  test.skip(!E2E_FAKE_ENGINE, NO_FAKE_REASON);
  test.skip(!E2E_EXTERNAL, NO_EXTERNAL_REASON);

  async function playFirstYouTubeAndOpenNp(page: Page) {
    await page.getByTestId("tab-search").click();
    await page.getByTestId("search-input").fill(STABLE.query);
    const ytRows = page.locator('[data-testid="search-result"][data-source="youtube"]');
    await expect(ytRows.first()).toBeVisible({ timeout: 30_000 });
    await ytRows.first().getByTestId("result-play").click();
    await page.getByTestId("mini-open").click();
    await expect(page.getByTestId("now-playing")).toHaveAttribute("data-np-open", "true");
  }

  test("maximizing a video expands the art surface, then restores it — no overflow", async ({
    page,
  }) => {
    await playFirstYouTubeAndOpenNp(page);

    // The plain-words "Bigger player" toggle (owner fix 4, replaces the old "theater" word).
    const toggle = page.getByTestId("np-bigger");
    // A video-type track shows the toggle. If the first result classified as an audio
    // upload (rare for this query) it is presented art-forward and there is nothing to
    // enlarge — skip honestly rather than assert a control that correctly isn't there.
    if ((await toggle.count()) === 0) {
      test.skip(true, "First result is an audio-type upload (art-forward, no bigger-player toggle).");
      return;
    }

    const art = page.getByTestId("np-art");
    const stage = page.locator(".np-stage");
    const widthOf = async () => (await art.boundingBox())?.width ?? 0;

    // Normalize to the padded ("smaller") state first — on a desktop viewport a video now
    // opens bigger BY DEFAULT (owner fix 4), so measure from a known baseline rather than
    // assuming off-by-default.
    if ((await stage.getAttribute("data-theater")) === "on") await toggle.click();
    await expect(stage).toHaveAttribute("data-theater", "off");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    const smallerWidth = await widthOf();

    // Bigger → the video expands to the full width of the surface (edge to edge).
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(stage).toHaveAttribute("data-theater", "on");
    await expect
      .poll(widthOf, { message: "Bigger player did not widen the video." })
      .toBeGreaterThan(smallerWidth);

    // The page must not scroll sideways while enlarged (still inline, within the frame).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "Bigger player overflowed the frame horizontally.").toBeLessThanOrEqual(1);

    // Smaller → the surface returns to its normal padded width.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(stage).toHaveAttribute("data-theater", "off");
    await expect.poll(widthOf).toBeLessThanOrEqual(smallerWidth + 1);
  });
});
