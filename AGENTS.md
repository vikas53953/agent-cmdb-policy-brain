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
