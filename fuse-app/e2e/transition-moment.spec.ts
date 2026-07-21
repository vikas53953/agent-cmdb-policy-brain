import { test, expect, requires, STABLE } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

// THE TRANSITION MOMENT (F-0 item 1), exercised DETERMINISTICALLY against the in-DOM fake
// engine so the countdown is exact and network-free. Search still returns real rows (an
// evergreen query), so E2E_EXTERNAL is also required — the same gating as the R1-R4 specs.
//
// Contract:
//   • Playing a track with a queued next shows the block with a REAL next-track title.
//   • When the pair can truly fuse (YouTube→YouTube), a live "Fusing in N seconds" countdown
//     appears and VISIBLY counts DOWN as the track advances.
//   • The mini-player carries a compact echo of the same truth.
// Live-tolerant: the strict count-DOWN check only runs once a real fuse is planned; the
// block + next-track title are always asserted.

test.describe("the Transition Moment — NOW / NEXT / fusing countdown (deterministic)", () => {
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

  test("shows NEXT with a real title and a countdown that visibly counts down", async ({
    page,
  }) => {
    const firstYt = await firstYouTube(page);
    // Playing the first result seeds the queue with the remaining results, so there is a
    // genuine NEXT track to tease.
    await firstYt.getByTestId("result-play").click();
    const mini = page.getByTestId("mini-player");
    await expect.poll(() => posOf(mini), { timeout: 20_000 }).toBeGreaterThan(0.5);

    // The compact echo in the mini-player names the next track (honest, always-visible tease).
    const compact = page.getByTestId("transition-moment-compact");
    await expect(compact).toBeVisible({ timeout: 15_000 });
    expect((await compact.locator(".tm-compact-title").textContent())?.trim().length ?? 0)
      .toBeGreaterThan(0);

    // Open Now Playing to see the full hero block.
    await page.getByTestId("mini-open").click();
    await expect(page.getByTestId("now-playing")).toHaveAttribute("data-np-open", "true");

    const block = page.getByTestId("transition-moment");
    await expect(block).toBeVisible({ timeout: 15_000 });
    // A REAL next track title is shown (never blank).
    const nextTitle = (await block.getByTestId("tm-next-title").textContent())?.trim() ?? "";
    expect(nextTitle.length, "The Transition Moment must name a real NEXT track.").toBeGreaterThan(0);

    // A YouTube→YouTube pair can truly fuse: wait for the live countdown to appear (it needs
    // the duration to load), then prove it VISIBLY counts down as playback advances.
    await expect
      .poll(async () => await block.getAttribute("data-fusing-seconds"), {
        message:
          "The fusing countdown never appeared — a YouTube→YouTube pair should show a live " +
          "'Fusing in N seconds' countdown once the duration is known.",
        timeout: 20_000,
      })
      .not.toBeNull();

    const s0 = Number(await block.getAttribute("data-fusing-seconds"));
    expect(await block.getByTestId("tm-countdown").textContent()).toMatch(/Fusing in \d+ second/);
    // Let the track advance a few seconds; the countdown must decrease (never freeze or grow).
    await page.waitForTimeout(4_000);
    const s1 = Number(await block.getAttribute("data-fusing-seconds"));
    expect(
      s1,
      `The fusing countdown did not count down (s0=${s0}, s1=${s1}) — it should shrink as the ` +
        "track approaches the crossfade window.",
    ).toBeLessThan(s0);
  });
});

// The LIVE-TOLERANT check — runs against production in the watchman (no fake engine there,
// so it needs ONLY real search + embed). The block renders from the store's current + queue,
// so it appears with a real NEXT track even if the embed is bot-gated and never advances.
// Tolerant on the countdown: it is only present when the real duration is known, and if
// present it must not GROW (a live clock only counts down or, if frozen, stays put).
test.describe("the Transition Moment — live-tolerant (production)", () => {
  requires("external");

  test("appears with a real NEXT track; any countdown never grows", async ({ page }) => {
    await page.getByTestId("tab-search").click();
    await page.getByTestId("search-input").fill(STABLE.query);
    const ytRows = page.locator('[data-testid="search-result"][data-source="youtube"]');
    await expect(ytRows.first()).toBeVisible({ timeout: 30_000 });
    // Playing the first result hands the rest of the list to the queue, so there is a
    // genuine NEXT track regardless of whether the embed actually starts on this network.
    await ytRows.first().getByTestId("result-play").click();

    await page.getByTestId("mini-open").click();
    await expect(page.getByTestId("now-playing")).toHaveAttribute("data-np-open", "true");

    const block = page.getByTestId("transition-moment");
    await expect(block).toBeVisible({ timeout: 20_000 });
    const nextTitle = (await block.getByTestId("tm-next-title").textContent())?.trim() ?? "";
    expect(
      nextTitle.length,
      "The Transition Moment must name a real NEXT track from the queued results.",
    ).toBeGreaterThan(0);

    // If a live countdown is showing (duration known + a truly fusible pair), it must not
    // grow over a few seconds — a real clock only counts down (or holds if position froze).
    const s0raw = await block.getAttribute("data-fusing-seconds");
    if (s0raw !== null) {
      await page.waitForTimeout(4_000);
      const s1raw = await block.getAttribute("data-fusing-seconds");
      if (s1raw !== null) {
        expect(
          Number(s1raw),
          `The live fusing countdown grew (s0=${s0raw}, s1=${s1raw}) — a countdown must only shrink.`,
        ).toBeLessThanOrEqual(Number(s0raw));
      }
    }
  });
});
