# Known Debt

This file tracks reviewed issues that are deliberately deferred. Do not market these as solved until a release closes them with tests.

## Closed

### Substring action matching

Closed in v3.1.1. Configured write actions now use exact action-name matching, with tests for `research_update` and `send_summary`.

## Open

### Multi-process write safety

State writes use in-process queues and atomic file replacement where applicable. Multiple independent Node processes sharing one `storeDir` are not a supported high-concurrency mode in V3.1. A future release should add cross-process locking or document a single-writer deployment pattern more formally.

### YAML schema-bomb guard

YAML configs are treated as trusted local files. V3.1 does not enforce file-size, alias, or nesting-depth limits. A future release should add bounds before supporting untrusted or remotely supplied policy config.
