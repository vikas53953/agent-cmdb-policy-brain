import { test, expect, E2E_READY, NOT_READY_REASON } from "./fixtures";

// F-5 / F-6 / F-7 — the polish fixes from the 2026-07-21 preview QA pass.
//
// F-5: a tab tap produced no visible change anywhere until the whole (server-rendered)
//      route came back, so the PREVIOUS screen sat there looking current.
// F-6: the DJ console threw away the DJ's entire set-up the moment they looked at
//      another tab.
// F-7: an empty My Files deck showed CUE pads (and loops, kills, TAP) that looked live
//      but did nothing, with the reason hidden in a hover tooltip no phone can show.
//
// None of these need a database or external keys — they are app-contract behaviour — so
// they gate on the door secret alone.

// A valid 16-bit mono WAV with a click every beat: real audio Chrome can genuinely decode,
// with no fixture file on disk (so the fingerprint is stable across a navigation).
function clickWav(seconds: number, sampleRate: number, bpm: number): Buffer {
  const numSamples = Math.floor(seconds * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  const period = Math.round((60 / bpm) * sampleRate);
  const burst = Math.round(sampleRate * 0.01);
  for (let i = 0; i < numSamples; i++) {
    let v = 0;
    const phase = i % period;
    if (phase < burst) v = Math.round(32767 * (1 - phase / burst));
    buf.writeInt16LE(v, 44 + i * 2);
  }
  return buf;
}

const SET_WAV = {
  name: "late-night-set.wav",
  mimeType: "audio/wav",
  buffer: clickWav(6, 22050, 120),
};

test.describe("F-5 — a tab tap is acknowledged before the new screen arrives", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);

  test("the tapped tab marks itself pending, and the outgoing screen is marked too", async ({
    page,
  }) => {
    // Watch from inside the page so the first pending frame is caught even when the route
    // comes back quickly — polling from the test process is too coarse to see it.
    await page.evaluate(() => {
      const w = window as unknown as { __sawPending?: { tab: boolean; screen: boolean } };
      w.__sawPending = { tab: false, screen: false };
      const obs = new MutationObserver(() => {
        if (document.querySelector('.tab[data-pending="true"]')) w.__sawPending!.tab = true;
        if (document.querySelector('#main-content[data-nav-pending="true"]'))
          w.__sawPending!.screen = true;
      });
      obs.observe(document.body, { subtree: true, childList: true, attributes: true });
    });

    await page.getByTestId("tab-search").click();
    await expect(page.getByRole("heading", { name: "Search" })).toBeVisible();

    const saw = await page.evaluate(
      () => (window as unknown as { __sawPending: { tab: boolean; screen: boolean } }).__sawPending,
    );
    expect(saw.tab, "the tapped tab never showed a pending state").toBe(true);
    expect(saw.screen, "the outgoing screen was never marked as on its way out").toBe(true);
  });

  test("the pending marks are cleared once the new screen has arrived", async ({ page }) => {
    await page.getByTestId("tab-library").click();
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    // Nothing may stay dimmed or pulsing after the navigation has finished.
    await expect(page.locator('.tab[data-pending="true"]')).toHaveCount(0);
    await expect(page.locator('#main-content[data-nav-pending="true"]')).toHaveCount(0);
  });
});

test.describe("F-7 — an empty deck says why its controls are off, in visible words", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);

  test("My Files with no file: the pads are disabled AND the reason is on screen", async ({
    page,
  }) => {
    await page.getByTestId("tab-dj").click();
    await page.getByTestId("deck-A-source-local").click();
    const deckA = page.getByTestId("deck-A");

    // Every cue pad is genuinely blocked, not just styled as blocked.
    for (const slot of [0, 1, 2, 3]) {
      await expect(page.getByTestId(`deck-A-cue-${slot}`)).toBeDisabled();
    }

    // …and the reason is VISIBLE text, not a hover-only tooltip. This is the F-7 fix:
    // the app's capability-honesty chips now cover the "nothing loaded" case too.
    await expect(deckA.getByText("Load a file first").first()).toBeVisible();
    await expect(deckA.locator(".cap.off")).toHaveCount(4);

    // The "full engine works with My Files" pointer must NOT appear on a My Files deck —
    // it would be telling the DJ to use what they are already using.
    await expect(deckA.getByTestId("caps-pointer")).toHaveCount(0);
  });

  test("the chips light up once a file really is loaded", async ({ page }) => {
    await page.getByTestId("tab-dj").click();
    await page.getByTestId("deck-A-source-local").click();
    const deckA = page.getByTestId("deck-A");
    await deckA.locator('input[type="file"]').setInputFiles(SET_WAV);
    await expect(deckA).toHaveAttribute("data-deck-state", "playing", { timeout: 20_000 });

    await expect(deckA.locator(".cap.on")).toHaveCount(4);
    await expect(deckA.locator(".cap.off")).toHaveCount(0);
    await expect(page.getByTestId("deck-A-cue-0")).toBeEnabled();
  });

  test("a YouTube deck keeps its own honesty (no regression)", async ({ page }) => {
    await page.getByTestId("tab-dj").click();
    await page.getByTestId("deck-B-source-youtube").click();
    const deckB = page.getByTestId("deck-B");
    // The capability reason still wins over the empty-deck reason: loading a video would
    // not give YouTube an EQ, so it must not claim otherwise.
    await expect(deckB.getByText("Not available for YouTube tracks").first()).toBeVisible();
    await expect(deckB.getByTestId("caps-pointer")).toBeVisible();
  });
});

test.describe("F-6 — the DJ console remembers your set across a tab change", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);

  test("EQ, kills, trim, filter, speed, crossfader and curve all survive", async ({ page }) => {
    await page.getByTestId("tab-dj").click();
    await page.getByTestId("deck-A-source-local").click();
    const deckA = page.getByTestId("deck-A");
    await deckA.locator('input[type="file"]').setInputFiles(SET_WAV);
    await expect(deckA).toHaveAttribute("data-deck-state", "playing", { timeout: 20_000 });

    // Set the console up the way a DJ would.
    await page.locator("#deck-A-eq-low").fill("6");
    await page.locator("#deck-A-eq-high").fill("-4");
    await page.getByTestId("deck-A-kill-mid").click();
    await page.locator("#deck-A-trim").fill("0.7");
    await page.locator("#deck-A-filter").fill("-0.4");
    await page.locator("#deck-A-speed").fill("1.25");
    await page.getByTestId("crossfader").fill("0.8");
    await page.getByTestId("crossfader-curve-sharp").click();

    // Go away, come back.
    await page.getByTestId("tab-home").click();
    // Wait for the DJ route to have genuinely gone. `tab-dj` is in the persistent dock, so
    // waiting on it proves nothing — and tapping back before Home has committed lets the
    // router coalesce the two navigations, leaving the console mounted the whole time and
    // this test silently exercising nothing.
    await expect(page.getByRole("heading", { name: "DJ console" })).toHaveCount(0);
    await page.getByTestId("tab-dj").click();
    await expect(page.getByRole("heading", { name: "DJ console" })).toBeVisible();

    // Everything is exactly where it was left.
    await expect(page.getByTestId("deck-A-source-local")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#deck-A-eq-low")).toHaveValue("6");
    await expect(page.locator("#deck-A-eq-high")).toHaveValue("-4");
    await expect(page.getByTestId("deck-A-kill-mid")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#deck-A-trim")).toHaveValue("0.7");
    await expect(page.locator("#deck-A-filter")).toHaveValue("-0.4");
    await expect(page.locator("#deck-A-speed")).toHaveValue("1.25");
    await expect(page.getByTestId("crossfader")).toHaveValue("0.8");
    await expect(page.getByTestId("crossfader-curve-sharp")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("the audio itself is honestly NOT restored — and the deck says so, by name", async ({
    page,
  }) => {
    await page.getByTestId("tab-dj").click();
    await page.getByTestId("deck-A-source-local").click();
    const deckA = page.getByTestId("deck-A");
    await deckA.locator('input[type="file"]').setInputFiles(SET_WAV);
    await expect(deckA).toHaveAttribute("data-deck-state", "playing", { timeout: 20_000 });

    await page.getByTestId("tab-home").click();
    // Wait for the DJ route to have genuinely gone. `tab-dj` is in the persistent dock, so
    // waiting on it proves nothing — and tapping back before Home has committed lets the
    // router coalesce the two navigations, leaving the console mounted the whole time and
    // this test silently exercising nothing.
    await expect(page.getByRole("heading", { name: "DJ console" })).toHaveCount(0);
    await page.getByTestId("tab-dj").click();

    // The file that stayed on the device is named, with the reason in plain words.
    const note = page.getByTestId("deck-A-restore-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText("late-night-set.wav");
    await expect(note).toContainText("stays on your device");
  });

  test("coming back NEVER starts sound on its own", async ({ page }) => {
    await page.getByTestId("tab-dj").click();
    await page.getByTestId("deck-A-source-local").click();
    const deckA = page.getByTestId("deck-A");
    await deckA.locator('input[type="file"]').setInputFiles(SET_WAV);
    await expect(deckA).toHaveAttribute("data-deck-state", "playing", { timeout: 20_000 });

    await page.getByTestId("tab-home").click();
    // Wait for the DJ route to have genuinely gone. `tab-dj` is in the persistent dock, so
    // waiting on it proves nothing — and tapping back before Home has committed lets the
    // router coalesce the two navigations, leaving the console mounted the whole time and
    // this test silently exercising nothing.
    await expect(page.getByRole("heading", { name: "DJ console" })).toHaveCount(0);
    await page.getByTestId("tab-dj").click();
    await expect(page.getByRole("heading", { name: "DJ console" })).toBeVisible();

    // The no-uninvited-music law applies to the decks too: a restored console is silent
    // until the DJ presses play.
    await expect(deckA).not.toHaveAttribute("data-deck-state", "playing");
  });
});
