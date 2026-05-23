# Agent CMDB V2 Design

Agent CMDB is a network-style control plane for AI agents. It maps familiar network operations ideas into agent operations:

- session context = running config
- durable rules = startup config
- profile/tool/job inventory = CMDB
- allowed and blocked actions = firewall policy
- source selection = routing table
- evidence and failures = syslog/SIEM
- relationships = topology graph
- updates = config diff and audit log

V2 focuses on deterministic preflight safety before live Hermes integration. It can answer:

- is this action allowed, denied, or approval-required?
- which source route should a profile use for an intent?
- what objects, jobs, sources, tools, and memory layers exist?
- how are profiles, jobs, tools, policies, and memory related?
- what evidence and changes were recorded?
- is the control plane valid?

Live Hermes hooks are intentionally out of scope for V2. Hermes behavior is not changed until a separate preflight integration is implemented.
