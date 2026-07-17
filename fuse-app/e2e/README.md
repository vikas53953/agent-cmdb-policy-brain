# e2e

Playwright end-to-end specs land in **U16** (the heart moment, the stall/retry
path, the two DJ honesty locks, and the Spotify fallback). U1 only wires the
Playwright config; there are no specs here yet, so `playwright test` finds
nothing to run and the U1 CI gate does not include it.

Browser binaries are not installed by `npm install`. Run this once before the
first e2e run:

```
npx playwright install chromium
```
