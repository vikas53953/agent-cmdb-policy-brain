import {
  test,
  expect,
  E2E_READY,
  NOT_READY_REASON,
  E2E_EXTERNAL,
  E2E_FAKE_ENGINE,
  TEXT,
  STABLE,
} from "./fixtures";
import type { Page } from "@playwright/test";

// AE5 — tapping a Spotify search result PLAYS, as a clearly-labelled matched YouTube
// version. Spotify's own streaming does not exist in this product (Premium + dev-mode
// allowlist is a parked decision), so the YouTube substitution is not a workaround: it
// IS the shipped behaviour, and this spec tests it as the correct behaviour.
//
// WHY THIS SPEC EXISTS (audit finding 34, BLOCKER). The whole fallback hangs off ONE
// side-effect import — `import "@/lib/player/adapters/spotify"` at
// components/ui/app-chrome.tsx:19 — which is what registers the Spotify adapter in
// `adapterRegistry`. Before this spec, deleting that import as "unused" made every
// Spotify result silently unplayable while the entire suite stayed green. This spec
// pins that line. If the import is removed, it fails at THREE independent points:
//
//   1. components/search/searchbar.tsx reads `adapterRegistry.registeredSources()` and
//      passes `hasAdapter` into each row; `resultPlayability("spotify", false)` then
//      returns { playable: false, reason: SPOTIFY_SOON_REASON }, so the row's play button
//      renders DISABLED with "Plays after Spotify support arrives". Assertion A fails.
//   2. lib/player/store.ts:257 does `this.registry.get("spotify")` — undefined — so the
//      `resolvePlayable` branch never runs, no substitution happens and `notice` stays
//      null. The honest label never renders. Assertion B fails.
//   3. With no engine for source "spotify" the store takes the no-adapter path
//      (store.ts:298): status "idle", isPlaying false, position pinned at 0, and the
//      track stays the SPOTIFY row. Assertions C and D fail.
//
// DETERMINISM: Spotify search is persistently unavailable on this deployment (no app
// credential — see search-spotify-honesty.spec.ts), so a real Spotify row can never be
// obtained from a live query. We therefore serve /api/search from a stub with two known
// answers: the user's query returns exactly one SPOTIFY track, and the adapter's own
// follow-up lookup ("<title> <artist>", built inside spotify.ts) returns exactly one
// YOUTUBE track. Everything under test — the registry, the store's resolvePlayable seam,
// the substitution, the label, the engine — is the app's real code path.

const PROBE_QUERY = "robot spotify fallback probe";
const SPOTIFY_TITLE = "Robot Fallback Probe";
const SPOTIFY_ARTIST = "Fuse Robot";
// The adapter builds its lookup as [title, artist].join(" ") — matched exactly so the
// stub proves the adapter really performed its own match, not a lucky echo.
const MATCH_QUERY = `${SPOTIFY_TITLE} ${SPOTIFY_ARTIST}`;
// Deliberately DIFFERENT from the Spotify title: the track the user ends up hearing must
// be provably the substituted one, not the row they tapped.
const YOUTUBE_TITLE = "Robot Fallback Probe (YouTube version)";

const SPOTIFY_TRACK = {
  source: "spotify",
  nativeId: "spotify:track:robotprobe0000000001",
  title: SPOTIFY_TITLE,
  artist: SPOTIFY_ARTIST,
  artUrl: null,
  durationSec: 213,
};

const YOUTUBE_TRACK = {
  source: "youtube",
  nativeId: STABLE.youtubeVideoId,
  title: YOUTUBE_TITLE,
  artist: SPOTIFY_ARTIST,
  artUrl: null,
  durationSec: 213,
};

const AVAILABLE_SOURCES = {
  youtube: { available: true, reason: null },
  spotify: { available: true, reason: null },
};

// Serve the two known answers; anything else (a stray prefix while typing) is an empty
// result set rather than a surprise row.
async function stubSearch(page: Page): Promise<void> {
  await page.route("**/api/search**", async (route) => {
    const q = (new URL(route.request().url()).searchParams.get("q") ?? "").trim();
    const results =
      q === PROBE_QUERY ? [SPOTIFY_TRACK] : q === MATCH_QUERY ? [YOUTUBE_TRACK] : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ query: q, cached: false, results, sources: AVAILABLE_SOURCES }),
    });
  });
}

test.describe("AE5 — a Spotify result plays, honestly labelled as its YouTube version", () => {
  test.skip(!E2E_READY, NOT_READY_REASON);
  // Real sound needs a real engine: either live YouTube embed playback (E2E_EXTERNAL) or
  // the deterministic in-DOM fake engine. Search itself is stubbed, so no YOUTUBE_API_KEY
  // is required — only the ability to actually play. Without either, this SKIPS rather
  // than pretending to have proved the substitution really produced sound.
  test.skip(
    !(E2E_EXTERNAL || E2E_FAKE_ENGINE),
    "No playback engine declared for this run — set E2E_EXTERNAL=1 (live YouTube embed " +
      "playback) or arm NEXT_PUBLIC_E2E_FAKE_ENGINE (>= 32 chars). AE5 asserts a Spotify " +
      "track really produces advancing sound, which needs one of them.",
  );

  test("tapping a Spotify result plays the matched YouTube version and says so", async ({
    page,
  }) => {
    await stubSearch(page);

    await page.getByTestId("tab-search").click();
    await page.getByTestId("search-input").fill(PROBE_QUERY);

    const spotifyRow = page.locator('[data-testid="search-result"][data-source="spotify"]');
    await expect(spotifyRow, "The stubbed Spotify result never rendered.").toBeVisible({
      timeout: 30_000,
    });

    // ── A. The control is genuinely live ────────────────────────────────────────────
    // Pins the registration itself: with no Spotify adapter registered the row renders
    // disabled and carries SPOTIFY_SOON_REASON. Both halves are asserted so neither a
    // silently-dead button nor the "arrives later" copy can slip through.
    const play = spotifyRow.getByTestId("result-play");
    await expect(
      play,
      "The Spotify result's play button is DISABLED — no Spotify adapter is registered. " +
        "The side-effect import at components/ui/app-chrome.tsx:19 " +
        '(import "@/lib/player/adapters/spotify") is what registers it; if it was deleted ' +
        "as unused, every Spotify result is unplayable. AE5 is broken.",
    ).toBeEnabled();
    // The reason lives in the control's accessible name (components/search/result-row.tsx
    // renders it into aria-label/title, never as body text), so it is asserted there — a
    // getByText check would pass vacuously and prove nothing.
    const label = (await play.getAttribute("aria-label")) ?? "";
    expect(
      label,
      `The Spotify play control still announces itself as "${label}" — it is carrying the ` +
        "not-yet-available reason, which means no Spotify adapter is registered.",
    ).not.toContain(TEXT.spotifySoonReason);
    expect(label, "The play control lost its plain, playable accessible name.").toBe(
      `Play ${SPOTIFY_TITLE}`,
    );

    await play.click();

    // ── B. The substitution is labelled HONESTLY, in plain words ────────────────────
    // Asserted first and verbatim: the user must be told they are hearing the YouTube
    // version. Read before playback settles, because a later engine error legitimately
    // replaces the notice with a recovery message.
    await expect(
      page.locator(".player-notice").filter({ hasText: TEXT.spotifyFallbackNotice }).first(),
      "No honest label appeared after tapping a Spotify result. Either the substitution " +
        "never ran (no registered Spotify adapter — see app-chrome.tsx:19) or the user is " +
        "being played a different song than they tapped without being told.",
    ).toBeVisible({ timeout: 20_000 });

    // ── C. The track really was substituted ─────────────────────────────────────────
    // The store must be operating on the matched YOUTUBE track, not the Spotify row.
    // The two titles differ, so this cannot pass by accident.
    await page.getByTestId("mini-open").click();
    const np = page.getByTestId("now-playing");
    await expect(np).toHaveAttribute("data-np-open", "true");
    const npTitle = np.locator(".np-title");
    await expect(
      npTitle,
      "Now Playing is not showing the matched YouTube version — resolvePlayable did not " +
        "substitute, so nothing streamable is loaded.",
    ).toHaveText(YOUTUBE_TITLE, { timeout: 20_000 });

    // ── D. It ACTUALLY PLAYS — position strictly advances ───────────────────────────
    // The outcome that matters. An honest "error" terminal is the one acceptable
    // alternative (a bot-gated datacenter IP where YouTube embeds refuse) — the app
    // admitted it rather than freezing, and A-C already proved the fallback is wired.
    // A frozen "idle" at position 0 — exactly what an unregistered adapter produces —
    // is NOT acceptable and fails loudly here.
    const mini = page.getByTestId("mini-player");
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
            "A Spotify track never reached real advancing sound OR an honest error — it " +
            "sat frozen. With no Spotify adapter registered the store takes the " +
            "no-engine path (status 'idle', position 0), which is this exact symptom.",
          timeout: 60_000,
        },
      )
      .not.toBe("working");

    if ((await mini.getAttribute("data-player-state")) === "error") {
      // Honest refusal: prove it is not a dead end — a real Skip is offered (AE1).
      await expect(
        page.getByTestId("np-skip"),
        "An honest error must still offer a working Skip — never a silent freeze.",
      ).toBeVisible({ timeout: 5_000 });
      return;
    }

    // Playing: position must KEEP moving across 5s. A stall would freeze it.
    const p0 = Number(await mini.getAttribute("data-player-position"));
    await page.waitForTimeout(5_000);
    const state1 = await mini.getAttribute("data-player-state");
    const p1 = Number(await mini.getAttribute("data-player-position"));
    if (state1 === "error") return; // degraded honestly — it never lied about playing
    expect(
      p1,
      `The Spotify fallback loaded but produced no sound (p0=${p0}, p1=${p1}, ` +
        `state=${state1}) and surfaced no honest error either.`,
    ).toBeGreaterThan(p0);

    // The label must SURVIVE playback — a listener who looks a few seconds in still learns
    // what they are hearing, rather than being quietly told once and then misled.
    await expect(
      page.locator(".player-notice").filter({ hasText: TEXT.spotifyFallbackNotice }).first(),
      "The honest 'playing the YouTube version' label vanished while the substituted " +
        "track played — the user is now hearing a different song with no explanation.",
    ).toBeVisible();
  });

  test("a Spotify track with no YouTube match refuses honestly instead of pretending", async ({
    page,
  }) => {
    // The other half of the contract (R2/R18): when NO match can be found the app must say
    // so in plain words and must never claim to be playing. Same wiring, opposite answer —
    // this also fails if the adapter is unregistered, because then the store shows no
    // reason at all, just a dead silent row.
    await page.route("**/api/search**", async (route) => {
      const q = (new URL(route.request().url()).searchParams.get("q") ?? "").trim();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          query: q,
          cached: false,
          // The user's query yields the Spotify row; the adapter's follow-up lookup finds
          // nothing (an obscure track, or YouTube search unconfigured).
          results: q === PROBE_QUERY ? [SPOTIFY_TRACK] : [],
          sources: AVAILABLE_SOURCES,
        }),
      });
    });

    await page.getByTestId("tab-search").click();
    await page.getByTestId("search-input").fill(PROBE_QUERY);
    const spotifyRow = page.locator('[data-testid="search-result"][data-source="spotify"]');
    await expect(spotifyRow).toBeVisible({ timeout: 30_000 });
    await spotifyRow.getByTestId("result-play").click();

    // Plain-English refusal, surfaced to the user.
    await expect(
      page.locator(".player-notice").filter({ hasText: "Couldn't find a YouTube version" }).first(),
      "No match was found, but the app did not say so — a silent stick is the failure " +
        "mode this contract exists to prevent.",
    ).toBeVisible({ timeout: 20_000 });

    // And it must NOT claim to be playing.
    const mini = page.getByTestId("mini-player");
    expect(
      await mini.getAttribute("data-player-state"),
      "The app claimed to be playing a track it could not resolve.",
    ).not.toBe("playing");
  });
});
