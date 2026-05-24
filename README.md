# Agent CMDB

The firewall for AI agents.

Agent CMDB gives agents the control-plane primitives network engineers already trust: policy enforcement, source routing, inventory, graph relationships, and audit trails before an agent acts.

Use it when you need to answer:

- Is this agent allowed to do this action?
- Which source/tool should it use first?
- What rule blocked it, and why?
- What evidence and config changes were recorded?
- Is my agent control plane healthy enough to run?

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

const result = cmdb.preflight({
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
- [examples/hermes/control-plane.json](examples/hermes/control-plane.json): a real-world Hermes profile map.
- [examples/langchain](examples/langchain): a small LangChain-style pre-tool-call wrapper.

## Roadmap

The product roadmap lives in [docs/agent-cmdb-roadmap.md](docs/agent-cmdb-roadmap.md). It maps 30 production agent problems to release tiers from V1.5 Hardline through V4.0 FortiManager.

## CLI

```bash
npx agent-cmdb init
npx agent-cmdb preflight --profile research-agent --action web_search --tool serpapi --intent web_research
npx agent-cmdb policy --profile research-agent --action social_post --tool x
npx agent-cmdb route --profile research-agent --intent web_research
npx agent-cmdb brain list --brain-dir ./agent-cmdb/brain
npx agent-cmdb brain search --brain-dir ./agent-cmdb/brain --keyword security
npx agent-cmdb digest --profile research-agent --brain-dir ./agent-cmdb/brain
npx agent-cmdb report
```

Use a specific config file:

```bash
npx agent-cmdb preflight --config ./examples/hermes/control-plane.json --profile gemma4cloud --action x_account_post --tool xurl --intent x_research
```

## Mental Model

If you know network operations, you already know Agent CMDB:

| Network concept | Agent CMDB |
| --- | --- |
| Firewall policy | Policy engine |
| Routing table | Source routing |
| SIEM / syslog | Evidence timeline |
| Config archive | Brain entity files |
| FortiAnalyzer reports | Daily/weekly digests |
| Runbook library | Decision records |
| CMDB | Entity index |

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

Agent CMDB combines policy enforcement with local agent memory. The brain is optional - omit `brainDir` if you only need the firewall.

## Development

```bash
npm test
npm run typecheck
npm run build
```

Current verification target:

- 110+ tests passing
- strict TypeScript clean
- clean `dist/` build
