# Agent CMDB - Codex Rules

## Process

This project follows SHIP v4 (docs/SHIP-v4.md).
Every feature must pass Gate 0 (adversarial design review) before code is written and Gate 9 (multi-persona adversarial review) before publish.
Before every npm publish, run the pre-publish audit template in `audits/pre-publish-audit-template.md` and paste the verdict table into the release notes or handoff.

Key rules from SHIP v4:
- Every new feature needs 3 test types: positive, negative, bypass
- Every README claim must have a matching test
- No public exports of internal functions such as `evaluatePolicy` or unaudited preflight helpers
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
- No new npm dependencies unless the user explicitly approves them.

## V3 rules

- Public API is composable only: `cmdb.policy`, `cmdb.memory`, `cmdb.ops`, and root `cmdb.health()`.
- No flat API compatibility in V3. `cmdb.preflight()` and `cmdb.logEvidence()` must not exist.
- "Policy library" or "policy config" is the user-facing name.
- "Source health monitor" is the user-facing name. Do not market it as a production resilience framework.
- "Preflight analytics" is the user-facing name. Do not use external-availability promise or budget language.
- "Cost estimation" is caller-provided. Do not imply automatic LLM/API instrumentation.
- Workflow resume storage is out of scope for V3.
- `evaluatePolicy` never throws for bad user input; it returns deny.
- Denied preflight returns `route: undefined`.
- `PreflightResult` is a discriminated union.
- `resolveRoute()` must use recorded source health just like `preflight()`.
- `readOnly` sources must deny write-like actions.
- JSONL evidence and change files rotate daily. Hash chains span dated files and legacy files remain readable.
- `tamperMode: 'fail'` must throw on corrupted JSONL evidence/change stores.
- Brain read path warns on prompt-injection patterns and supports `{ stripInjection: true }`.

## SHIP v4 amendment: Gate 0.1

Before any code, share the feature list with a model that had no part in the design. Ask: "For each feature name, would a specialist in this domain accept this as a real implementation of that concept?" If the answer is no, rename the feature before writing code.
