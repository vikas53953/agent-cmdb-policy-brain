import { test, expect, E2E_READY, NOT_READY_REASON, TEXT, STABLE } from "./fixtures";
import type { Page } from "@playwright/test";

// AE2 — a track with NO lyrics shows an honest message, never an empty panel and never a
// spinner that spins forever.
//
// WHY THIS SPEC EXISTS (audit finding 37). The behaviour ships at lib/lyrics.ts (an
// instrumental / lyric-less record is a definitive found:false MISS, not a failure) and
// components/player/lyrics.tsx (the `none` state renders the plain empty message), but
// nothing pinned it. listen.spec.ts's lyrics test accepts synced OR plain OR empty, so it
// passes without ever exercising the empty state — AE2 had no test of its own.
//
// THE DISTINCTION THIS SPEC PROTECTS. "This song has no lyrics" and "we couldn't load the
// lyrics" are DIFFERENT facts and must read differently to the user. Telling someone a
// song has no lyrics when LRCLIB merely fell over is a lie the app tells confidently.
// So this spec drives the definitive-miss answer (found:false) specifically, and the
// second test proves the server-error path does NOT get reported as "no lyrics".
//
// DETERMINISM: no real track is reliably lyric-less forever, and LRCLIB is an external
// service that is neither gated nor guaranteed on a bare run. Both the search answer and
// the lyrics answer are therefore served from stubs, so the state under test is reached
// exactly and every time. The panel, its fetch handling and its copy are the app's real
// code. Nothing external is needed, so this spec RUNS on any provisioned run rather than
// skipping — AE2 gates for real.

const PROBE_QUERY = "robot lyrics probe";
const PROBE_TITLE = "Robot Lyrics Probe";

const YOUTUBE_TRACK = {
  source: "youtube",
  nativeId: STABLE.youtubeVideoId,
  title: PROBE_TITLE,
  artist: "Fuse Robot",
  artUrl: null,
  durationSec: 213,
};

async function stubSearch(page: Page): Promise<void> {
  await page.route("**/api/search**", async (route) => {
    const q = (new URL(route.request().url()).searchParams.get("q") ?? "").trim();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        query: q,
        cached: false,
        results: q === PROBE_QUERY ? [YOUTUBE_TRACK] : [],
        sources: {
          youtube: { available: true, reason: null },
          spotify: { available: true, reason: null },
        },
      }),
    });
  });
}

// Lyrics are a real, persisted user setting that HIDES the panel when off. Make it
// deterministic before asserting anything about the panel, or the spec silently depends
// on whatever the robot user last chose.
async function ensureLyricsOn(page: Page): Promise<void> {
  await page.getByTestId("open-settings").click();
  const toggle = page.getByTestId("lyrics-toggle");
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  if ((await toggle.getAttribute("aria-checked")) !== "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 10_000 });
  }
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("profile-sheet")).toHaveAttribute("aria-hidden", "true", {
    timeout: 10_000,
  });
}

// Play the probe track and open Now Playing. Lyrics load from title/artist and the store
// focuses the track BEFORE the engine starts, so the panel renders whether or not the
// embed can actually play here — this spec needs no playback engine.
async function openNowPlayingOnProbe(page: Page): Promise<ReturnType<Page["getByTestId"]>> {
  await page.getByTestId("tab-search").click();
  await page.getByTestId("search-input").fill(PROBE_QUERY);
  const row = page.locator('[data-testid="search-result"][data-source="youtube"]').first();
  await expect(row, "The stubbed probe track never rendered.").toBeVisible({ timeout: 30_000 });
  await row.getByTestId("result-play").click();

  await page.getByTestId("mini-open").click();
  const np = page.getByTestId("now-playing");
  await expect(np).toHaveAttribute("data-np-open", "true");
  return np;
}

test.describe("AE2 — a track with no lyrics says so honestly", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);

  test("a definitive no-lyrics answer shows the plain message, not a blank panel or a spinner", async ({
    page,
  }) => {
    await stubSearch(page);
    // The DEFINITIVE miss: LRCLIB knows this track and it genuinely has no lyrics
    // (instrumental, or a record with neither synced nor plain text). This is the state
    // AE2 is about — not a failure, an answer.
    await page.route("**/api/lyrics**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ found: false, synced: null, plain: null }),
      });
    });

    await ensureLyricsOn(page);
    const np = await openNowPlayingOnProbe(page);

    // The honest message, asserted verbatim — this sentence IS the contract.
    await expect(
      np.getByText(TEXT.noLyrics),
      "A track with no lyrics did not say so. AE2 requires an honest message here — an " +
        "empty panel or a spinner leaves the user guessing whether the app is broken.",
    ).toBeVisible({ timeout: 25_000 });

    // It SETTLED: the spinner is gone, not merely overlapped. A never-resolving
    // "Loading lyrics…" is the exact silent-hang class this app kills.
    await expect(
      np.getByText("Loading lyrics…"),
      "The lyrics panel is still loading alongside the empty message — it never settled.",
    ).toHaveCount(0);

    // And the panel is not blank: the message is the visible content of the lyrics region.
    const panel = np.locator(".lyrics");
    await expect(panel, "No lyrics panel rendered at all — AE2's empty-panel failure.").toBeVisible();
    expect(
      ((await panel.textContent()) ?? "").trim(),
      "The lyrics panel rendered but is empty.",
    ).not.toBe("");

    // NOT AN ERROR STATE. "No lyrics for this song" and "couldn't load the lyrics" are two
    // different facts; this test drives the first and must never be satisfied by the
    // second. If a future change routes failures through this same message, this fails.
    await expect(
      np.locator('[data-testid="lyrics-error"]'),
      "An error state is showing for a track that definitively has no lyrics — the two " +
        "states are being conflated.",
    ).toHaveCount(0);
    expect(
      ((await panel.textContent()) ?? "").toLowerCase(),
      "The no-lyrics message is worded as a failure — it should state a fact about the " +
        "song, not blame a load that actually succeeded.",
    ).not.toMatch(/couldn'?t load|could not load|try again|went wrong|failed/);
  });

  test("a lyrics SERVER ERROR is not reported as 'this song has no lyrics'", async ({ page }) => {
    // The other side of the distinction. When the lyrics service falls over, the app must
    // not tell the user a fact it does not know. It may say it could not load them, or say
    // nothing — but claiming the song has no lyrics is a confident lie.
    //
    // NOTE (in-flight): components/player/lyrics.tsx currently funnels its fetch `.catch`
    // into the same `none` state, so this asserts the intended distinction ahead of the
    // fix landing. It is the pin for that fix, not a regression introduced here.
    await stubSearch(page);
    await page.route("**/api/lyrics**", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "lyrics service unavailable" }),
      });
    });

    await ensureLyricsOn(page);
    const np = await openNowPlayingOnProbe(page);

    // It must still SETTLE — a failed load is never an excuse for an endless spinner.
    await expect
      .poll(async () => np.getByText("Loading lyrics…").count(), {
        message:
          "The lyrics panel spun forever after a failed load — a bounded, honest outcome " +
          "is required either way.",
        timeout: 25_000,
      })
      .toBe(0);

    // …but it must NOT claim the song has no lyrics.
    await expect(
      np.getByText(TEXT.noLyrics),
      "A lyrics service failure was reported to the user as 'this song has no lyrics'. " +
        "The app does not know that — it only knows it could not load them.",
    ).toHaveCount(0);
  });
});
