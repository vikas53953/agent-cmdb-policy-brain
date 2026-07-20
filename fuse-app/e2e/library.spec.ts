import { test, expect, E2E_READY, NOT_READY_REASON, E2E_DB, NO_DB_REASON, STABLE } from "./fixtures";

// Library journey: create a playlist, add a real track to it via the + flow, see the
// count become 1, rename it, delete it. Every step is a persisted write, so this whole
// spec depends on a database being reachable — on a DB-less run it fails at the first
// write, which is reported honestly (an environment limitation, not a pass).

test.describe("library — playlists CRUD", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);
  test.skip(!E2E_DB, NO_DB_REASON);

  test("create → add a track → count 1 → rename → delete", async ({ page }) => {
    const name = `Robot ${Date.now()}`;
    const renamed = `${name} (renamed)`;

    // 1) Create the playlist in Library → Playlists.
    await page.getByTestId("tab-library").click();
    await page.getByRole("tab", { name: "Playlists" }).click();
    await page.getByTestId("playlist-name").fill(name);
    await page.getByTestId("playlist-create").click();

    const card = page.locator(`[data-testid="playlist-card"][data-playlist-name="${name}"]`);
    await expect(
      card,
      "Playlist was not created (write did not persist — needs a database).",
    ).toBeVisible({ timeout: 15_000 });
    await expect(card).toHaveAttribute("data-track-count", "0");

    // 2) Add a real track via the + flow on a search result.
    await page.getByTestId("tab-search").click();
    await page.getByTestId("search-input").fill(STABLE.query);
    const firstResult = page.getByTestId("search-result").first();
    await expect(
      firstResult,
      "Search returned nothing — cannot exercise the add-to-playlist flow.",
    ).toBeVisible({ timeout: 30_000 });

    // Open the "add to a playlist" menu on the first result and pick our playlist.
    await firstResult.getByRole("button", { name: /Add .* to a playlist/ }).click();
    const menu = firstResult.getByRole("menu");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name }).click();
    await expect(firstResult.getByText(/Added to/)).toBeVisible({ timeout: 15_000 });

    // 3) Back in the Library, the playlist now holds exactly one track.
    await page.getByTestId("tab-library").click();
    await page.getByRole("tab", { name: "Playlists" }).click();
    await expect(card).toHaveAttribute("data-track-count", "1", { timeout: 15_000 });

    // 4) Rename it.
    await card.getByRole("button", { name: `Rename ${name}` }).click();
    const renameInput = card.getByRole("textbox", { name: `Rename ${name}` });
    await renameInput.fill(renamed);
    await renameInput.press("Enter");
    const renamedCard = page.locator(
      `[data-testid="playlist-card"][data-playlist-name="${renamed}"]`,
    );
    await expect(renamedCard, "Rename did not persist.").toBeVisible({ timeout: 15_000 });

    // 5) Delete it. Deleting now ASKS first — a playlist can't vanish on one tap.
    await renamedCard.getByRole("button", { name: `Delete ${renamed}` }).click();

    // The question must name the playlist, so the user knows what they're losing.
    const confirm = page.getByTestId("confirm-dialog");
    await expect(confirm, "Delete did not ask before destroying.").toBeVisible({
      timeout: 15_000,
    });
    await expect(confirm).toContainText(renamed);

    // Backing out must genuinely keep it — otherwise the question is theatre.
    await page.getByTestId("confirm-cancel").click();
    await expect(confirm).toHaveCount(0);
    await expect(renamedCard, '"Keep it" deleted the playlist anyway.').toBeVisible();

    // Now go through with it.
    await renamedCard.getByRole("button", { name: `Delete ${renamed}` }).click();
    await page.getByTestId("confirm-accept").click();
    await expect(renamedCard, "Delete did not persist.").toHaveCount(0, { timeout: 15_000 });
  });
});
