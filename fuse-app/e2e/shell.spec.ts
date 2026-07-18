import { test, expect, E2E_READY, NOT_READY_REASON } from "./fixtures";
import type { ConsoleMessage } from "@playwright/test";

// App shell journey: every tab navigates, the profile-sheet settings actually persist
// across a reload (crossfade length, lyrics on/off), and no page logs a real app-level
// console error (third-party embed noise is filtered out).

test.describe("shell — navigation, persistence, console health", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);

  test("every tab navigates to its route", async ({ page }) => {
    await page.goto("/");
    const tabs: [string, RegExp][] = [
      ["tab-search", /\/search$/],
      ["tab-dj", /\/dj$/],
      ["tab-library", /\/library$/],
      ["tab-home", /\/$/],
    ];
    for (const [tid, url] of tabs) {
      await page.getByTestId(tid).click();
      await expect(page).toHaveURL(url);
    }
  });

  test("crossfade length persists after a reload", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("open-settings").click();
    await expect(page.getByTestId("profile-sheet")).toBeVisible();

    const slider = page.getByTestId("crossfade-range");
    const before = Number(await slider.inputValue());
    const max = Number(await slider.getAttribute("max"));
    const min = Number(await slider.getAttribute("min"));
    // Nudge to a definitely-different value and let the commit (pointer/key up) fire.
    await slider.focus();
    await slider.press(before < max ? "ArrowRight" : "ArrowLeft");
    const after = Number(await slider.inputValue());
    expect(after).not.toBe(before);
    expect(after).toBeGreaterThanOrEqual(min);
    // Give the persist a beat, then reload and re-open settings.
    await page.waitForTimeout(1_000);

    await page.reload();
    await page.getByTestId("open-settings").click();
    await expect(
      page.getByTestId("crossfade-range"),
      "Crossfade length did not persist across reload (write did not stick — needs a database).",
    ).toHaveValue(String(after), { timeout: 15_000 });
  });

  test("lyrics on/off persists after a reload", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("open-settings").click();
    const toggle = page.getByTestId("lyrics-toggle");
    await expect(toggle).toBeVisible();
    const before = await toggle.getAttribute("aria-checked");
    await toggle.click();
    const after = before === "true" ? "false" : "true";
    await expect(toggle).toHaveAttribute("aria-checked", after);
    await page.waitForTimeout(1_000);

    await page.reload();
    await page.getByTestId("open-settings").click();
    await expect(
      page.getByTestId("lyrics-toggle"),
      "Lyrics setting did not persist across reload (write did not stick — needs a database).",
    ).toHaveAttribute("aria-checked", after, { timeout: 15_000 });
  });

  // Third-party embed / browser noise that is NOT an app bug. YouTube's iframe, its
  // CDNs, and some browser-internal messages emit console errors we do not own.
  const NOISE = [
    /youtube\.com/i,
    /ytimg\.com/i,
    /gstatic\.com/i,
    /googlevideo\.com/i,
    /doubleclick/i,
    /scdn\.co/i,
    /play\.google/i,
    /postMessage/i,
    /ResizeObserver/i,
    /favicon/i,
    /Failed to load resource/i, // network-level, not an app exception
  ];
  const isNoise = (text: string, location: string) =>
    NOISE.some((re) => re.test(text) || re.test(location));

  for (const path of ["/", "/search", "/dj", "/library"]) {
    test(`no app console errors on ${path}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (msg: ConsoleMessage) => {
        if (msg.type() !== "error") return;
        const loc = msg.location()?.url ?? "";
        if (!isNoise(msg.text(), loc)) errors.push(`${msg.text()} @ ${loc}`);
      });
      page.on("pageerror", (err) => {
        if (!isNoise(err.message, "")) errors.push(`pageerror: ${err.message}`);
      });

      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1_500);

      expect(errors, `App-level console errors on ${path}:\n${errors.join("\n")}`).toHaveLength(0);
    });
  }
});
