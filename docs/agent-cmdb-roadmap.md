# Agent CMDB - Product roadmap

*The full NMS for AI agents. Built by a network engineer.*

Generated: 2026-05-24
Current version: V1.0.0 (122 tests, policy + memory + digest + security hardening)
Repo: github.com/vikas53953/agent-cmdb-policy-brain
Package: @pylabmit/agent-cmdb

---

## What exists today (V1)

V1 covers two of the five layers an agent operations stack needs.

Layer 1 - Policy (the firewall): allow/deny/approval_required policy engine with deny-wins precedence, source routing with ordered preferences, CMDB object inventory, topology graph with typed relationships, policy shadow and conflict detection, control-plane validation, YAML/JSON config loader, preflight hook with structured denial responses.

Layer 2 - Memory (the knowledge base): markdown brain entity files with create/read/write/delete/search, append-only evidence timeline (JSONL), changelog with before/after diffs, daily and weekly digest generation, staleness detection with 7-day TTL, content sanitization against prompt injection.

What V1 solves: 12 of the 30 agent production problems (acts without permission, uses wrong source, repeats work, no audit trail, can't see knowledge state, config drift, and six others).

What V1 does not solve: 18 problems related to reliability, security hardening, observability, and management at scale.

---

## Version plan overview

| Version | Codename | Theme | New problems solved | Estimated Codex effort |
| --- | --- | --- | --- | --- |
| V1.0 | Firewall | Policy + memory | 12 of 30 | Done (122 tests, ~1.1M tokens) |
| V1.5 | Hardline | Publish to npm + quick wins | 14 of 30 | ~200K tokens, ~15 min |
| V2.0 | SevOne | SRE + reliability | 20 of 30 | ~400K tokens, ~30 min |
| V3.0 | SOC | Security + observability | 26 of 30 | ~500K tokens, ~40 min |
| V4.0 | FortiManager | Management plane + dashboard | 30 of 30 | ~600K tokens, ~45 min |

---

## V1.5 - Hardline (publish + quick wins)

Theme: Get the package on npm and add the features that are almost free because the infrastructure already exists.

### New features

1. npm publish - actually publish @pylabmit/agent-cmdb to the npm registry.

2. Policy dry-run mode - preflight --dry-run that traces the evaluation path without logging evidence or changes. Lets you test "what would happen if" without side effects. Network analogy: diagnose debug flow on FortiGate.

3. Source freshness scoring - each source in the control plane gets an optional freshnessTtl field (e.g., "7d", "24h", "1h"). The route resolver checks brain entity age against TTL and marks stale sources in the PreflightResult. Network analogy: OSPF LSA MaxAge.

4. npx agent-cmdb doctor - loads control plane, runs validation, checks brain health (entity count, stale entities, orphaned files), checks store health (evidence count, last write time). Prints a clean pass/fail report. Network analogy: show system status on FortiGate.

### Problems solved

Problem 6 (does too little): freshness scoring tells the agent when it needs to go deeper because its knowledge is stale.
Problem 23 (can't test policy): dry-run mode lets you simulate policy evaluation safely.

### Codex prompt for V1.5

```
/goal

Repo: agent-cmdb-policy-brain (local, on main)

== PHASE 1: Policy dry-run ==

Add dryRun?: boolean to PreflightRequest in types.ts.
When dryRun is true, preflightAction returns the full PreflightResult but does NOT call logEvidence or logChange.
Add --dry-run flag to CLI preflight command.
Add tests: dry-run returns same decision as normal but evidence/changes stores remain empty.

== PHASE 2: Source freshness ==

Add freshnessTtl?: string to SourceRef in types.ts (e.g., "7d", "24h", "1h").
Add parseDuration(ttl: string): number to a new src/duration.ts (returns milliseconds).
Update resolveSourceRoute to check brain entity staleness against each source's TTL.
Add staleSourceIds: string[] to ResolvedSourceRoute.
Add tests: route with stale sources marks them, route with fresh sources doesn't.

== PHASE 3: Doctor command ==

Add npx agent-cmdb doctor [--config path] [--store-dir path] [--brain-dir path].
Checks: control plane loads and validates, store directory exists and is writable,
brain index exists and parses, count stale brain entities, count total evidence/changes.
Output: formatted pass/fail report with counts and warnings.
Add tests: doctor passes on valid setup, fails gracefully on missing config.

== PHASE 4: npm publish preparation ==

Verify: npm test, npm run typecheck, npm run build all pass.
Run: npm pack --dry-run and verify tarball contents.
Bump version to 1.5.0.
Do NOT actually run npm publish - just confirm everything is ready.

Commit: "feat: v1.5 - dry-run, source freshness, doctor command"
Target: 130+ tests.
```

---

## V2.0 - SevOne (SRE + reliability)

Theme: Make agents reliable in production. When things fail, fail gracefully. When things degrade, detect it before the user notices. Named after SevOne, your network performance monitoring tool.

### New features

5. Source health monitors - each source gets a health status: up, down, degraded. The system tracks failures per source. After N consecutive failures (configurable, default 5), source status flips to down. Route resolver automatically skips down sources and uses the next source in the preference order. Network analogy: F5 GTM health monitors with pool member failover.

6. Circuit breakers - when a source goes down, set a recovery timeout (default 30 seconds). After timeout, status moves to half-open and one test call is allowed. If it succeeds, source returns to up. If it fails, back to down with another timeout. Network analogy: exact same pattern as circuit breakers in microservices, but applied at the source routing level.

7. Agent SLOs - define reliability targets per profile in the control plane: "research-agent: 95% preflight-allow rate over 24 hours." Track from evidence records. When error budget is exhausted (too many denials or failures), emit a warning in the health report. Network analogy: SevOne SLA monitoring with threshold alerts.

8. Error budgets - calculated from SLO targets. If the SLO is 95% over 24 hours and the agent has had 6 out of 100 actions denied or failed, the error budget is exhausted. The agent profile gets a degraded status. Network analogy: NRE error budget tracking.

9. Token/cost tracking - every preflight decision records estimated token usage and cost (configurable per-source cost rates). Daily digest includes total tokens and cost for the day. Network analogy: bandwidth utilization tracking per interface.

10. Checkpoint/resume - for long-running agent tasks, save a checkpoint file with the current task state (which step, what's been done, what's pending). If the agent crashes, it reads the checkpoint and resumes from where it left off. Network analogy: HA session sync - active sessions survive failover.

### Problems solved

Problem 8 (tool fails silently): health monitors detect failures.
Problem 9 (stuck in loop): circuit breaker stops retrying after N failures.
Problem 10 (cascading failure): circuit breaker + health monitor prevent cascade.
Problem 12 (timeout no recovery): checkpoint/resume enables recovery.
Problem 13 (quality degrades): SLOs detect degradation.
Problem 25 (no capacity planning): token/cost tracking provides the data.

### Codex prompt for V2.0

```
/goal

Repo: agent-cmdb-policy-brain (local, on main)
Read AGENTS.md first.

== PHASE 1: Source health monitors ==

Add to types.ts:
  interface SourceHealth {
    sourceId: string;
    status: 'up' | 'down' | 'degraded';
    consecutiveFailures: number;
    lastChecked: string;
    lastFailure?: string;
    lastSuccess?: string;
    failureThreshold: number;      // default 5
    recoveryTimeoutMs: number;     // default 30000
  }

  interface SourceHealthStore {
    sources: SourceHealth[];
    updatedAt: string;
  }

Create src/health.ts:
  - initHealthStore(storeDir: string): Promise<SourceHealthStore>
  - recordSuccess(storeDir: string, sourceId: string): Promise<SourceHealth>
  - recordFailure(storeDir: string, sourceId: string): Promise<SourceHealth>
  - getSourceHealth(storeDir: string, sourceId: string): Promise<SourceHealth>
  - listSourceHealth(storeDir: string): Promise<SourceHealth[]>
  - isSourceAvailable(health: SourceHealth): boolean
    (up = yes, down = check recovery timeout, half-open after timeout)

Store health state in storeDir/health.json.

Update route-resolver.ts:
  resolveSourceRoute now accepts optional SourceHealthStore.
  If provided, filter out down sources from the route.
  Add skippedSources: string[] to ResolvedSourceRoute.
  If ALL sources for a route are down, throw with descriptive error listing each source's status.

== PHASE 2: Circuit breakers ==

Update health.ts:
  isSourceAvailable logic:
    status === 'up' ? true
    status === 'down' ? check if (now - lastFailure) > recoveryTimeoutMs
      if yes ? return true (half-open), set status to 'degraded'
      if no ? return false
    status === 'degraded' ? true (one call allowed)

  After recordSuccess on a degraded source ? set to 'up', reset consecutiveFailures
  After recordFailure on a degraded source ? set to 'down', increment failures

Add CLI: npx agent-cmdb health [--store-dir path]
  Lists all sources with their health status, failure count, last checked time.

== PHASE 3: Agent SLOs ==

Add to control plane schema:
  profiles[].slo?: {
    target: number;           // 0.0 to 1.0, e.g., 0.95 for 95%
    windowHours: number;      // e.g., 24
    metric: 'allow_rate';     // what to measure
  }

Create src/slo.ts:
  - calculateSlo(storeDir: string, profile: string, windowHours: number): Promise<SloResult>
    Reads evidence for the profile within the window.
    Counts allow vs deny vs approval_required decisions.
    Returns { target, actual, withinBudget, remaining, windowStart, windowEnd }

  - interface SloResult {
      profile: string;
      target: number;
      actual: number;
      withinBudget: boolean;
      errorBudgetRemaining: number;  // 0.0 to 1.0
      totalDecisions: number;
      allowedCount: number;
      deniedCount: number;
      windowStart: string;
      windowEnd: string;
    }

Update generateReadinessReport to include SLO status for each profile.
Update daily digest to include SLO compliance section.

Add CLI: npx agent-cmdb slo --profile <profile> [--window 24]

== PHASE 4: Token/cost tracking ==

Add to SourceRef: estimatedCostPerCall?: number (USD, e.g., 0.001 for a cheap API, 0.05 for an LLM call).
Add to EvidenceRecord: tokenCount?: number, estimatedCost?: number.
Update daily digest to include cost summary section.
Add CLI: npx agent-cmdb cost --profile <profile> [--date YYYY-MM-DD]

== PHASE 5: Checkpoint/resume ==

Create src/checkpoint.ts:
  - interface AgentCheckpoint {
      id: string;
      profile: string;
      taskDescription: string;
      currentStep: number;
      totalSteps: number;
      completedSteps: string[];
      pendingSteps: string[];
      state: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
    }

  - saveCheckpoint(storeDir: string, checkpoint: AgentCheckpoint): Promise<void>
  - loadCheckpoint(storeDir: string, checkpointId: string): Promise<AgentCheckpoint | null>
  - listCheckpoints(storeDir: string, profile?: string): Promise<AgentCheckpoint[]>
  - deleteCheckpoint(storeDir: string, checkpointId: string): Promise<void>

Store checkpoints in storeDir/checkpoints/ as individual JSON files.

== PHASE 6: Verify ==

npm test ? 170+ tests
npm run typecheck ? 0 errors
npm run build ? clean
Bump version to 2.0.0.
Commit: "feat: v2.0 - health monitors, circuit breakers, SLOs, cost tracking, checkpoints"
```

---

## V3.0 - SOC (security + observability)

Theme: Harden agents against attacks and give operators full visibility. Named after your Security Operations Center mindset from the Secure Intelligence Summit.

### New features

11. Multi-agent namespaces (VDOMs) - each agent profile gets its own isolated namespace. Profile A cannot read Profile B's brain entities, evidence, or checkpoints. Enforced at the filesystem level: each namespace gets its own storeDir and brainDir subdirectory. Network analogy: FortiGate VDOMs with per-VDOM routing and policy tables.

12. Rate limiting - configurable limits per source per profile: "research-agent can make max 100 serpapi calls per hour." Track call counts in a rolling window. Block with a descriptive error when limit is hit. Network analogy: QoS rate limiting on interface.

13. DLP / content inspection - before an agent writes to any external destination, scan the output for PII patterns (email, phone, SSN, credit card), API key patterns (sk-*, ghp_*, AKIA*), and internal URL patterns. Block or redact. Configurable sensitivity levels. Network analogy: FortiGate DLP profiles with content inspection.

14. Agent trust scoring - each profile gets a trust score (0-100, default 80). Trust decreases on: policy violations (-10), SLO breaches (-5), failed health checks (-2). Trust increases on: successful task completion (+1), clean daily digest (+2). When trust drops below a threshold (default 50), the profile automatically downgrades to a restricted policy set. Network analogy: NAC trust scoring with quarantine VLAN.

15. Time-based policies (schedule objects) - policies can have an optional schedule field: { days: ['mon','tue','wed','thu','fri'], startHour: 9, endHour: 18, timezone: 'Asia/Kolkata' }. Policy only applies during the scheduled window. Network analogy: FortiGate schedule objects on firewall policies.

16. Webhook notifications - configurable webhooks that fire on: policy violation, SLO breach, circuit breaker trip, trust score drop, daily digest completion. Supports HTTP POST to any URL. Network analogy: SNMP traps to NMS.

17. Prompt injection detection on brain reads - when an agent reads a brain entity, scan the content for injection patterns before returning it. If detected, flag the entity as potentially compromised and return a warning. Network analogy: IPS inline inspection on inbound traffic.

### Problems solved

Problem 5 (does too much): rate limiting caps API calls.
Problem 7 (misinterprets intent): trust scoring detects degrading agent behavior.
Problem 15 (leaks data): DLP blocks PII and secrets in output.
Problem 3 (hallucination): trust scoring + brain verification catches drift.
Problem 11 (context overflow): brain offloads long-term memory, reducing context pressure.
Problem 26 (works in test not prod): trust scoring detects production-specific degradation.

### Codex prompt for V3.0

```
/goal

Repo: agent-cmdb-policy-brain (local, on main)
Read AGENTS.md first.

/spawn --reasoning high "Build multi-agent namespaces: add namespace isolation to IAgentCMDB so each profile gets its own storeDir/brainDir subdirectory. createAgentCmdb({ namespace: 'gemma4cloud' }) scopes all operations to that namespace. Test that Profile A cannot read Profile B's brain entities. Write to /tmp/vdom-report.txt"

/spawn --reasoning high "Build rate limiting: create src/rate-limiter.ts with a sliding window counter per source per profile. Store counts in storeDir/rate-limits.json. Add rateLimit?: { maxCalls: number, windowMinutes: number } to SourceRef. Update route resolver to check rate limits before including a source. Block with descriptive error when limit hit. Write to /tmp/rate-limit-report.txt"

/spawn --reasoning high "Build DLP content inspection: create src/dlp.ts with scanForSensitiveContent(text: string): DlpResult. Detect: email, phone, SSN, credit card, API key patterns (sk-*, ghp_*, AKIA*), internal URLs. Return { clean: boolean, findings: DlpFinding[] }. Add optional dlpEnabled: boolean to AgentProfile. When enabled, scan evidence summaries and brain write content before persisting. Block or redact based on dlpAction: 'block' | 'redact'. Write to /tmp/dlp-report.txt"

/spawn --reasoning high "Build trust scoring: create src/trust.ts with calculateTrustScore(storeDir: string, profile: string): TrustScore. Read evidence for policy violations (-10), SLO breaches (-5), health check failures (-2). Read evidence for successful completions (+1), clean digests (+2). Return { profile, score, tier, events }. Tier: trusted (80-100), normal (50-79), restricted (20-49), quarantined (0-19). When trust < threshold, preflightAction uses a restricted policy set. Write to /tmp/trust-report.txt"

After all 4 subagents complete, read all reports, integrate the modules, fix issues.

Then build schedule objects and webhook notifications sequentially.

Schedule objects:
  Add schedule?: { days: string[], startHour: number, endHour: number, timezone: string } to PolicyRule.
  Update policyMatches to check schedule. Use Intl.DateTimeFormat for timezone.
  Add tests with mocked time.

Webhook notifications:
  Create src/webhooks.ts.
  Add webhooks?: { url: string, events: string[] }[] to control plane config.
  Events: policy_violation, slo_breach, circuit_breaker_trip, trust_drop, digest_complete.
  Fire HTTP POST with JSON payload on each event.
  Add tests with a mock HTTP server.

Final:
  npm test ? 220+ tests
  npm run typecheck ? 0 errors
  npm run build ? clean
  Bump version to 3.0.0.
  Commit: "feat: v3.0 - VDOMs, rate limiting, DLP, trust scoring, schedules, webhooks"
```

---

## V4.0 - FortiManager (management plane + dashboard)

Theme: Central management, visual operations, and the features that turn Agent CMDB from a developer tool into an operations platform. Named after FortiManager, the central management system for your 800+ FortiGate fleet.

### New features

18. REST/MCP API - expose all IAgentCMDB operations as a local HTTP server (Hono or Express) and as an MCP server. Any agent framework can call Agent CMDB without importing the TypeScript package. Network analogy: FortiManager REST API / SNMP management interface.

19. SOC dashboard (React UI) - a local Vite+React app that shows: policy table with hit counts, evidence timeline with search and filters, brain entity map with staleness indicators, source health status with circuit breaker state, SLO compliance gauges, trust score per profile, recent denials with reasons, daily/weekly digest viewer, cost tracking charts. Network analogy: FortiAnalyzer SOC dashboard.

20. Policy versioning with rollback - every policy change gets a revision number and timestamp. Store revisions in storeDir/revisions/ as timestamped JSON files. CLI command to diff revisions and rollback. Network analogy: FortiManager config revision history.

21. Agent onboarding templates - npx agent-cmdb template creates a new profile from a template. Ship templates for common agent types: research agent, content creator, code assistant, customer support. Each template has sensible default policies, sources, and guardrails. Network analogy: FortiManager device templates.

22. Incident response runbooks - when an agent violation occurs (policy deny, trust drop, SLO breach), automatically generate an incident record in brain/decisions/ with: what happened, which rule triggered, what the agent was trying to do, recommended next steps. Network analogy: SOC incident response playbooks.

23. Agent HA / failover - define backup profiles in the control plane. When primary profile's trust drops below quarantine threshold or its error budget is exhausted, automatically failover to the backup profile (which may have more restricted permissions). Network analogy: FortiGate HA active-passive with automatic failover.

24. Knowledge transfer between agents - export a brain entity set as a portable archive (tar.gz of markdown files + index.json). Import into another agent's brain. Network analogy: config export/import between FortiGate devices.

### Problems solved

Problem 14 (inconsistent format): templates standardize agent setup.
Problem 20 (no unified view): dashboard provides the single pane of glass.
Problem 22 (no change management): policy versioning with rollback.
Problem 24 (manual onboarding): templates automate setup.
Problem 27 (no IR playbook): automated incident records.
Problem 28 (external dependency): HA failover provides resilience.
Problem 29 (no knowledge transfer): brain export/import.
Problem 30 (can't measure value): dashboard + SLOs + cost tracking = full measurement.

### Codex prompt for V4.0

```
/goal

Repo: agent-cmdb-policy-brain (local, on main)
Read AGENTS.md first.

== PHASE 1: REST/MCP API ==

/spawn --reasoning high "Create src/server.ts using Hono. Expose endpoints: POST /preflight, GET /health, GET /report, GET /brain/:entityId, POST /brain, GET /evidence, GET /changes, GET /slo/:profile, GET /trust/:profile. Each endpoint wraps the corresponding IAgentCMDB method. Add CORS. Add request logging. Port configurable via env AGENT_CMDB_PORT (default 3141). Write to /tmp/server-report.txt"

/spawn --reasoning high "Create src/mcp-server.ts implementing the MCP protocol. Register tools: preflight, resolveRoute, readEntity, writeEntity, searchEntities, health, report, slo, trust. Each tool wraps IAgentCMDB. Use @modelcontextprotocol/sdk. Write to /tmp/mcp-report.txt"

== PHASE 2: Policy versioning ==

Create src/revisions.ts:
  - saveRevision(storeDir: string, controlPlane: ControlPlane): Promise<string>
    Saves to storeDir/revisions/{timestamp}-{hash}.json. Returns revision ID.
  - listRevisions(storeDir: string): Promise<RevisionInfo[]>
  - loadRevision(storeDir: string, revisionId: string): Promise<ControlPlane>
  - diffRevisions(storeDir: string, fromId: string, toId: string): Promise<RevisionDiff>
  - rollbackToRevision(storeDir: string, revisionId: string): Promise<ControlPlane>

CLI: npx agent-cmdb revisions list
     npx agent-cmdb revisions diff --from <id> --to <id>
     npx agent-cmdb revisions rollback --to <id>

== PHASE 3: Templates ==

Create templates/ directory with YAML configs:
  - templates/research-agent.yaml
  - templates/content-creator.yaml
  - templates/code-assistant.yaml
  - templates/customer-support.yaml

Each template: 1 profile, 3-5 policies, 2-4 sources, 1-2 routes.

CLI: npx agent-cmdb template list
     npx agent-cmdb template apply --name research-agent --dir ./agent-cmdb

== PHASE 4: Incident response ==

Create src/incidents.ts:
  - generateIncidentRecord(options: { profile, decision, context }): Promise<string>
    Writes to brain/decisions/{timestamp}-{type}.md
    Content: what happened, which rule, what was attempted, impact, recommended actions.
  - Auto-trigger on: policy deny with canEscalate=false, trust drop below threshold,
    SLO breach, circuit breaker trip.

== PHASE 5: Dashboard ==

Create dashboard/ as a Vite+React app.
Pages: Overview (health summary), Policies (table with hit counts), Evidence (timeline),
Brain (entity cards with staleness), Health (source status), SLOs (gauges), Trust (per-profile),
Cost (daily/weekly charts), Digests (viewer).
Data source: REST API from Phase 1.
Use Tailwind + shadcn/ui.

== PHASE 6: Verify ==

npm test ? 280+ tests
npm run typecheck ? 0 errors
npm run build ? clean
Bump version to 4.0.0.
Commit: "feat: v4.0 - REST/MCP API, dashboard, versioning, templates, incidents"
```

---

## The complete problem coverage map

| # | Agent problem | V1.0 | V1.5 | V2.0 | V3.0 | V4.0 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Acts without permission | SOLVED | | | | |
| 2 | Uses wrong source | SOLVED | | | | |
| 3 | Hallucinates and acts | partial | | | trust scoring | |
| 4 | Repeats work | SOLVED | | | | |
| 5 | Does too much | | | | rate limiting | |
| 6 | Does too little | | freshness | | | |
| 7 | Misinterprets intent | | | | trust + brain | |
| 8 | Tool fails silently | | | health monitors | | |
| 9 | Stuck in loop | | | circuit breakers | | |
| 10 | Cascading failure | | | circuit breakers | | |
| 11 | Context overflow | partial | | | | |
| 12 | Timeout no recovery | | | checkpoints | | |
| 13 | Quality degrades | | | SLOs | | |
| 14 | Inconsistent format | | | | | templates |
| 15 | Leaks private data | sanitize | | | DLP | |
| 16 | Contradicts itself | brain | | | | |
| 17 | No audit trail | SOLVED | | | | |
| 18 | Can't see knowledge | SOLVED | | | | |
| 19 | Can't replay failure | partial | | | | |
| 20 | No unified view | | | | | dashboard |
| 21 | Config drift | validate | | | | |
| 22 | No change management | changelog | | | | versioning |
| 23 | Can't test policy | | dry-run | | | |
| 24 | Manual onboarding | init | | | | templates |
| 25 | No capacity planning | | | cost tracking | | |
| 26 | Works in test not prod | | | | trust scoring | |
| 27 | No IR playbook | | | | | incidents |
| 28 | External dependency | routing | | health + CB | | HA failover |
| 29 | No knowledge transfer | | | | | brain export |
| 30 | Can't measure value | | | SLOs + cost | | dashboard |

Coverage by version: V1.0 = 12, V1.5 = 14, V2.0 = 20, V3.0 = 26, V4.0 = 30.

---

## Competitive positioning at each version

V1.0 (now): Only OSS tool that combines policy enforcement + source routing + CMDB inventory + local brain memory in one package. Nobody else has source routing.

V1.5: First agent tool with policy dry-run and source freshness scoring. Microsoft AGT doesn't have either.

V2.0: First agent tool with source-level circuit breakers (Microsoft does agent-level) and checkpoint/resume. First to combine SRE practices with agent memory.

V3.0: First local-first agent tool with full security stack: VDOM isolation + rate limiting + DLP + trust scoring + time-based policies + webhooks. Microsoft has this at enterprise scale but not local-first.

V4.0: The full NMS. No other project combines policy + memory + SRE + security + management plane + dashboard in one package. This is FortiGate + FortiAnalyzer + FortiManager + SevOne for AI agents.

---

## Build order recommendation

V1.5 first - it's 15 minutes of Codex time and gives you something publishable on npm immediately. The dry-run and doctor commands are quick wins that make the package feel polished.

V2.0 next - this is the highest-value increment. Health monitors and circuit breakers are the features that make the difference between "interesting project" and "I need this in production." SLOs are the feature that makes managers care.

V3.0 can be split into two releases (V3.0a = rate limiting + DLP + trust, V3.0b = schedules + webhooks + VDOMs) if you want faster iteration.

V4.0 is the "platform" release. The dashboard alone could take a full day. Consider building the REST/MCP API first (enables other people to build their own dashboards) and shipping the React dashboard as a separate companion package.

---

## AGENTS.md additions for the full roadmap

```markdown
## V2+ development rules
- Every new module gets its own file. No adding to engine.ts.
- Health state is stored in storeDir/health.json, not in memory.
- SLO calculations read from evidence store - no new data sources.
- Circuit breaker state persists across process restarts.
- Rate limit windows use sliding-window counters, not fixed buckets.
- DLP patterns are configurable via the control plane, not hardcoded.
- Trust score changes are logged as evidence records (full audit trail).
- Schedule evaluation uses Intl.DateTimeFormat - no timezone libraries.
- Webhooks are fire-and-forget with a 5-second timeout. Never block preflight.
- The REST server is optional - the package works without it.
- The dashboard is a separate build target, not part of the npm package.
```

