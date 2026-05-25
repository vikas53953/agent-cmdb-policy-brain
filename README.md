# agent-cmdb

[![CI](https://github.com/vikas53953/agent-cmdb-policy-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/vikas53953/agent-cmdb-policy-brain/actions/workflows/ci.yml)
![Tests](https://img.shields.io/badge/tests-220_passing-brightgreen)

Tamper-evident policy evaluation for AI agents.

Agent CMDB is a TypeScript library that evaluates policy rules, routes an agent to preferred sources, and keeps a tamper-evident audit log of decisions and evidence. You call it before your agent acts. It tells you whether the action is allowed, which source to use, and records what happened with a hash chain that can detect tampering.

What is different:

- Hash-chained JSONL audit logs for evidence and changes.
- Deny-wins policy evaluation with default deny for unmatched actions.
- Source routing with health-aware failover.
- Optional local markdown memory, with no database or embeddings required.

## Limitations

- Agent CMDB is a library, not a proxy. Your agent must call `preflight()` before every action you want governed.
- Source health monitoring tracks consecutive failures and recovery probes. It is not an advanced breaker with probe budgets, burn alerts, or fleet orchestration.
- Reliability metrics measure preflight allow rates. They do not enforce service-level contracts.
- Cost estimation aggregates values you provide on evidence records. It does not auto-instrument LLM or API calls.
- Task checkpoints are save/load records. They do not resume work unless your agent uses them.

## Install

```bash
npm install @pylabmit/agent-cmdb
npx agent-cmdb init
```

`init` creates a local workspace:

```text
agent-cmdb/
  config/
    control-plane.yaml
  state/
    changes.jsonl
  brain/
    entities/
    decisions/
    digest/
    index.json
agent-cmdb.config.ts
```

Evidence files are created as dated files such as `state/evidence-2026-05-25.jsonl`.

## Quick Start

```ts
import { createAgentCmdb } from '@pylabmit/agent-cmdb';

const cmdb = createAgentCmdb({
  configPath: './agent-cmdb/config/control-plane.yaml',
  storeDir: './agent-cmdb/state'
});

const result = await cmdb.policy.preflight({
  profile: 'research-agent',
  action: 'web_search',
  tool: 'serpapi',
  intent: 'web_research'
});

if (!result.allowed) {
  console.log(`Blocked: ${result.decision.reason}`);
  return;
}

for (const source of result.route?.sources ?? []) {
  console.log(`Use ${source.id}`);
}
```

> [!WARNING]
> Agent CMDB evaluates policy. It does not intercept tool calls. Your agent must call `preflight()` before every action you want governed.

## API Shape

`createAgentCmdb()` returns three clients plus backward-compatible flat methods:

```ts
const cmdb = createAgentCmdb({ configPath, storeDir, brainDir });

await cmdb.policy.preflight(request);
await cmdb.policy.resolveRoute({ profile: 'research-agent', intent: 'web_research' });

await cmdb.memory.logEvidence(evidence);
await cmdb.memory.readEntity('agent-security');
await cmdb.memory.generateDailyDigest('research-agent');

await cmdb.ops.recordSourceFailure('serpapi');
await cmdb.ops.calculateReliability('research-agent');
await cmdb.ops.getCostSummary('research-agent', '2026-05-25');
```

Flat access still works for existing users:

```ts
await cmdb.preflight(request);
await cmdb.logEvidence(evidence);
```

## Policy Library Config

Agent CMDB reads YAML or JSON:

```yaml
version: "1.0"
updatedAt: "2026-05-25"

sources:
  - id: serpapi
    label: SerpAPI Web Search
    kind: tool
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
        sources: [serpapi]

policies:
  - id: allow-research
    effect: allow
    profiles: [research-agent]
    actions: [web_search, summarize]
    tools: [serpapi]
    reason: Research agent can use read-only sources.

  - id: deny-social-posting
    effect: deny
    actions: [social_post, social_reply, social_dm]
    reason: Social media actions are disabled.
```

Read-only sources are enforced for write-like actions such as `post`, `publish`, `send`, `update`, and `delete`.

## Runtime Helpers

Shipped in `2.1.0`:

- Source health monitor: `recordSourceFailure()`, `recordSourceSuccess()`, `isSourceAvailable()`.
- Health-aware routing: `resolveRoute()` and `preflight()` skip down sources and report skipped sources.
- Reliability metric: `calculateReliability()` reads a rolling preflight allow-rate cache.
- Cost estimation: `getCostSummary()` aggregates `tokenCount` and `estimatedCost` from evidence records.
- Task checkpoint store: `saveCheckpoint()`, `loadCheckpoint()`, `listCheckpoints()`, `deleteCheckpoint()`.
- Tamper mode: pass `tamperMode: 'fail'` to throw on corrupted JSONL evidence/change stores.

## Local Memory

The optional brain stores markdown files and an index:

```ts
const cmdb = createAgentCmdb({
  configPath: './agent-cmdb/config/control-plane.yaml',
  storeDir: './agent-cmdb/state',
  brainDir: './agent-cmdb/brain'
});

const knowledge = await cmdb.memory.readEntity('agent-security');

await cmdb.memory.writeEntity({
  entityId: 'agent-security',
  content: '## New findings\n\n3 CVEs discovered...',
  actor: 'research-agent',
  reason: 'Daily security scan',
  appendOnly: true
});
```

## CLI

```bash
npx agent-cmdb init
npx agent-cmdb doctor
npx agent-cmdb preflight --profile research-agent --action web_search --tool serpapi --intent web_research
npx agent-cmdb preflight --profile research-agent --action web_search --tool serpapi --intent web_research --dry-run
npx agent-cmdb route --profile research-agent --intent web_research
npx agent-cmdb health
npx agent-cmdb health reset --source serpapi
npx agent-cmdb reliability --profile research-agent
npx agent-cmdb cost --profile research-agent --date 2026-05-25
npx agent-cmdb brain list --brain-dir ./agent-cmdb/brain
npx agent-cmdb digest --profile research-agent --brain-dir ./agent-cmdb/brain
```

## Roadmap

| Release | Status | Scope |
| --- | --- | --- |
| V1.0 | Shipped | Policy evaluation, source routing, object registry, evidence/change store |
| V1.5 | Shipped | npm packaging, dry-run, source freshness, doctor command |
| V1.5.1 | Shipped | default deny, audited preflight, tamper-evident JSONL, sanitization hardening |
| V2.1 | Shipped | source health monitor, reliability metric, cost estimation, task checkpoints, JSONL rotation |
| V3.0 | Planned | namespaces, rate limiting, DLP inspection, trust scoring, schedules, webhooks |
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

Current verification target: 220 tests passing, strict TypeScript clean, clean `dist/` build.
