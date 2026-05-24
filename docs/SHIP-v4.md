# SHIP Framework v4.0

## Structured Handoff & Iterative Production

**The complete framework for building production-ready software with AI code generators — designed to catch failures before they ship, not after.**

Author: pylabmit | Version: 4.0 | Date: May 2026
Works with: Codex, Claude Code, Cursor, Windsurf, Composer, any AI builder
GitHub: github.com/vikas53953/ship-studio

---

## Why v4 exists

Every previous version of SHIP assumed the design was correct and focused on whether the implementation matched. That assumption was wrong.

SHIP v1 (8 phases) caught broken builds. SHIP v2 (12 phases) caught missing infrastructure. SHIP v3 (12 gates + scoring) caught incomplete features. SHIP v3.1 (product fidelity + session scoping) caught AI builder misbehavior. None of them caught design-level mistakes.

The Agent CMDB project proved this. The code passed 153 tests, clean TypeScript, clean CI, clean npm publish. Then an independent adversarial reviewer destroyed it in one pass — finding that the "firewall" was opt-in, the "sanitization" preserved attack payloads, the "freshness enforcement" never blocked anything, and three different API entry points had different behaviors. Every one of those problems existed from day one. Every review missed them because every reviewer was asking "does the code work?" instead of "how does the code fail?"

The Clicky project proved the same thing from a different angle. Codex built settings dashboards instead of the cursor companion. It added fallback chains instead of fixing primary paths. It created documentation theater instead of working features. Every session, the AI builder did what was asked — it just wasn't asked the right things.

v4 adds what was missing: adversarial thinking before code exists, mandatory destruction testing before publish, and honest scope enforcement throughout.

---

## The 3 systemic failures SHIP v4 prevents

### Failure 1: Builder bias

When the architect helps design the system, the reviewer defends the design instead of attacking it. When the AI builder writes tests, the tests prove the code works instead of proving it breaks. The solution: separate the "build" role from the "destroy" role. Different people (or AI personas) with different instructions.

### Failure 2: Confirmatory review

Every previous SHIP gate asked "does this work?" — a confirmatory question. The answer was always yes, because the code was written to pass the tests. The right question is "how does this fail?" — an adversarial question. v4 adds adversarial gates that ask: how would an attacker exploit this? How would a confused user misuse this? What does the README claim that the code doesn't deliver?

### Failure 3: Claims without proof

The Agent CMDB roadmap marked 14 of 30 problems as "SOLVED" when several were only partially addressed. The README called it a "firewall" when it was an opt-in library. The test count (153) was impressive but didn't test bypass vectors. v4 requires every claim to be backed by a specific test, and every marketing statement to be verified by an adversarial reviewer who has no investment in the project shipping.

---

## SHIP v4 gate structure

v4 has 15 gates organized into 5 phases. The new additions (marked with NEW) are the gates that would have caught every failure in Agent CMDB and Clicky.

### Phase A: Think before building

**G0: Adversarial design review (NEW — the gate that was missing)**

Before any code exists, before the first Codex prompt, answer these questions. If you skip this gate, everything downstream will inherit the design mistakes.

Deliverable: docs/adversarial-design.md

Contents:

1. Honest scope statement (one sentence, no marketing)
   What does this ACTUALLY do? Not what you wish it did. Not what the roadmap says it will do. What V1 will do on day one.
   
   Test: show this sentence to a stranger. If they expect more than V1 delivers, rewrite it.

   Example of honest: "A TypeScript library that evaluates YAML policy rules and returns allow/deny decisions."
   Example of dishonest: "The firewall for AI agents."

2. What This Is NOT (mandatory, minimum 3 items)
   List everything users might assume but would be wrong about.
   
   Example: "This is not a network proxy. It does not intercept tool calls. It does not enforce anything unless your code calls it."

3. Threat model (5 attack vectors minimum)
   For each: the attack, the severity, and whether V1 prevents it.
   
   Categories to cover:
   - Skip/bypass: what if the user never calls the main function?
   - Injection: what if malicious data enters through inputs?
   - Config tampering: what if someone edits the config file?
   - Concurrency: what if two processes run simultaneously?
   - Trust boundary: where does trust start and end?

4. Three pre-mortems (write postmortems BEFORE building)
   
   Postmortem 1: "We shipped, a user trusted feature X, it didn't actually do Y, they lost Z."
   Postmortem 2: "An attacker exploited the fact that we assumed A."
   Postmortem 3: "A developer spent 4 hours integrating and rage-quit because B."

   These are not hypothetical. Write them as real incident reports. If you can't imagine a failure, you haven't thought hard enough.

5. Claims register (every README claim must have a matching test)
   
   For every feature the README will mention, list the specific test that proves it works AND the specific test that proves it fails gracefully.
   
   Format:
   | README claim | Positive test | Negative test | Bypass test |
   |---|---|---|---|
   | "Policy enforcement" | Allow returns allowed:true | Deny returns allowed:false | Skip preflight entirely — what happens? |
   | "Source routing" | Route returns ordered sources | Missing source throws error | Stale source — does it block or pass? |

6. API surface contract (one entry point per concern)
   
   List every function the user will call. If there are two functions that do similar things with different behavior, that's a design bug. Fix it before writing code.
   
   Rule: if a user can call function A or function B for the same task, and they behave differently, you will ship a bug. Merge them or document the difference prominently.

**G1: Feasibility check**

Can this be built with the chosen tech stack? Are all required APIs available? Are dependencies maintained?

Deliverable: docs/feasibility.md

**G2: Architecture plan**

Module breakdown. What talks to what. Data flow. State management.

Deliverable: docs/architecture.md

Rule (NEW from Agent CMDB lesson): the architecture document must include a "trust boundary diagram" showing where trust starts and ends. If the config file is the trust root, say so. If the user must call a function for enforcement, say so.

### Phase B: Build with discipline

**G3: Milestone plan**

Break the build into milestones. Each milestone is one Codex goal.

Rule: each milestone must have a clear "done" definition that a stranger can verify without reading code.

**G3.5: Product fidelity check (from SHIP v3.1)**

If a reference product exists, compare before proceeding. AI builders tend to build what they imagine instead of what was specified.

**G4: Implementation**

Build milestone by milestone. Each milestone:
- Runs tests before committing
- Updates docs/ship-report.md with results
- Does NOT move to next milestone until current one passes

Rule (NEW): every milestone must include at least one negative test (what happens when the function receives bad input?) and one bypass test (what happens when the function is never called?).

**G5: Security review**

Check for: exposed secrets, SQL injection, XSS, dependency vulnerabilities, auth bypass, data leaks.

Addition (NEW from Agent CMDB): check sanitization effectiveness. If you sanitize input, verify the sanitized output is actually neutralized, not just relabeled. Write a test where the sanitized content is fed to an LLM — does the injection still work?

### Phase C: Verify honestly

**G6: Testing**

10 test types from SHIP v3: unit, API, integration, browser smoke, dashboard click, persistence restart, error state, security grep, performance, accessibility.

Addition (NEW): 3 new mandatory test types.

Type 11: Bypass test. For every security/governance feature, write a test that tries to circumvent it. "What if I never call preflight?" "What if I omit the tool field?" "What if I write directly to the data file?"

Type 12: Claims test. For every claim in the README, write a test that proves it. If the README says "audit trail," test that denied actions appear in the evidence store. If the README says "source routing," test that sources are returned in the configured order.

Type 13: Stranger test. Give the README, the quickstart, and the init command to someone who has never seen the project. Time them. If they can't get value in 15 minutes, the onboarding is broken.

**G7: Integration test (full lifecycle)**

Not unit tests. Not function tests. A single test that runs the entire user journey from install to value to edge case. This is the test that would have caught Agent CMDB's three-preflight-entry-point bug — because it would have called the documented API path and discovered that logging doesn't happen.

**G8: UI/UX review**

Every button does something. No placeholder screens. No "coming soon." No dead UI.

### Phase D: Destroy before shipping (NEW — the entire phase)

**G9: Multi-persona adversarial review (NEW)**

This is the gate that would have caught every Agent CMDB bug. Before publishing, run a 6-persona review — either via Codex subagents, Composer, or a separate Claude conversation.

The 6 personas:

Persona 1 — Red teamer: "How do I break this? How do I bypass security? How do I corrupt data?"

Persona 2 — Angry senior engineer: "I just spent 4 hours evaluating this. Why am I angry? What promised feature didn't work?"

Persona 3 — npm package auditor: "Is this safe to depend on? Are the exports clean? Is the version number honest?"

Persona 4 — Philosopher of software: "For every README claim, is it TRUE, HALF-TRUE, MISLEADING, or a LIE?"

Persona 5 — Production postmortem writer: "Write 2 incident reports from 3 months in the future when this failed in production."

Persona 6 — Competitor PM: "What would I steal from this? What would I mock? What makes me nervous?"

Deliverable: docs/adversarial-review.md

Rule: DO NOT SHIP until the adversarial review is complete and all Critical/High findings are addressed. Medium findings can ship with documentation. Low findings go to the backlog.

**G10: Honest README audit (NEW)**

Read the README as a stranger. For every claim:
- Is the claim backed by a passing test?
- Is the claim limited to what V1 actually does (not the roadmap)?
- Would the claim survive a Composer-style brutal review?

Specific checks:
- Every marketing phrase tested: "firewall" → is it inline mandatory? "enforcement" → is it opt-in or automatic? "memory" → is it keyword search or semantic search?
- The "What This Is NOT" section must exist and be complete
- Roadmap items are clearly labeled "PLANNED" not implied as shipped
- Test count badge matches actual test count
- All example code runs against the published package, not source imports

**G11: Pre-publish verification**

Standard checks: tests pass, types check, build clean, pack output clean, no personal data, no vendor brands, CI green.

Addition (NEW): install verification. Create a temp directory, npm install the package, run the quickstart from the README, verify it works. If the README quickstart doesn't work against the published package, DO NOT SHIP.

### Phase E: Ship and learn

**G12: Operations**

Health endpoint, backup procedure, troubleshooting guide, monitoring.

**G13: Post-ship review**

What worked, what failed, lessons learned, next version backlog.

Addition (NEW): failure catalog. Document every bug found during the adversarial review (G9) and how it was fixed. This becomes the training data for the next project's G0 threat model.

**G14: Retrospective feedback loop (NEW)**

Feed the failure catalog back into SHIP itself. If the adversarial review found a class of bug that no gate caught, add a check for that class to the relevant gate.

This is how SHIP v4 was created — from the Agent CMDB failure catalog.

---

## The CEO Workflow v2

The workflow for building with AI code generators, updated with adversarial thinking.

### Roles

Role 1 — Architect (you): define the product, make decisions, approve direction.

Role 2 — Builder (Codex): write code, run tests, deliver milestones.

Role 3 — Reviewer (Claude): confirm code matches design, check quality, verify tests.

Role 4 — Destroyer (Composer or second Claude instance): find reasons NOT to ship. Attack the design, the code, the claims, and the positioning. This role has no investment in the project shipping and no context from the design phase.

### The flow

```
Architect defines the idea (plain language)
        |
        v
[G0] Adversarial design review (Reviewer + Destroyer)
  - Honest scope statement
  - Threat model with 5+ attack vectors
  - 3 pre-mortems
  - Claims register with test mapping
  - API surface contract
        |
        v
[G0 PASS?] ──NO──> Redesign before writing any code
        |
       YES
        |
        v
Builder receives: idea + G0 document + AGENTS.md
  - AGENTS.md contains all constraints from G0
  - Builder cannot override G0 findings
        |
        v
[G1-G8] Build, test, verify (standard SHIP gates)
  - Each milestone includes bypass tests
  - Each milestone checks claims register
        |
        v
[G9] Multi-persona adversarial review (Destroyer)
  - 6 personas, no mercy
  - All Critical/High must be fixed
        |
        v
[G10] Honest README audit (Destroyer)
  - Every claim verified against code
  - Marketing language tested
        |
        v
[G11] Pre-publish verification
  - Clean install test
  - Quickstart runs from published package
        |
        v
[SHIP]
        |
        v
[G12-G14] Operate, review, feed back lessons
```

### Key rules from past failures

Rule 1 (from Agent CMDB): the reviewer who helped design the system must NOT be the only reviewer. Add a destroyer who had no part in the design.

Rule 2 (from Agent CMDB): every security claim must be tested by someone trying to bypass it, not someone trying to prove it works.

Rule 3 (from Clicky): AI builders build what they imagine, not what you specified. Product fidelity checks (G3.5) must compare against the reference, not against the AI builder's interpretation.

Rule 4 (from Clicky): AI builders create documentation theater — they write docs that describe features that don't work. G10 checks every README claim against actual code behavior.

Rule 5 (from Agent CMDB): test count is vanity. 153 tests that prove happy paths don't catch bypass vectors. Every feature needs three test types: positive (it works), negative (it fails gracefully), and bypass (what if it's never called).

Rule 6 (from Agent CMDB): "SOLVED" in a roadmap is a lie unless backed by a test. Partial mitigations are "PARTIAL," not "SOLVED."

Rule 7 (from Agent CMDB): if two functions do the same thing with different behavior, someone will integrate the wrong one. One entry point per concern. Merge or deprecate the others before shipping.

Rule 8 (from Agent CMDB + Clicky): sanitization that relabels but doesn't neutralize is worse than no sanitization — it creates false confidence. Test sanitization by feeding the output to a model and checking if the injection still works.

Rule 9 (from SHIP v3.1): session discipline prevents scope creep. Each Codex goal has one type (feature, refactor, fix, review) and one deliverable.

Rule 10 (from all projects): the honest scope statement is the hardest sentence to write and the most important. If you can't describe what V1 does in one sentence without marketing language, you don't understand your own product.

---

## SHIP version history

| Version | Date | What it added | What failure triggered it |
|---|---|---|---|
| v1.0 | May 2026 | 8 phases, basic milestone prompt | Codex delivering broken, incomplete apps |
| v2.0 | May 2026 | 12 phases, SDLC gates, security, ops | Moltbook breach, Lovable CVE, Replit DB wipe |
| v2.1 | May 2026 | Auth testing, dependency audit | Stress test gaps |
| v3.0 | May 2026 | Scoring, actionability, 15 docs, post-ship | ChatGPT audit of v2 gaps |
| v3.1 | May 2026 | Product fidelity, session scoping, builder constraints | Clicky building settings instead of companion |
| v4.0 | May 2026 | Gate 0, adversarial review, destroyer role, honest scope, bypass tests, claims register | Agent CMDB: 153 tests passed, Composer destroyed it in one pass |

---

## The lesson

SHIP v1-v3.1 asked: "Does the code work?"
SHIP v4 asks: "How does the code fail?"

That single question — asked before any code exists (G0) and again before any code ships (G9) — would have prevented every bug found in Agent CMDB, every misfeature in Clicky, and every false confidence in every project built with AI code generators.

The AI builder will always say "it works." The tests will always pass. The reviewer who helped design it will always confirm. The only person who finds the truth is the one whose job is to destroy.

Add the destroyer to your workflow. Add it to your first gate, not your last.

---

*SHIP v4.0 — pylabmit*
*"How does this fail?" — the question that changes everything.*
