# Agent CMDB

Agent CMDB is a network-style control plane for AI agents. V2 answers these questions:

- Is this action allowed for this profile?
- Which source/tool should the profile use first?
- What objects, jobs, memory layers, and tools exist?
- Which nodes are related in the graph?
- What evidence and changes were recorded?
- Is the control plane healthy enough for an agent preflight?

It is intentionally local and deterministic. No live Hermes config is changed by this tool.

Control-plane data lives in `data/hermes-v2.json` and is loaded through `loadDefaultControlPlane()`. For integration work, use the `IAgentCMDB` facade from `src/interface.ts` or the one-call Hermes scaffold in `src/hermes-preflight.ts` instead of importing engine internals directly.

## Examples

Run an action preflight:

```powershell
npx tsx src/cli.ts preflight --profile gemma4cloud --action x_account_post --tool xurl --intent x_research
```

Expected: `allowed: false`.

Check whether Gemma can post through xurl:

```powershell
npx tsx src/cli.ts policy --profile gemma4cloud --action x_account_post --tool xurl
```

Expected: `deny`.

Resolve the Apple weather route:

```powershell
npx tsx src/cli.ts route --profile apple-farming --intent weather
```

Expected: `apple-wiki` first, then PP weather tools.

Inspect a profile:

```powershell
npx tsx src/cli.ts inspect --profile gemma4cloud
```

Expected: purpose, guardrails, and source routes.

List inventory:

```powershell
npx tsx src/cli.ts inventory --profile gemma4cloud
```

Expected: Gemma profile objects and jobs.

Inspect graph neighbors:

```powershell
npx tsx src/cli.ts graph --id profile.gemma4cloud
```

Expected: related sources and jobs.

Record evidence:

```powershell
npx tsx src/cli.ts evidence-add --profile gemma4cloud --source techmeme-pp-cli --intent x_research --summary "Agent research signal captured" --trust medium
```

List evidence:

```powershell
npx tsx src/cli.ts evidence-list --profile gemma4cloud
```

Record a change:

```powershell
npx tsx src/cli.ts change-add --target policy.global-deny-xurl-account-actions --target-type policy --action verify --actor codex --reason "Confirmed xurl remains blocked"
```

Generate readiness report:

```powershell
npx tsx src/cli.ts report
```

Expected: counts, denied actions, paused/blocked objects, and validation status.

Hermes preflight scaffold:

```ts
import { hermesPreflight } from './src/hermes-preflight.js';

const result = await hermesPreflight('x_account_post', 'gemma4cloud', 'xurl', 'x_research');
```

Expected: denied actions log evidence, and every decision logs a change record.

## V2 Guardrails

- No xurl/X Developer API account actions.
- No X posting, replying, liking, bookmarking, DM, or media upload.
- No Bot Ops / Status sends.
- GBrain remains paused.
- `apple-farming` uses Obsidian/wiki first.
- `gemma4cloud` uses Grok/xAI OAuth and PP tools for read-only research.
