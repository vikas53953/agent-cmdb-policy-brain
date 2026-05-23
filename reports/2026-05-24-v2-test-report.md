# Agent CMDB V2 Test Report

Date: 2026-05-24

## Build Summary

Agent CMDB / Policy Brain V2 is implemented as a local TypeScript control-plane module.

It now includes:

- Policy evaluator
- Source route resolver
- Profile inspection
- CMDB object inventory
- Graph relationships
- Agent preflight checks
- Control-plane validation
- Readiness report
- JSONL evidence store
- JSONL change log
- CLI commands for all major features

## Automated Tests

Command:

```powershell
npm test
```

Result:

- Test files: 7 passed
- Tests: 46 passed

## Feature Checks

| Feature | Command | Result |
| --- | --- | --- |
| Policy deny | `npx tsx agent-cmdb/src/cli.ts policy --profile gemma4cloud --action x_account_post --tool xurl` | PASS: denied by `global-deny-xurl-account-actions` |
| Source route | `npx tsx agent-cmdb/src/cli.ts route --profile apple-farming --intent weather` | PASS: `apple-wiki` first, then PP weather tools |
| Inventory | `npx tsx agent-cmdb/src/cli.ts inventory --profile gemma4cloud` | PASS: returned Gemma profile, xAI source, PP radar job |
| Graph | `npx tsx agent-cmdb/src/cli.ts graph --id profile.gemma4cloud` | PASS: returned `uses` xAI OAuth and `owns` Gemma PP radar |
| Preflight allow | `npx tsx agent-cmdb/src/cli.ts preflight --profile gemma4cloud --action x_research --tool xai-oauth --intent x_research` | PASS: allowed, route attached |
| Validation | `npx tsx agent-cmdb/src/cli.ts validate` | PASS: no validation issues |
| Readiness report | `npx tsx agent-cmdb/src/cli.ts report` | PASS: 2 profiles, 12 sources, 6 policies, 9 objects, 7 relationships, 0 errors |
| Evidence add/list | `evidence-add`, then `evidence-list` with `.codex-tmp/agent-cmdb-v2-smoke` | PASS: evidence record written and filtered |
| Change add/list | `change-add`, then `change-list` with `.codex-tmp/agent-cmdb-v2-smoke` | PASS: change record written and filtered |

## Current Readiness Snapshot

- Version: `agent-cmdb-v2`
- Profiles: 2
- Sources: 12
- Policies: 6
- Objects: 9
- Relationships: 7
- Validation errors: 0
- Validation warnings: 0

## Active Guardrails

Denied actions:

- `x_account_post`
- `x_account_reply`
- `x_account_like`
- `x_account_bookmark`
- `x_account_dm`
- `x_media_upload`
- `send_bot_ops_status`
- `bot_ops_status`
- `bot_ops_auto_recovery_message`
- `gbrain_write`
- `gbrain_index`
- `gbrain_sync`
- `voice_note_memory_to_gbrain`

Paused objects:

- `memory.gbrain`

Blocked objects:

- `tool.xurl`

## Notes

This V2 build does not yet hook into live Hermes job execution. It is ready to be used as a preflight control-plane module before Hermes sends, researches, posts, or writes memory.
