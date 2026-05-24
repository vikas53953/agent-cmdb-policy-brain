# Agent CMDB Production Hardening Report

Generated: 2026-05-24 09:56 IST

## Verdict

Agent CMDB / Policy Brain is ready for the next Hermes preflight integration step.

This pass does not mutate live Hermes profiles. It adds a production-grade local control-plane loader, adversarial test coverage, and a single Hermes-facing preflight scaffold.

## Verification

```text
npm test
Test Files  11 passed (11)
Tests       78 passed (78)
Duration    17.76s

npx tsc --noEmit --pretty false
0 errors
```

Test target was 50+ tests. Final count is 78 tests.

## Phase 1: Adversarial Summary

Store stress:

- Added regression coverage for 10,000 evidence writes and profile query.
- Verified large 20KB summaries are truncated to 16,000 characters.
- Verified null bytes, Unicode BiDi controls, and prompt-injection markers are sanitized across evidence and change records.
- Added `StoreWriteError` so blocked/unusable store paths fail cleanly.

Policy engine:

- Added 100-policy evaluation smoke coverage.
- Verified deny beats allow regardless of policy order.
- Verified `actions: ['*']`, `profiles: ['*']`, and `tools: ['*']` catch matching requests.
- Added runtime validation for empty/nullish profile, action, and tool inputs.
- Added policy conflict warnings when deny/allow rules overlap.

Interface contract:

- Added negative tests for missing/malformed `preflight`, `resolveRoute`, `logEvidence`, `logChange`, `listEvidence`, and `listChanges` inputs.
- Added runtime validation for erased TypeScript unions such as `TrustLevel`, `ObjectKind`, and `ChangeAction`.
- Verified invalid records are rejected before persistence.

CLI:

- Added missing-required-flag tests for every command that needs input.
- Added invalid enum tests for `--kind` and `--trust`.
- Verified `evidence-add` and `change-add` create missing store directories.

## Phase 2: Architecture Changes

- Moved the hardcoded Hermes V2 control plane out of `src/engine.ts`.
- Added `data/hermes-v2.json` as the durable control-plane data file.
- Added `loadControlPlane(filePath)` and `loadDefaultControlPlane()`.
- Loader performs shape checks, enum checks, JSON parse error reporting, and validation error reporting.
- Tests now use loaded data instead of relying on an embedded literal.

## Phase 3: Hermes Preflight Scaffold

Added `src/hermes-preflight.ts`:

```ts
export async function hermesPreflight(
  action: string,
  profile: string,
  tool?: string,
  intent?: string
): Promise<PreflightResult>
```

Behavior:

- Creates the Agent CMDB facade.
- Runs preflight.
- Logs evidence on deny decisions.
- Logs a change record for every decision.
- Returns the `PreflightResult` Hermes can act on.

## Hermes Integration Notes

Hermes should import only `hermesPreflight()` or `createAgentCmdb()` from the interface layer.

Recommended live integration flow:

1. Hermes receives an intended action.
2. Hermes calls `hermesPreflight(action, profile, tool, intent)`.
3. If `allowed === true`, Hermes continues.
4. If `approvalRequired === true`, Hermes asks for explicit approval.
5. If denied, Hermes stops and surfaces `decision.reason` plus `decision.suggestedAlternative`.

Current guardrail decisions:

- X account actions through xurl/X Developer API remain denied.
- Grok/xAI OAuth read-only research remains allowed where configured.
- Bot Ops / Status messages remain denied.
- GBrain write/sync/index actions remain denied while paused.

## Remaining Non-Blocking Improvements

- Split `engine.ts` into smaller modules later: policy engine, route resolver, graph resolver, validator, and loader.
- Add a REST/MCP service wrapper only after Hermes local import integration is proven.
- Add source health checks and route freshness scoring in a later V3 pass.
