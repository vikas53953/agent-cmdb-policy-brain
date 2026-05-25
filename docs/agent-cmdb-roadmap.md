# Agent CMDB Roadmap

Agent CMDB is a local-first TypeScript library for opt-in policy checks, source routing, markdown memory, and hash-chained local audit records for AI agents.

This roadmap uses shipped feature names that match the code. Planned items are explicitly marked planned.

## Shipped Releases

| Release | Status | Shipped scope |
| --- | --- | --- |
| V1.0 | Shipped | Policy evaluation, deny-wins policy selection, source routing, object registry, graph relationships, evidence/change store |
| V1.5 | Shipped | npm packaging, dry-run preflight, source freshness signals, doctor command |
| V1.5.1 | Shipped | audited preflight path, default deny, tamper-evident JSONL records, sanitization hardening |
| V3.0 | Shipped | composable API, preflight analytics, windowed source health monitor, health-aware route resolution, daily JSONL rotation, read-path injection warnings, no public unaudited policy API |

## V3 Feature Claims

| Feature | Status | Honest description |
| --- | --- | --- |
| Composable API | Shipped | `createAgentCmdb()` exposes `policy`, `memory`, `ops`, and root `health()` clients |
| Source health monitor | Shipped | Tracks timestamped source failures within a window, marks sources down, supports one half-open probe, and backs off recovery attempts |
| Health-aware routing | Shipped | `preflight()` and `resolveRoute()` skip sources marked down by recorded health and return `skippedSources` |
| Preflight analytics | Shipped | Reports logged allow/deny counts, rates, top deny rules, and per-action breakdowns |
| Cost estimation | Shipped | Aggregates `tokenCount` and `estimatedCost` values provided in evidence records |
| Tamper mode | Shipped | `tamperMode: 'fail'` throws on corrupted JSONL evidence/change stores; default mode warns |
| Daily JSONL rotation | Shipped | Evidence and change records write to dated files while legacy single-file stores remain readable |
| Local markdown memory | Shipped | Stores human-readable markdown files with a JSON index; no database or embeddings |

## Planned Releases

| Release | Status | Planned scope |
| --- | --- | --- |
| V4.0 | Planned | REST/MCP API, dashboard, policy versioning, templates, incident records |

## Problem Coverage

| # | Agent problem | Current status |
| --- | --- | --- |
| 1 | Agent acts without permission | PARTIAL: caller must invoke `preflight()` |
| 2 | Agent uses the wrong source | PARTIAL: routes are explicit, but caller must use returned route |
| 3 | Agent hallucinates and acts | PARTIAL: policy and memory help, but no truth verification engine |
| 4 | Agent repeats work | PARTIAL: markdown memory and digests can reduce repeats |
| 5 | Agent does too much | PLANNED: rate limiting or framework-level orchestration |
| 6 | Agent does too little | PARTIAL: freshness signals show stale context, not completeness |
| 7 | Agent misinterprets intent | PLANNED: stronger intent checks or framework adapters |
| 8 | Tool fails silently | PARTIAL: source health can be recorded, but caller must report failures |
| 9 | Agent retries a bad source | PARTIAL: health monitor skips down sources once failures are recorded |
| 10 | Cascading source failure | PARTIAL: route failover helps when fallback sources exist |
| 11 | Context overflow | PARTIAL: local memory can move durable facts out of prompt context |
| 12 | Timeout recovery | PLANNED: workflow engines should own resume semantics |
| 13 | Quality degradation | PARTIAL: preflight analytics report decision drift |
| 14 | Inconsistent setup | PLANNED: templates |
| 15 | Data leakage | PARTIAL: text sanitization exists; full DLP is planned |
| 16 | Contradictory memory | PARTIAL: markdown memory is inspectable; conflict resolution is manual |
| 17 | No audit trail | SHIPPED: hash-chained evidence/change records |
| 18 | Can't see knowledge | SHIPPED: markdown brain files and index |
| 19 | Can't replay failure | PARTIAL: audit records help, but no full replay engine |
| 20 | No unified view | PLANNED: dashboard |
| 21 | Config drift | PARTIAL: validation and changelog exist |
| 22 | No change management | PLANNED: policy versioning |
| 23 | Can't test policy | SHIPPED: dry-run preflight |
| 24 | Manual onboarding | PARTIAL: `init` scaffolds a starter workspace |
| 25 | No capacity planning | PARTIAL: cost estimation aggregates provided values |
| 26 | Works in test, fails in prod | PARTIAL: health-aware routing helps when caller records health |
| 27 | No incident workflow | PLANNED: incident records |
| 28 | External dependency failure | PARTIAL: source routing and health-aware failover |
| 29 | No knowledge transfer | PARTIAL: markdown memory and digests are portable |
| 30 | Can't measure value | PARTIAL: preflight analytics, cost estimates, and digests provide signals |

## Build Order

1. Keep V3 honest: no workflow resume storage, no external-availability promise language, no public unaudited policy API.
2. Gather real integration feedback from agents using `cmdb.policy.preflight()`.
3. Add V4 API/dashboard features only after the library surface stays stable for real integrations.

## SHIP Notes

Every shipped README claim should have a matching test. Every planned claim should be marked planned. Avoid market-first or "full platform" claims until independent evidence supports them.
