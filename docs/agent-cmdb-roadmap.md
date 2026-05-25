# Agent CMDB Roadmap

Agent CMDB is a local-first TypeScript library for policy evaluation, source routing, markdown memory, and tamper-evident audit logs for AI agents.

This roadmap uses only shipped feature names that match the code. Planned items are explicitly marked planned.

## Shipped Releases

| Release | Status | Shipped scope |
| --- | --- | --- |
| V1.0 | Shipped | Policy evaluation, deny-wins policy selection, source routing, object registry, graph relationships, evidence/change store |
| V1.5 | Shipped | npm packaging, dry-run preflight, source freshness signals, doctor command |
| V1.5.1 | Shipped | audited preflight path, default deny, tamper-evident JSONL records, sanitization hardening |
| V2.1 | Shipped | source health monitor, health-aware route resolution, reliability metric, cost estimation, task checkpoint store, daily evidence rotation |

## V2.1 Feature Claims

| Feature | Status | Honest description |
| --- | --- | --- |
| Source health monitor | Shipped | Tracks consecutive source failures, marks sources down, supports one half-open probe, and resets on success |
| Health-aware routing | Shipped | `preflight()` and `resolveRoute()` skip down sources and return `skippedSources` |
| Reliability metric | Shipped | Calculates preflight allow rate from a rolling cache |
| Cost estimation | Shipped | Aggregates `tokenCount` and `estimatedCost` values provided in evidence records |
| Task checkpoint store | Shipped | Saves, loads, lists, and deletes task checkpoint JSON files |
| Tamper mode | Shipped | `tamperMode: 'fail'` throws on corrupted JSONL evidence/change stores; default mode warns |
| Daily evidence rotation | Shipped | Evidence writes to `evidence-YYYY-MM-DD.jsonl`; legacy `evidence.jsonl` remains readable |

## Planned Releases

| Release | Status | Planned scope |
| --- | --- | --- |
| V3.0 | Planned | namespaces, rate limiting, DLP inspection, trust scoring, schedule-aware policies, webhooks |
| V4.0 | Planned | REST/MCP API, dashboard, policy versioning, templates, incident records |

## Problem Coverage

| # | Agent problem | Current status |
| --- | --- | --- |
| 1 | Agent acts without permission | PARTIAL: caller must invoke `preflight()` |
| 2 | Agent uses the wrong source | PARTIAL: routes are explicit, but caller must use returned route |
| 3 | Agent hallucinates and acts | PARTIAL: policy and memory help, but no truth verification engine |
| 4 | Agent repeats work | PARTIAL: markdown memory and digests can reduce repeats |
| 5 | Agent does too much | PLANNED: rate limiting |
| 6 | Agent does too little | PARTIAL: freshness signals show stale context, not completeness |
| 7 | Agent misinterprets intent | PLANNED: trust scoring and stronger intent checks |
| 8 | Tool fails silently | PARTIAL: source health can be recorded, but caller must report failures |
| 9 | Agent retries a bad source | PARTIAL: health monitor skips down sources once failures are recorded |
| 10 | Cascading source failure | PARTIAL: route failover helps when fallback sources exist |
| 11 | Context overflow | PARTIAL: local memory can move durable facts out of prompt context |
| 12 | Timeout recovery | PARTIAL: task checkpoints store state, but agent owns resume logic |
| 13 | Quality degradation | PARTIAL: reliability metric reports allow-rate drift |
| 14 | Inconsistent setup | PLANNED: templates |
| 15 | Data leakage | PARTIAL: text sanitization exists; DLP is planned |
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
| 26 | Works in test, fails in prod | PLANNED: trust scoring and observability |
| 27 | No incident workflow | PLANNED: incident records |
| 28 | External dependency failure | PARTIAL: source routing and health-aware failover |
| 29 | No knowledge transfer | PLANNED: brain export/import |
| 30 | Can't measure value | PARTIAL: reliability, cost estimates, and digests provide signals |

## Build Order

1. Harden V2.1 docs, names, and package boundary.
2. Add V3.0 security controls only after Gate 0.1 validates the feature names and scope.
3. Build V4.0 API/dashboard after the library surface stays stable for real integrations.

## SHIP Notes

Every shipped README claim should have a matching test. Every planned claim should be marked planned. Avoid market-first or "full platform" claims until independent evidence supports them.
