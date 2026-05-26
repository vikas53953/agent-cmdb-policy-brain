# Changelog

## Unreleased

### Breaking

- `tamperMode` default changed from `warn` to `fail`. A corrupted health state file now causes operations to error instead of silently resetting sources to `up`. Callers that need the old behavior must pass `tamperMode: 'warn'` explicitly.

## v3.0.1 - Hot-path safety + release hygiene

### Fixed

- `preflight()` now returns a deny decision instead of throwing on unknown profile, unknown source, or malformed request. Required for use as a mandatory enforcement gate.
- Repository main branch now matches the published npm artifact.
- Brittle version assertion in `oss-package.test.ts` replaced with semver-shape check to prevent false failures on future releases.

### Added

- Measured performance numbers in "Known Limits" section.
- Benchmark scripts under `scripts/`.

### Unchanged

- Composable surface (`policy`/`memory`/`ops`/`health`). No breaking changes.
