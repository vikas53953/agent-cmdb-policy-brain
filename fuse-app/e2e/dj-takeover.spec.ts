import {
  test,
  expect,
  E2E_READY,
  NOT_READY_REASON,
  E2E_EXTERNAL,
  NO_EXTERNAL_REASON,
  STABLE,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";

// DJ takeover regression guard (P1). The live bug: tapping the DJ tab SILENTLY paused your
// playing track, never resumed it when you left, and stranded a small uncontrollable YouTube
// chip over the console. The fixed contract, proven end-to-end against the real player:
//   1. Entering DJ while a track plays announces the pause on-screen (never silent).
//   2. No orphaned player chip is left over the console (the persistent host is hidden,
//      because a paused video with no on-screen slot carries no ToS visibility duty).
//   3. Leaving DJ RESUMES the track from where it was — your music is never lost to one tap.

test.describe("dj takeover — pausing is announced, resumes on leave, no orphaned chip (P1)", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);
  test.skip(!E2E_EXTERNAL, NO_EXTERNAL_REASON);

  async function searchAndPlayFirstYouTube(page: Page): Promise<Locator> {
    await page.getByTestId("tab-search").click();
    await page.getByTestId("search-input").fill(STABLE.query);
    const ytRows = page.locator('[data-testid="search-result"][data-source="youtube"]');
    await expect(
      ytRows.first(),
      "Search returned no playable YouTube result for a stable query — YouTube search is " +
        "refusing (keys/quota). The takeover journey cannot start.",
    ).toBeVisible({ timeout: 30_000 });
    await ytRows.first().getByTestId("result-play").click();
    return ytRows.first();
  }

  // Settle to an honest outcome: "playing" (state playing AND position past 0) or "error"
  // (the recovery ladder honestly gave up — e.g. a bot-gated datacenter embed). Never a hang.
  async function settlePlayback(mini: Locator): Promise<"playing" | "error"> {
    await expect
      .poll(
        async () => {
          const state = await mini.getAttribute("data-player-state");
          if (state === "error") return "error";
          const pos = Number(await mini.getAttribute("data-player-position"));
          if (state === "playing" && pos > 0.25) return "playing";
          return "working";
        },
        {
          message:
            "Playback never settled to advancing sound OR an honest error — it hung " +
            "(the silent-stall class). The takeover journey needs a real playing track.",
          timeout: 60_000,
        },
      )
      .not.toBe("working");
    return (await mini.getAttribute("data-player-state")) === "error" ? "error" : "playing";
  }

  test("entering DJ announces the pause and leaves no orphaned chip; leaving resumes", async ({
    page,
  }) => {
    await searchAndPlayFirstYouTube(page);
    const mini = page.getByTestId("mini-player");
    // Only meaningful once a track is genuinely playing. If the embed honestly refuses on
    // this network, the takeover-of-playing-audio scenario does not exist — skip cleanly.
    if ((await settlePlayback(mini)) === "error") {
      test.skip(true, "Embed refused on this network (honest error) — no playing track to take over.");
      return;
    }

    // Let it advance a little so we can prove resume continues (not restart).
    await expect.poll(async () => Number(await mini.getAttribute("data-player-position")), {
      timeout: 20_000,
    }).toBeGreaterThan(2);

    // Enter the DJ console.
    await page.getByTestId("tab-dj").click();

    // (1) The takeover is ANNOUNCED — never silent.
    await expect(
      page.getByTestId("dj-paused-note"),
      "Entering DJ paused the track without telling the user (the silent-stop bug).",
    ).toBeVisible({ timeout: 10_000 });

    // (2) No orphaned player chip over the console: the single persistent host is hidden
    // while the (now paused) main track has no on-screen slot.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const host = document.getElementById("fuse-player-host");
            if (!host) return "none";
            return getComputedStyle(host).display;
          }),
        {
          message:
            "A YouTube player chip is still visible over the DJ console — the orphaned, " +
            "uncontrollable chip the fix removes.",
          timeout: 10_000,
        },
      )
      .toBe("none");

    // (3) Leave DJ → the track RESUMES (not lost, not restarted from 0).
    await page.getByTestId("tab-search").click();
    await expect(mini, "Mini-player did not reappear after leaving DJ.").toBeVisible({
      timeout: 10_000,
    });
    await expect
      .poll(async () => mini.getAttribute("data-player-state"), {
        message: "Leaving DJ did not resume the track — the music was silently lost (P1).",
        timeout: 15_000,
      })
      .toBe("playing");

    // And it keeps advancing after the resume — a real resume, not a frozen frame.
    const p0 = Number(await mini.getAttribute("data-player-position"));
    await page.waitForTimeout(4_000);
    const p1 = Number(await mini.getAttribute("data-player-position"));
    expect(
      p1,
      `Resumed player did not advance after leaving DJ (p0=${p0}, p1=${p1}).`,
    ).toBeGreaterThan(p0);
  });
});
