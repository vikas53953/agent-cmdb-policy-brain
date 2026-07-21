# e2e

Playwright end-to-end specs (landed in **U16**) that lock the app's headline
behaviours and honesty rules:

- `heart-moment.spec.ts` — search → instant play → Now Playing with lyrics (F1,
  R1/R2/R5/R6/R7).
- `reliability.spec.ts` — a stalled track says "Playback stalled — retrying" and
  then offers Skip; never a silent freeze (AE1, R2/R18).
- `honesty.spec.ts` — the two DJ locks (AE3 YouTube greys the full-engine controls
  with a reason; AE4 Spotify locks the second deck), the Spotify→YouTube fallback
  label (AE5), and a **zero-decorative-controls sweep** across every screen (R17).
- `auth.setup.ts` — validates the signed-in browser session before the specs run.

## Running them

The robot signs itself in through the **Robot Test Door** (`lib/robot-door.ts`) — a
secret-gated Credentials login — so there is no manual browser sign-in or saved
storage state. What a run needs is the **door secret**, plus (optionally) the extra
capabilities some journeys touch. No secret ever lives in the repo.

1. **The door secret — `E2E_TEST_SECRET` (32+ chars).** Put it in `fuse-app/.env.local`;
   `playwright.config.ts` loads that file automatically, so the plain command below
   Just Works. In CI or against the live site, set it in the environment instead.
   The app also needs `AUTH_SECRET` in its env to boot.
2. Browser binaries (not installed by `npm install`):

   ```
   npx playwright install chromium
   ```

Then run:

```
npx playwright test
```

**A run that can test nothing will not report success.** If the door secret is missing,
`e2e/global-setup.ts` prints a loud banner and **fails the run** ("NOT PROVISIONED —
0 tests ran, this is not a pass") rather than exiting green on an all-skip.

### Opt-in capabilities

With only the door secret, the deterministic, DB-free journeys (auth, DJ capability
honesty, navigation, console health, search honesty) **run**; everything that needs a
real backing service **skips with a plain reason** — never silently. Declare what a run
has via `requires(...)` gates (see `fixtures.ts`):

- `E2E_DB=1` (with a reachable `DATABASE_URL`) — likes, playlists, hot-cue persistence,
  settings persistence: anything that writes to the database.
- `E2E_EXTERNAL=1` (with a real `YOUTUBE_API_KEY`) — real YouTube search + embed playback.
- `NEXT_PUBLIC_E2E_FAKE_ENGINE` (32+ chars, in the app build) — arms the deterministic
  in-DOM fake engine for exact-position playback specs. Never set in production.

The live watchman sets `E2E_DB=1` and `E2E_EXTERNAL=1` against production, so those
specs really run there. `.env.local` is gitignored and never committed.
