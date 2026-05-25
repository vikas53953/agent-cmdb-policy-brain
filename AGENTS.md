# Agent CMDB - Codex Rules

## Process

This project follows SHIP v4 (docs/SHIP-v4.md).
Every feature must pass Gate 0 (adversarial design review) before code is written and Gate 9 (multi-persona adversarial review) before publish.

Key rules from SHIP v4:
- Every new feature needs 3 test types: positive, negative, bypass
- Every README claim must have a matching test
- No public exports of internal functions (evaluatePolicy, evaluatePreflight)
- Default deny on unmatched policy
- Single entry point per concern -- no duplicate API paths

## OSS hygiene rules

- Never commit personal profile names, tool names, or private agent names.
- Never commit real user account configuration as an example.
- Never use vendor brand names in user-facing docs when a generic infrastructure term works.
- Use generic infrastructure concepts: firewall, routing table, log management, central management.
- The network analogy is the design pattern, not the marketing message.
- All test data uses generic names: research-agent, content-agent, support-agent.
- Examples must be understandable by someone who has never managed network appliances.
- Reports and internal design notes are excluded from npm publish.

## Engineering rules

- Keep source, tests, examples, and README free of private configuration.
- Run `npm test`, `npm run typecheck`, `npm run build`, and `npm pack --dry-run` before publish-facing commits.
- Run a sensitive-term grep before declaring the package ready to publish.

## V2 development rules

- No new public exports from engine.ts. Internal functions stay internal.
- All new state files use the write-queue + hash-chain pattern from store.ts.
- Health state persists in storeDir/health.json with atomic writes.
- Reliability calculations use a rolling cache file, not full evidence scan.
- Every new IAgentCMDB method: positive test + negative test + bypass test.
- The source health monitor state machine is not marketed as a production circuit breaker.
- No new npm dependencies. Node built-ins only (crypto, fs, path).
- Checkpoints use prevHash for tamper detection.
- Cost estimation is advisory (like V1 freshness). No cost-based deny.
- All CLI commands have --help with one-line description.

## V2.1 honesty rules

- "Circuit breaker" is now "source health monitor" everywhere user-facing.
- "SLO" is now "reliability metric" everywhere user-facing.
- "Cost tracking" is now "cost estimation" everywhere user-facing.
- "Checkpoint/resume" is now "task checkpoint" everywhere user-facing.
- "CMDB inventory" is now "object registry" everywhere user-facing.
- "Control plane" is now "policy library" in user-facing positioning.
- `evaluatePolicy` never throws for an unknown profile; it returns deny.
- Half-open allows exactly one probe call before success/failure is recorded.
- JSONL evidence files rotate daily. Hash chains span file boundaries.
- `IAgentCMDB` is split into `policy`, `memory`, and `ops` sub-interfaces.
- Denied preflight returns `route: undefined`.
- `PreflightResult` is a discriminated union.
- `resolveRoute()` must use source health state just like `preflight()`.
- `readOnly` sources must deny write-like actions.
- `tamperMode: 'fail'` must throw on corrupted JSONL evidence/change stores.

## SHIP v4 amendment: Gate 0.1

Before any code, share the feature list with a model that had no part in the design. Ask: "For each feature name, would a specialist in this domain accept this as a real implementation of that concept?" If the answer is no, rename the feature before writing code.
