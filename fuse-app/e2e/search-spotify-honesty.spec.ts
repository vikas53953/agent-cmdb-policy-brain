import { test, expect, requires, STABLE } from "./fixtures";

// Spotify search honesty guard (P1). The live bug: EVERY search was topped with
// "Spotify search is unavailable right now — try again". Spotify search is persistently
// down on the deployment (blocked/absent app credential), so "try again" misled every
// user into re-running a query that could never succeed. The fixed contract: when a source
// is unavailable the app says so CALMLY and never invites a pointless retry.
//
// This runs deterministically in the release gate: with no SPOTIFY_CLIENT_ID/SECRET on the
// runner, /api/search reports Spotify unavailable and the search screen shows its honest
// notice — no external keys required. If a deployment DID have working Spotify creds, the
// notice is simply absent and the guard still holds (nothing misleading is shown).

test.describe("search — Spotify unavailability is stated calmly, never a false 'try again' (P1)", () => {
  requires();

  test("no search notice invites a pointless retry when Spotify search is down", async ({
    page,
  }) => {
    await page.getByTestId("tab-search").click();
    await page.getByTestId("search-input").fill(STABLE.query);

    // Wait for the query to settle (either results or source notices — not mid-type).
    await expect(page.getByText("Searching…")).toHaveCount(0, { timeout: 30_000 });

    // The exact misleading banner the fix removes must never appear.
    await expect(
      page.getByText("Spotify search is unavailable right now — try again"),
      "The old misleading 'try again' Spotify banner is back — retrying never helps, so it lies.",
    ).toHaveCount(0);

    // Any source-level notice that IS shown must be honest and calm — never "try again".
    const notices = page.locator(".search-notice");
    const count = await notices.count();
    for (let i = 0; i < count; i += 1) {
      const text = ((await notices.nth(i).textContent()) ?? "").toLowerCase();
      expect(
        text,
        `A search notice invites a retry that cannot help: "${text}".`,
      ).not.toContain("try again");
    }
  });
});
