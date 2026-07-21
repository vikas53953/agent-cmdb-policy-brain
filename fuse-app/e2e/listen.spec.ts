import { test, expect, requires, TEXT, STABLE } from "./fixtures";
import type { Locator } from "@playwright/test";

// THE CORE journey (the heart moment): search → results with REAL loaded covers →
// tap play → the player actually reaches "playing" and its position strictly advances
// (this is what catches the old app's silent stalls) → lyrics scroll or say so
// honestly → like shows up in the Library.
//
// These are outcome assertions on the machine-readable player surface (data-player-
// state / data-player-position on the mini-player), not "the button exists" checks.

test.describe("listen — the heart moment", () => {
  requires("external");

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

  // Wait for the recovery ladder to reach a STABLE, HONEST outcome and return it:
  //   • "playing" — a track is genuinely producing sound (state "playing" AND position
  //     has moved past 0), or
  //   • "error"   — the ladder tried retry → recreate → the next results and honestly
  //     gave up (state "error", with a working Skip).
  // A transient "playing" at position 0 (a just-(re)loaded track in its grace window,
  // or one the ladder is about to advance past) is NOT a settled outcome — we keep
  // polling. It fails loudly only if NEITHER honest outcome is reached, i.e. the app
  // hung in loading/stalled ("retrying") — the exact silent-stall class this tester
  // exists to catch. The generous window fits the whole bounded ladder (well under the
  // 120s per-test timeout).
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
            "Playback never settled to real advancing sound OR an honest error+skip — " +
            "it hung in loading/stalled ('retrying'), which is exactly the silent-stall " +
            "bug the tester exists to catch.",
          timeout: 60_000,
        },
      )
      .not.toBe("working");
    return (await mini.getAttribute("data-player-state")) === "error" ? "error" : "playing";
  }

  test("covers load, and playback either advances OR recovers to an honest error+skip", async ({
    page,
  }) => {
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

    const mini = page.getByTestId("mini-player");

    // THE REAL OUTCOME CONTRACT (the class fix). The bounded recovery ladder must settle
    // to one of exactly TWO HONEST outcomes — never a silent hang, never an endless
    // "retrying". settlePlayback fails loudly if it hangs instead.
    const outcome = await settlePlayback(mini);

    if (outcome === "error") {
      // Honest refusal terminal (e.g. a bot-gated datacenter IP where YouTube embeds
      // won't play). The app admitted it rather than freezing. Open Now Playing and prove
      // a real Skip is offered — never a dead end (AE1).
      await page.getByTestId("mini-open").click();
      const skip = page.getByTestId("np-skip");
      await expect(
        skip,
        "Honest error state must offer a working Skip — never a silent freeze (AE1).",
      ).toBeVisible({ timeout: 5_000 });
      return;
    }

    // Playable path: position must KEEP advancing across 5s — a stall would freeze it.
    // (settlePlayback already proved it passed 0; this proves it keeps moving.) An honest
    // degrade to "error" in the meantime is still acceptable — it never lied about playing.
    const p0 = Number(await mini.getAttribute("data-player-position"));
    await page.waitForTimeout(5_000);
    const state1 = await mini.getAttribute("data-player-state");
    const p1 = Number(await mini.getAttribute("data-player-position"));
    if (state1 === "error") return; // degraded honestly — acceptable outcome
    expect(
      p1,
      `Position did not advance in 5s (p0=${p0}, p1=${p1}, state=${state1}) and the app ` +
        "did not surface an honest error either — it hung in the silent-stall bug.",
    ).toBeGreaterThan(p0);
  });

  test("open→minimize does not reload the video (same track, position keeps going)", async ({
    page,
  }) => {
    // The ownership-model regression guard against LIVE YouTube: proves that opening then
    // minimizing Now Playing does not re-parent (and therefore reload) the iframe. A reload
    // would reset position to 0 and could switch the track. Skips honestly if the embed
    // refuses on this network (the recovery terminal), which is not what this test asserts.
    const firstYt = await searchAndFirstYouTube(page);
    await firstYt.getByTestId("result-play").click();
    const mini = page.getByTestId("mini-player");
    if ((await settlePlayback(mini)) === "error") return;

    await page.getByTestId("mini-open").click();
    const np = page.getByTestId("now-playing");
    await expect(np).toHaveAttribute("data-np-open", "true");
    const titleBefore = (await np.locator(".np-title").textContent())?.trim() ?? "";

    // Let it advance past ~3s inside Now Playing.
    await expect
      .poll(async () => Number(await mini.getAttribute("data-player-position")), {
        timeout: 30_000,
      })
      .toBeGreaterThan(3);
    const before = Number(await mini.getAttribute("data-player-position"));

    // Minimize. A reparent-reload would snap position back to ~0.
    await page.keyboard.press("Escape");
    await expect(np).toHaveAttribute("data-np-open", "false");
    await page.waitForTimeout(1500);

    const after = Number(await mini.getAttribute("data-player-position"));
    expect(
      after,
      `Minimizing reset position (${before} → ${after}) — the iframe was re-parented and ` +
        "reloaded. The single-persistent-host model must move it by geometry, not appendChild.",
    ).toBeGreaterThan(before - 1);
    await page.getByTestId("mini-open").click();
    const titleAfter = (await np.locator(".np-title").textContent())?.trim() ?? "";
    expect(titleAfter, "Minimizing switched the track — a reload side effect.").toBe(titleBefore);
  });

  test("opening Now Playing on a paused track does not self-start playback", async ({ page }) => {
    // Proves autoplay:0 + the intent gate against LIVE YouTube: a reparent-reload used to
    // re-apply autoplay and self-play on open (R1). Pause, then open NP — it must stay paused.
    const firstYt = await searchAndFirstYouTube(page);
    await firstYt.getByTestId("result-play").click();
    const mini = page.getByTestId("mini-player");
    if ((await settlePlayback(mini)) === "error") return;

    await page.getByTestId("mini-play").click(); // pause
    await expect
      .poll(async () => mini.getAttribute("data-player-state"))
      .not.toBe("playing");

    await page.getByTestId("mini-open").click();
    await expect(page.getByTestId("now-playing")).toHaveAttribute("data-np-open", "true");
    await page.waitForTimeout(1500);
    expect(
      await mini.getAttribute("data-player-state"),
      "Opening Now Playing self-started audio — autoplay-on-reload regressed (R1).",
    ).not.toBe("playing");
  });

  test("Now Playing shows scrolling lyrics or an honest no-lyrics message", async ({ page }) => {
    // Lyrics can be turned OFF in settings (a real, persisted user choice), which hides
    // the panel entirely — so this spec first makes the setting deterministic by ensuring
    // it is ON. Without this the test depends on whatever the robot user's setting happens
    // to be and can wait forever on a hidden panel.
    await page.getByTestId("open-settings").click();
    const lyricsToggle = page.getByTestId("lyrics-toggle");
    await expect(lyricsToggle).toBeVisible({ timeout: 10_000 });
    if ((await lyricsToggle.getAttribute("aria-checked")) !== "true") {
      await lyricsToggle.click();
      await expect(lyricsToggle).toHaveAttribute("aria-checked", "true", { timeout: 10_000 });
    }
    await page.keyboard.press("Escape"); // close the profile sheet
    // The sheet slides off-screen via a CSS transform (so Playwright still counts it
    // "visible"); its closed state is honestly marked by aria-hidden="true".
    await expect(page.getByTestId("profile-sheet")).toHaveAttribute("aria-hidden", "true", {
      timeout: 10_000,
    });

    const firstYt = await searchAndFirstYouTube(page);
    await firstYt.getByTestId("result-play").click();

    const mini = page.getByTestId("mini-player");
    // Lyrics load from the track's title/artist independent of whether the embed plays,
    // so we only need the player to SETTLE (playing or an honest error) — never hang.
    await settlePlayback(mini);

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
          // Plain (unsynced) lyrics now live behind a compact "Lyrics" toggle (owner fix 5b)
          // so a wall of text never pushes the transport off-screen — the toggle button (or
          // the expanded panel) is the honest signal of the plain state.
          const plain =
            (await np.getByTestId("plain-lyrics-toggle").count()) +
            (await np.locator(".lyrics-plain").count());
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
    requires("db");
    const firstYt = await searchAndFirstYouTube(page);
    await firstYt.getByTestId("result-play").click();

    const mini = page.getByTestId("mini-player");
    // The recovery ladder may auto-advance to an alternate result when the first refuses,
    // so the CURRENT track is whatever finally settled — read its real title from Now
    // Playing rather than assuming it stayed the first result. Liking works whether the
    // track plays or honestly errored (the track is still current).
    await settlePlayback(mini);

    await page.getByTestId("mini-open").click();
    const np = page.getByTestId("now-playing");
    const title = (await np.locator(".np-title").textContent())?.trim() ?? "";
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
