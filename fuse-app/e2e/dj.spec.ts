import {
  test,
  expect,
  E2E_READY,
  NOT_READY_REASON,
  E2E_EXTERNAL,
  NO_EXTERNAL_REASON,
  E2E_DB,
  NO_DB_REASON,
  TEXT,
  STABLE,
} from "./fixtures";

// Build a valid 16-bit mono WAV with a click every beat at `bpm` — a deterministic
// beat the local deck's real BPM detector must find once Chrome decodes it. Returned as
// a Node Buffer so Playwright can hand it to the file input (no fixture file on disk, so
// the fingerprint — and thus the saved cues — are stable across a reload).
function clickWav(seconds: number, sampleRate: number, bpm: number): Buffer {
  const numSamples = Math.floor(seconds * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits/sample
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

const CLICK_WAV = { name: "dj1-clicks-120.wav", mimeType: "audio/wav", buffer: clickWav(6, 22050, 120) };

// DJ console journey. The honesty rules made concrete (R13/R17, AE3/AE4) plus a real
// playing-deck check: a YouTube deck greys out the full-engine controls with a reason
// and keeps speed; loading a known video really advances; Spotify is honest about not
// playing yet; My Files reflects its current (now-live) support.

test.describe("dj — capability honesty and a really-playing deck", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);

  test("Deck A on YouTube: EQ/Loops/FX/Scratch disabled with a reason, speed present", async ({
    page,
  }) => {
    await page.getByTestId("tab-dj").click();
    const deckA = page.getByTestId("deck-A");
    await page.getByTestId("deck-A-source-youtube").click();

    // The full-engine powers render as greyed capability chips carrying the YouTube
    // reason — never live knobs (AE3). The interactive EQ ranges / Loop / Echo buttons
    // (which only exist for a My Files deck) are absent here.
    await expect(deckA.getByText(TEXT.ytCapabilityReason).first()).toBeVisible();
    await expect(deckA.locator(".cap.off")).not.toHaveCount(0);
    await expect(deckA.locator(".deck-eq-range")).toHaveCount(0);
    await expect(deckA.getByRole("button", { name: /^Loop$|^Echo$/ })).toHaveCount(0);

    // Speed control is present (it is the one full-engine-adjacent control YouTube keeps).
    await expect(deckA.getByRole("slider", { name: /playback speed/i })).toBeVisible();
  });

  test("Deck A on YouTube: a known video loads and the deck really advances", async ({ page }) => {
    test.skip(!E2E_EXTERNAL, NO_EXTERNAL_REASON);
    await page.getByTestId("tab-dj").click();
    const deckA = page.getByTestId("deck-A");
    await page.getByTestId("deck-A-source-youtube").click();

    await page.getByTestId("deck-A-link").fill(STABLE.youtubeVideoId);
    await page.getByTestId("deck-A-load").click();

    await expect(
      deckA,
      "Deck A never reached 'playing' within 30s — a refused embed or a stall.",
    ).toHaveAttribute("data-deck-state", "playing", { timeout: 30_000 });

    const p0 = Number(await deckA.getAttribute("data-deck-position"));
    await page.waitForTimeout(5_000);
    const p1 = Number(await deckA.getAttribute("data-deck-position"));
    expect(
      p1,
      `Deck A position did not advance in 5s (p0=${p0}, p1=${p1}) — the deck is stalled.`,
    ).toBeGreaterThan(p0);
  });

  test("Spotify on a deck is honest that playback is not wired yet", async ({ page }) => {
    await page.getByTestId("tab-dj").click();
    await page.getByTestId("deck-B-source-spotify").click();
    // The deck states plainly, in plain English, that Spotify playback is not available.
    await expect(page.getByTestId("deck-B").locator(".deck-notice")).toBeVisible();
  });

  test("Spotify locks the OTHER deck (one deck at a time — AE4)", async ({ page }) => {
    await page.getByTestId("tab-dj").click();
    await page.getByTestId("deck-A-source-spotify").click();

    // Deck B's Spotify option is now locked with its reason.
    const spotifyOnB = page.getByTestId("deck-B-source-spotify");
    await expect(spotifyOnB).toBeDisabled();
    await expect(page.getByTestId("deck-B").getByText(TEXT.spotifyOneDeck)).toBeVisible();
  });

  test("My Files reflects current support (local engine is live)", async ({ page }) => {
    await page.getByTestId("tab-dj").click();
    // U14 flipped My Files live, so the source option is now SELECTABLE (not locked).
    const localOnA = page.getByTestId("deck-A-source-local");
    await expect(localOnA).toBeEnabled();
    await localOnA.click();
    // Selecting it surfaces the on-device promise (files never uploaded — R14).
    await expect(page.getByTestId("deck-A").getByText(new RegExp(TEXT.onDeviceNotice))).toBeVisible();
  });
});

// DJ-1 local-file deck: the real "now it's a tool" surface. These drive an ACTUAL local
// deck — a generated click WAV decoded in the browser by Web Audio — and assert the
// waveform, detected BPM, hot cues, beat loops, EQ kills and crossfader curve are real
// controls, not decoration. Deterministic where the harness allows (the WAV's tempo is
// known, so the detected BPM is checkable with real numbers).
test.describe("dj — local-file deck controls (DJ-1)", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);

  async function loadLocalDeckA(page: import("@playwright/test").Page) {
    await page.getByTestId("tab-dj").click();
    await page.getByTestId("deck-A-source-local").click();
    const deckA = page.getByTestId("deck-A");
    await deckA.locator('input[type="file"]').setInputFiles(CLICK_WAV);
    // The deck decodes and starts playing on the same gesture.
    await expect(
      deckA,
      "Deck A never reached 'playing' after loading a local file — decode or Web Audio failed.",
    ).toHaveAttribute("data-deck-state", "playing", { timeout: 20_000 });
    return deckA;
  }

  test("a local file decodes: waveform shows, position advances, BPM is detected", async ({ page }) => {
    const deckA = await loadLocalDeckA(page);

    // The waveform (only a local deck has samples to draw) is present.
    await expect(page.getByTestId("deck-A-waveform")).toBeVisible();

    // The playhead really advances (real decoded playback, not a faked clock).
    const p0 = Number(await deckA.getAttribute("data-deck-position"));
    await page.waitForTimeout(2_000);
    const p1 = Number(await deckA.getAttribute("data-deck-position"));
    expect(p1, `deck position did not advance (p0=${p0}, p1=${p1})`).toBeGreaterThan(p0);

    // The BPM detector found the WAV's real 120 BPM tempo (a real number, not a guess).
    const bpm = Number(await deckA.getAttribute("data-deck-bpm"));
    expect(bpm, `expected ~120 BPM detected, got ${bpm}`).toBeGreaterThan(108);
    expect(bpm).toBeLessThan(132);
  });

  test("hot cue: setting a pad shows a clear affordance; clearing removes it", async ({ page }) => {
    await loadLocalDeckA(page);
    // Empty pad → no clear button yet.
    await expect(page.getByTestId("deck-A-cue-0-clear")).toHaveCount(0);
    // Set cue 1 at the playhead.
    await page.getByTestId("deck-A-cue-0").click();
    await expect(page.getByTestId("deck-A-cue-0-clear")).toBeVisible();
    // Clear it.
    await page.getByTestId("deck-A-cue-0-clear").click();
    await expect(page.getByTestId("deck-A-cue-0-clear")).toHaveCount(0);
  });

  test("beat loop, EQ kill and crossfader curve are real toggles", async ({ page }) => {
    await loadLocalDeckA(page);

    const loop = page.getByTestId("deck-A-loop-4");
    await loop.click();
    await expect(loop).toHaveAttribute("aria-pressed", "true");
    await loop.click();
    await expect(loop).toHaveAttribute("aria-pressed", "false");

    const kill = page.getByTestId("deck-A-kill-low");
    await kill.click();
    await expect(kill).toHaveAttribute("aria-pressed", "true");

    const sharp = page.getByTestId("crossfader-curve-sharp");
    await sharp.click();
    await expect(sharp).toHaveAttribute("aria-pressed", "true");
  });
});

// Cue PERSISTENCE — only meaningful against a real database (the watchman's production
// run sets E2E_DB=1). Set a cue, reload, re-load the SAME file (same on-device
// fingerprint), and the cue comes back from the user's saved rows.
test.describe("dj — hot cues persist per user + track (DJ-1)", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);
  test.skip(!E2E_DB, NO_DB_REASON);

  test("a cue set on a local track is remembered after reload", async ({ page }) => {
    await page.getByTestId("tab-dj").click();
    await page.getByTestId("deck-A-source-local").click();
    const deckA = page.getByTestId("deck-A");
    await deckA.locator('input[type="file"]').setInputFiles(CLICK_WAV);
    await expect(deckA).toHaveAttribute("data-deck-state", "playing", { timeout: 20_000 });

    // Set cue 2 and let the write land.
    await page.getByTestId("deck-A-cue-1").click();
    await expect(page.getByTestId("deck-A-cue-1-clear")).toBeVisible();
    await page.waitForTimeout(1_000);

    // Reload, re-open the deck, re-load the same file → its saved cues return.
    await page.reload();
    await page.getByTestId("tab-dj").click();
    await page.getByTestId("deck-A-source-local").click();
    const deckA2 = page.getByTestId("deck-A");
    await deckA2.locator('input[type="file"]').setInputFiles(CLICK_WAV);
    await expect(deckA2).toHaveAttribute("data-deck-state", "playing", { timeout: 20_000 });
    await expect(
      page.getByTestId("deck-A-cue-1-clear"),
      "The cue did not come back after reload — persistence via the repos layer failed.",
    ).toBeVisible({ timeout: 10_000 });
  });
});
