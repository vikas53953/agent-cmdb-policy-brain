# Agent CMDB

[![CI](https://github.com/vikas53953/agent-cmdb-policy-brain/actions/workflows/ci.yml/badge.svg)](https://github.com/vikas53953/agent-cmdb-policy-brain/actions/workflows/ci.yml)
![Tests](https://img.shields.io/badge/tests-161_passing-brightgreen)

Policy enforcement and memory for AI agents.

Agent CMDB gives your agent a preflight check before it acts: policy enforcement, source routing, inventory, graph relationships, and audit trails.

Use it when you need to answer:

- Is this agent allowed to do this action?
- Which source/tool should it use first?
- What rule blocked it, and why?
- What evidence and config changes were recorded?
- Is my agent control plane healthy enough to run?

## How It Works

Agent CMDB is a library your agent calls before acting. You wire `preflight()` into your agent's tool-call path. It evaluates policy, routes to the best source, and logs the decision. It does not automatically intercept tool calls - you integrate it into your agent framework.

## What This Is NOT

Agent CMDB is not a network proxy or middleware that sits between your agent and its tools. It is a policy evaluation library. For automatic tool-call interception, see Agent Airlock or `airlock-dev/airlock`.

## Install

```bash
npm install @pylabmit/agent-cmdb
npx agent-cmdb init
```

`init` creates:

```text
agent-cmdb/
  config/
    control-plane.yaml
  state/
    evidence.jsonl
    changes.jsonl
  brain/
    entities/
      people/
      companies/
      topics/
      tools/
      projects/
    decisions/
    digest/
      daily/
      weekly/
    index.json
agent-cmdb.config.ts
```

## Quick Start

```ts
import { createAgentCmdb } from '@pylabmit/agent-cmdb';

const cmdb = createAgentCmdb({
  configPath: './agent-cmdb/config/control-plane.yaml',
  storeDir: './agent-cmdb/state'
});

const result = await cmdb.preflight({
  profile: 'research-agent',
  action: 'web_search',
  tool: 'serpapi',
  intent: 'web_research'
});

if (!result.allowed) {
  console.log(`Blocked: ${result.decision.reason}`);
  console.log(`Can escalate: ${result.decision.canEscalate}`);
  console.log(`Try instead: ${result.decision.suggestedAlternative}`);
} else {
  for (const source of result.route?.sources ?? []) {
    console.log(`Use ${source.id} (${source.kind})`);
  }
}
```

> [!WARNING]
> Agent CMDB evaluates policy. It does not intercept tool calls. Your agent must call `preflight()` before every action you want governed.

### Migration note for 1.5.1

Agent CMDB now defaults to deny when no policy matches. If you want unknown actions to require human approval instead of being blocked, add an explicit catch-all `approval_required` rule to your control plane.

## Agent Memory (Brain)

Agent CMDB includes an optional local knowledge base. No database, no embeddings - just markdown files that agents read before acting and update after.

```ts
const cmdb = createAgentCmdb({
  configPath: './agent-cmdb/config/control-plane.yaml',
  storeDir: './agent-cmdb/state',
  brainDir: './agent-cmdb/brain'
});

const knowledge = await cmdb.readEntity('agent-security');
console.log(knowledge.content);
console.log(knowledge.stale ? 'Needs refresh' : 'Fresh');

await cmdb.writeEntity({
  entityId: 'agent-security',
  content: '## New findings\n\n3 CVEs discovered...',
  actor: 'research-agent',
  reason: 'Daily security scan',
  appendOnly: true
});

await cmdb.generateDailyDigest('research-agent');
```

## Control Plane

Agent CMDB reads YAML or JSON.

```yaml
version: "1.0"
updatedAt: "2026-05-25"

sources:
  - id: serpapi
    label: SerpAPI Web Search
    kind: tool
    readOnly: true

  - id: local-docs
    label: Local Documentation
    kind: wiki
    readOnly: true
    freshnessTtl: 7d
    brainEntityId: agent-security

profiles:
  - id: research-agent
    name: Research Agent
    purpose: Web research and summarization
    guardrails:
      - Do not make purchases or financial transactions
      - Do not post to social media
      - Prefer local documentation before external search
    routes:
      - intent: web_research
        sources: [local-docs, serpapi]

policies:
  - id: deny-social-posting
    effect: deny
    actions: [social_post, social_reply, social_dm]
    reason: Social media posting is disabled for all agents

  - id: allow-research
    effect: allow
    profiles: [research-agent]
    actions: [web_search, summarize, extract]
    tools: [serpapi, local-docs]
    reason: Research agent can search and summarize read-only sources
```

Shipped examples:

- [examples/basic/control-plane.yaml](examples/basic/control-plane.yaml): one profile, a few sources, simple allow/deny rules.
- [examples/multi-agent/control-plane.yaml](examples/multi-agent/control-plane.yaml): three profiles with different permissions.

Framework integrations are planned for V2. They are intentionally not shown as shipped examples until they import and wrap real framework APIs.

## Roadmap

The product roadmap lives in [docs/agent-cmdb-roadmap.md](docs/agent-cmdb-roadmap.md). It maps production agent problems to release tiers from reliability hardening through central management and dashboard workflows.

| Release | Status | Scope |
| --- | --- | --- |
| V1.0 | Shipped | Policy engine, source routing, CMDB inventory, evidence store, graph, brain, digest |
| V1.5 | Shipped | npm packaging, dry-run, source freshness, doctor command |
| V1.5.1 | Shipped | single audited preflight, default-deny, tamper-evident JSONL, hardened sanitization |
| V2.0 | Planned | Health monitors, circuit breakers, SLOs, cost tracking, checkpoint/resume |
| V3.0 | Planned | Isolation, rate limiting, DLP inspection, trust scoring, schedules, webhooks |
| V4.0 | Planned | REST/MCP API, dashboard, policy versioning, templates, incident response |

## CLI

```bash
npx agent-cmdb init
npx agent-cmdb doctor
npx agent-cmdb preflight --profile research-agent --action web_search --tool serpapi --intent web_research
npx agent-cmdb preflight --profile research-agent --action web_search --tool serpapi --intent web_research --dry-run
npx agent-cmdb policy --profile research-agent --action social_post --tool x
npx agent-cmdb route --profile research-agent --intent web_research
npx agent-cmdb brain list --brain-dir ./agent-cmdb/brain
npx agent-cmdb brain search --brain-dir ./agent-cmdb/brain --keyword security
npx agent-cmdb digest --profile research-agent --brain-dir ./agent-cmdb/brain
npx agent-cmdb report
```

Use a specific config file:

```bash
npx agent-cmdb preflight --config ./examples/multi-agent/control-plane.yaml --profile research-agent --action social_post --tool social-media-tool --intent web_research
```

## Mental Model

If you know infrastructure operations, you already know Agent CMDB:

| Infrastructure concept | Agent CMDB |
| --- | --- |
| Firewall policy | Policy engine |
| Routing table | Source routing |
| Log management | Evidence timeline |
| Config backups | Brain entity files |
| Automated reports | Daily/weekly digests |
| Operations runbooks | Decision records |
| Asset inventory | Entity index |

`preflight()` is the packet filter before the agent executes.

## Framework Modules

```text
src/types.ts
src/policy-engine.ts
src/route-resolver.ts
src/graph-engine.ts
src/validator.ts
src/store.ts
src/brain.ts
src/digest.ts
src/interface.ts
src/loader.ts
src/preflight.ts
src/cli.ts
```

`src/engine.ts` remains as a compatibility barrel for older imports.

## Design Boundary

Agent CMDB combines policy enforcement with local agent memory. The brain is optional - omit `brainDir` if you only need policy evaluation, source routing, and audit trails.

## Development

```bash
npm test
npm run typecheck
npm run build
```

Current verification target:

- 161 tests passing
- strict TypeScript clean
- clean `dist/` build
