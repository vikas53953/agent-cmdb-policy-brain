# Agent CMDB - Codex Rules

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
