# Agent CMDB V2 Design

Agent CMDB is a policy library for AI agents. It borrows infrastructure operations patterns, but it remains an application library that the host agent must call.

Mental model:

- session context = running config
- durable rules = startup config
- profile/tool/job registry = object registry
- allowed and blocked actions = policy table
- source selection = routing table
- evidence and failures = log timeline
- relationships = topology graph
- updates = config diff and audit log

V2.1 focuses on deterministic preflight safety before live agent integration. It can answer:

- is this action allowed or denied?
- which source route should a profile use for an intent?
- what objects, jobs, sources, tools, and memory layers exist?
- how are profiles, jobs, tools, policies, and memory related?
- what evidence and changes were recorded?
- is the policy library config valid?

Live agent mutation remains out of scope. The repo exposes `preflight()` through `createAgentCmdb()` as the single integration point an agent can call before acting; it does not change a live agent profile by itself.
