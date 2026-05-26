# Changelog

## v3.1.0 - Contract hardening for enforcement-gate use

### Breaking

- `tamperMode` default changed from `warn` to `fail`. A corrupted health state file now causes operations to error instead of silently resetting sources to `up`. Callers that need the old behavior must pass `tamperMode: 'warn'` explicitly.
- `approval_required` was removed from supported policy config effects. Use `effect: deny` with `code: needs_approval` and implement escalation in your agent orchestrator.

### Fixed

- Legacy in-memory `approval_required` rules now collapse to deny decisions with `code: needs_approval` instead of returning a dead-letter policy effect.
- `resolveRoute()` returns an empty-route result with warnings on unknown profile or intent, matching `preflight()` safety behavior.
- `preflight-error` denies are written to the evidence log and change log so fail-closed decisions remain visible in the audit trail.
- `approval_required` has Option B semantics: it is not first-class approval support. Use a deny decision with `code: needs_approval` and route human approval in the caller.

### Notes

- Substring action matching, in-process-only write queues, YAML schema-bomb guards, and swallowed analytics failures are known limitations for v3.1.0.

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
