# agent-cmdb

[![CI](https://github.com/vikas53953/agent-cmdb-policy-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/vikas53953/agent-cmdb-policy-brain/actions/workflows/ci.yml)
![Tests](https://img.shields.io/badge/tests-217_passing-brightgreen)

Opt-in policy checks with hash-chained local audit records for AI agents.

## What This Does

Agent CMDB is a TypeScript library that your AI agent calls before acting. It evaluates policy rules, routes to preferred sources using recorded source health, and maintains hash-chained audit records for policy checks performed through the library.

This is a library, not a proxy. Your agent must call `cmdb.policy.preflight()` before every governed action. If it does not call preflight, no enforcement occurs.

## What Makes This Different

- Hash-chained audit records: every evidence and change record carries the SHA-256 hash of the previous record. Files rotate daily for bounded reads.
- Deny-wins policy evaluation: deny rules override allow rules regardless of order. Unmatched actions default to deny.
- Health-aware source routing: routes are resolved in configured preference order, and sources with recorded failures can be skipped.
- Local markdown memory: agent knowledge is stored as human-readable markdown files with a JSON index. No database, embeddings, or server required.

## Honest Limitations

- Agent CMDB does not intercept tool calls automatically. You wire it into your agent framework.
- Action matching for configured write actions uses simple substring checks in V3.1. Keep write action names specific, and avoid using untrusted action names as policy input.
- Source health monitoring uses windowed failure counting with `up`, `down`, and `half-open` states. It is not a production-grade resilience framework.
- Preflight analytics measure logged allow and deny decisions. They are decision summaries, not external availability promises or alerts.
- Cost estimation aggregates values you provide in evidence records and optional per-call source config. It does not auto-instrument LLM or API calls.
- The audit store is tamper-evident, not tamper-proof. Hash chains detect changes, but records are not signed or written to immutable storage.
- `tamperMode` defaults to `fail`. Corrupted health, evidence, change, or analytics state raises an error by default instead of silently recovering. Pass `tamperMode: 'warn'` only when availability is more important than fail-closed behavior.
- State writes use in-process queues and atomic file replacement where applicable. Multiple independent Node processes sharing one `storeDir` are not a supported high-concurrency mode in V3.1.
- YAML configs are intended to be trusted local files. V3.1 does not include depth, alias, or schema-bomb guards for untrusted YAML input.
- Preflight analytics are advisory. Analytics cache update failures do not block or change policy decisions.
- Agent CMDB does not implement a built-in human approval workflow. Model approval-required actions as `effect: deny` with `code: needs_approval`, then handle escalation in your agent orchestrator.
- Sanitization detects and can strip common prompt-injection patterns. It is not a security boundary.

## Known Limits

Measurements below were taken on a Windows development machine with `npx tsx scripts/measure-listEvidence.ts` and `npx tsx scripts/measure-brain.ts`. Treat them as local-order-of-magnitude numbers, not a service guarantee.

Agent CMDB v3 stores audit records in append-only JSONL files and brain entities in a single JSON index. Both work well at small scale and degrade predictably as data grows.

**Evidence log (`listEvidence`):**

| Records | `listEvidence()` | Incremental append time |
| ---: | ---: | ---: |
| 100 | 8.39 ms | 520.36 ms |
| 1,000 | 8.78 ms | 3,397.33 ms |
| 5,000 | 39.85 ms | 8,648.97 ms |
| 10,000 | 92.42 ms | 10,451.63 ms |
| 25,000 | 180.81 ms | 29,184.74 ms |
| 50,000 | 359.20 ms | 56,907.42 ms |

Up to 10,000 records, list calls stayed under 100 ms in this run. At 25,000 records, list calls became noticeable. At 50,000 records, list calls were still below 400 ms, but append throughput was slow enough that this should be treated as a local audit log, not a high-volume event pipeline.

**Brain index (`listEntities`, `readEntity`):**

| Entities | `listEntities()` | `readEntity()` | Index write setup |
| ---: | ---: | ---: | ---: |
| 100 | 25.20 ms | 31.00 ms | 98.17 ms |
| 1,000 | 26.63 ms | 33.75 ms | 1,440.30 ms |
| 5,000 | 60.40 ms | 73.16 ms | 3,985.20 ms |
| 10,000 | 108.77 ms | 123.45 ms | 5,739.95 ms |
| 25,000 | 698.39 ms | 487.57 ms | 19,905.49 ms |
| 50,000 | 722.53 ms | 846.79 ms | 28,997.82 ms |

Up to 10,000 brain entities, reads stayed around 125 ms or less in this run. Past 25,000 entities, the single JSON index becomes the bottleneck. Agent CMDB v3 has daily JSONL file rotation, but it does not have retention, compaction, or external storage offload. For higher volume, archive old JSONL files manually or pipe evidence to external storage.

## Install

```bash
npm install @pylabmit/agent-cmdb
npx agent-cmdb init
```

`init` creates a local workspace:

```text
agent-cmdb/
  config/
    policy-library.yaml
  state/
    evidence-YYYY-MM-DD.jsonl   # created on first evidence write
    changes-YYYY-MM-DD.jsonl    # created on first change write
  brain/
    entities/
    decisions/
    digest/
    index.json
agent-cmdb.config.ts
```

## Quick Start

```ts
import { createAgentCmdb } from '@pylabmit/agent-cmdb';

const cmdb = createAgentCmdb({
  configPath: './agent-cmdb/config/policy-library.yaml',
  storeDir: './agent-cmdb/state',
  brainDir: './agent-cmdb/brain'
});

const result = await cmdb.policy.preflight({
  profile: 'research-agent',
  action: 'web_search',
  tool: 'web-search-api',
  intent: 'web_research'
});

if (!result.allowed) {
  console.log(`Blocked: ${result.decision.reason}`);
  return;
}

for (const source of result.route.sources) {
  console.log(`Use ${source.id}`);
}
```

> [!WARNING]
> Agent CMDB evaluates policy only when your code calls it. Call `cmdb.policy.preflight()` before every action you want governed.

## V3 Migration

V3 removes the old flat API. Use the composable clients:

```ts
await cmdb.policy.preflight(request);
await cmdb.memory.logEvidence(evidence);
await cmdb.ops.recordSourceFailure('web-search-api');
await cmdb.health();
```

Old calls such as `cmdb.preflight()` and `cmdb.logEvidence()` are intentionally removed in `3.0.0`.

## Policy Config

Agent CMDB reads YAML or JSON. Existing flat configs still load, and V3 also supports grouped sections:

```yaml
version: "1.0"
updatedAt: "2026-05-25"

policy:
  writeActions: [post, publish, send, update, delete]
  policies:
    - id: deny-social-posting
      effect: deny
      actions: [social_post, social_reply, social_dm]
      reason: Social media actions are disabled.

    - id: allow-research
      effect: allow
      profiles: [research-agent]
      actions: [web_search, summarize]
      tools: [web-search-api, local-docs]
      reason: Research agent can use read-only sources.

sources:
  sources:
    - id: web-search-api
      label: Web Search API
      kind: tool
      readOnly: true

    - id: local-docs
      label: Local Documentation
      kind: wiki
      readOnly: true

  profiles:
    - id: research-agent
      name: Research Agent
      purpose: Web research and summarization
      guardrails:
        - Do not make purchases
        - Do not post to social media
      routes:
        - intent: web_research
          sources: [local-docs, web-search-api]
```

Read-only sources are denied for write-like actions such as `post`, `publish`, `send`, `update`, and `delete`.

`approval_required` is not a supported policy effect in V3.1 configs. Use `effect: deny` with `code: needs_approval` for actions that need human review. Legacy in-memory policy objects with `effect: approval_required` are interpreted as deny decisions with `code: needs_approval`.

## API

### Policy: `cmdb.policy`

- `preflight(request)`: evaluate policy, write audit records unless `dryRun: true`, and return the allowed route.
- `resolveRoute(request)`: resolve a source route using recorded source health.
- `validate()`: validate the policy config.
- `report()`: return a readiness summary.

### Memory: `cmdb.memory`

- Brain: `readEntity`, `writeEntity`, `createEntity`, `deleteEntity`, `searchEntities`, `listEntities`.
- Audit: `logEvidence`, `listEvidence`, `logChange`, `listChanges`.
- Digest: `generateDailyDigest`, `generateWeeklyDigest`.

### Ops: `cmdb.ops`

- Health: `recordSourceSuccess`, `recordSourceFailure`, `getSourceHealth`, `listSourceHealth`, `isSourceAvailable`, `getHealthState`, `resetSourceHealth`.
- Analytics: `calculatePreflightAnalytics`.
- Cost estimation: `getCostSummary`.

## Runtime Helpers

- Source health monitor: records source successes and failures, keeps a bounded failure window, and allows one half-open probe after recovery timeout.
- Health-aware routing: `preflight()` and `resolveRoute()` skip sources currently marked down by recorded health.
- Preflight analytics: `calculatePreflightAnalytics()` reports logged allow and deny counts, rates, top deny rules, and action breakdowns.
- Cost estimation: `getCostSummary()` aggregates `tokenCount` and `estimatedCost` fields from evidence records, with optional `costPerCall` values from source config.
- Tamper mode: pass `tamperMode: 'fail'` to throw on corrupted JSONL evidence/change stores instead of returning records with warnings.

## Local Memory

The optional brain stores markdown files and an index:

```ts
const knowledge = await cmdb.memory.readEntity('agent-security');

await cmdb.memory.writeEntity({
  entityId: 'agent-security',
  content: '## New findings\n\n3 CVEs discovered...',
  actor: 'research-agent',
  reason: 'Daily security scan',
  appendOnly: true
});
```

By default, `readEntity()` warns when common prompt-injection patterns appear in content. Pass `{ stripInjection: true }` to remove matching lines from the returned content.

## CLI

```bash
npx agent-cmdb init
npx agent-cmdb doctor
npx agent-cmdb preflight --profile research-agent --action web_search --tool web-search-api --intent web_research
npx agent-cmdb preflight --profile research-agent --action web_search --tool web-search-api --intent web_research --dry-run
npx agent-cmdb route --profile research-agent --intent web_research
npx agent-cmdb health
npx agent-cmdb health reset --source web-search-api
npx agent-cmdb analytics --profile research-agent
npx agent-cmdb cost --profile research-agent --date 2026-05-25
npx agent-cmdb brain list --brain-dir ./agent-cmdb/brain
npx agent-cmdb digest --profile research-agent --brain-dir ./agent-cmdb/brain
```

The `policy` CLI command is a developer inspection helper and prints a warning because it does not write audit records. Use `preflight()` in agent code for audited checks.

## Comparison With Alternatives

| Capability | agent-cmdb | Enterprise agent governance | Tool-call proxy/decorator | Knowledge graph memory |
| --- | --- | --- | --- | --- |
| Enforcement style | Opt-in library call | Framework or platform integration | Tool wrapper or middleware | Not policy-focused |
| Audit | Hash-chained local JSONL | Central logs | Traces or logs | Usually not audit-focused |
| Source routing | Health-aware route preference | Varies | Usually no | Usually no |
| Memory | Markdown files | Usually no | Usually no | Database/vector store |
| Best for | Local-first policy, routing, and audit | Large managed fleets | Automatic tool interception | Semantic recall |

Use agent-cmdb when you want a lightweight local policy library with hash-chained audit records and source routing. It can also be called from framework middleware or tool wrappers. Use another tool when you need automatic interception, enterprise identity/compliance workflows, or semantic knowledge retrieval.

## Roadmap

| Release | Status | Scope |
| --- | --- | --- |
| V1.0 | Shipped | Policy evaluation, source routing, object registry, evidence/change store |
| V1.5 | Shipped | npm packaging, dry-run, source freshness, doctor command |
| V1.5.1 | Shipped | default deny, audited preflight path, tamper-evident JSONL, sanitization hardening |
| V3.0 | Shipped | composable API, preflight analytics, windowed source health, daily JSONL rotation, no public unaudited policy API |
| V3.1 | Shipped | fail-closed route safety, audited preflight-error denies, fail-closed tamper default, defined approval semantics |
| V4.0 | Planned | REST/MCP API, dashboard, policy versioning, templates, incident records |

The detailed roadmap is in [docs/agent-cmdb-roadmap.md](docs/agent-cmdb-roadmap.md).

## Infrastructure Mental Model

| Infrastructure concept | Agent CMDB |
| --- | --- |
| Firewall policy | Policy rules |
| Routing table | Source routing |
| Log management | Evidence timeline |
| Config backups | Brain entity files |
| Automated reports | Daily/weekly digests |
| Operations runbooks | Decision records |
| Asset registry | Object registry |

## Development

```bash
npm test
npm run typecheck
npm run build
```

Current verification: 217 tests passing, strict TypeScript clean, clean `dist/` build.
