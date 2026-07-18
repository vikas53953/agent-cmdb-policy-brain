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

Running the suite end-to-end needs a **provisioned environment** — none of it lives
on the build machine or in the repo, and no secret is ever committed:

1. The app's runtime env (in `.env.local`): `DATABASE_URL`, `AUTH_SECRET`,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_API_KEY`, and the Spotify
   `NEXT_PUBLIC_*` vars for the AE5 fallback path. See `.env.example`.
2. A **signed-in storage state**. Google OAuth can't be scripted (real consent
   screen) and no test-only login bypass is shipped, so sign in once in a real
   browser and save its storage state to the path in `E2E_STORAGE_STATE`
   (default `e2e/.auth/user.json`).
3. Browser binaries (not installed by `npm install`):

   ```
   npx playwright install chromium
   ```

Then opt in and run:

```
E2E_READY=1 E2E_STORAGE_STATE=e2e/.auth/user.json npx playwright test
```

Without `E2E_READY=1` every spec **skips** with a plain reason (so a bare CI run
does not fail) — a spec never claims to have verified something it could not
actually exercise. The saved storage-state file is gitignored and never committed.
