# Pre-Publish Audit Template

Use this before every npm publish. Paste raw command output for every gate. If a gate has partial failures, the gate fails. Do not publish unless the final verdict meets the release prompt's threshold.

## Step 0 - State Capture

Run and paste full output:

```bash
git rev-parse HEAD
git status --short --branch
git log --oneline -5
npm view @pylabmit/agent-cmdb version
npm view @pylabmit/agent-cmdb dist.tarball
ls src/
wc -l src/*.ts
```

On Windows, use equivalent PowerShell commands when needed:

```powershell
git rev-parse HEAD
git status --short --branch
git log --oneline -5
npm view @pylabmit/agent-cmdb version
npm view @pylabmit/agent-cmdb dist.tarball
Get-ChildItem src
Get-ChildItem src -Filter *.ts | ForEach-Object { "$($_.Name) $((Get-Content $_.FullName).Count)" }
```

## G1 - README Honesty

Run:

```bash
grep -in "circuit breaker" README.md || echo "ABSENT"
grep -in "\bSLO\b" README.md || echo "ABSENT"
grep -in "cost tracking" README.md || echo "ABSENT"
grep -in "control plane" README.md || echo "ABSENT"
```

Pass criteria:

- `circuit breaker` is absent, or appears only with an explicit disclaimer.
- `SLO` is absent, or appears only with an explicit allow-rate/reliability disclaimer.
- `cost tracking` is absent, or renamed to cost estimation/reporting from caller-supplied data.
- `control plane` is absent, or scoped to a config/policy-file meaning.

Verdict: PASS / FAIL.

## G2 - Composable Surface

Run:

```bash
cat src/interface.ts
```

Answer with evidence:

- What does `createAgentCmdb()` return?
- Count the top-level properties on the returned object.
- Count total methods reachable from the returned object, including nested clients.

Pass criteria:

- Top-level properties <= 6.
- Methods are grouped under namespaces such as `policy`, `memory`, and `ops`.
- No single flat object literal with 30+ method properties.

Verdict: PASS / FAIL.

## G3 - Hot Path Safety

Run:

```bash
grep -n "throw new Error\|throw " src/policy-engine.ts src/preflight.ts src/route-resolver.ts src/interface.ts
npm test -- tests/v3-hot-path-safety.test.ts tests/v31-resolve-route-safety.test.ts tests/v31-preflight-error-audit.test.ts
```

Pass criteria:

- Unknown profile/source/tool and malformed preflight requests return deny decisions, not uncaught throws.
- `resolveRoute()` returns an empty-route result with warnings on bad input, not an uncaught throw.
- `preflight-error` deny decisions are written to evidence/change logs unless `dryRun` applies.

Verdict: PASS / FAIL.

## G4 - Build Integrity

Run in a fresh temp directory:

```bash
git clone https://github.com/vikas53953/agent-cmdb-policy-brain.git
cd agent-cmdb-policy-brain
npm ci
npm run build
npm test
ls src/
```

Pass criteria:

- All commands exit 0.
- `src/` contains every file imported by `interface.ts` and `cli.ts`.
- No source artifact exists only in `dist/`.

Verdict: PASS / FAIL.

## G5 - Scale Honesty

Run:

```bash
grep -in "limit\|scale\|performance\|maximum" README.md docs/*.md 2>/dev/null
```

Pass criteria:

- README or docs state explicit measured limits for evidence records and brain entities.
- The text explains what happens beyond those limits.
- Vague language such as "production scale" without numbers fails.

Verdict: PASS / FAIL.

## G6 - Test Quality Spot Check

Run:

```bash
ls tests/
wc -l tests/*.ts
grep -n "^\s*it(\|^\s*test(" tests/*.ts | shuf -n 5
```

On Windows, use:

```powershell
Get-ChildItem tests -Filter *.ts
Get-ChildItem tests -Filter *.ts | ForEach-Object { "$($_.Name) $((Get-Content $_.FullName).Count)" }
Select-String -Path tests\*.ts -Pattern "^\s*(it|test)\(" | Get-Random -Count 5
```

For each selected test, classify:

- `BEHAVIOR`: asserts observable output for a given input.
- `IMPLEMENTATION`: asserts internal function calls, internal state, or internal method existence.
- `TRIVIAL`: asserts an import/type/constant shape without behavior.

Pass criteria:

- At least 3 of 5 sampled tests are `BEHAVIOR`.

Verdict: PASS / FAIL.

## G7 - Test Durability

Tests must not break on legitimate version bumps. Run:

```bash
grep -rn "toBe('[0-9]\+\.[0-9]\+\.[0-9]\+')" tests/ || echo "ABSENT"
grep -rn 'toBe("[0-9]\+\.[0-9]\+\.[0-9]\+")' tests/ || echo "ABSENT"
```

Pass criteria:

- Zero literal current-version assertions, or each match has an inline comment explaining why a literal version is intentional.
- Package version tests should normally assert semver shape, not a specific release string.

Verdict: PASS / FAIL.

## G8 - Tamper Mode Propagation

Run:

```bash
npm test -- tests/v311-contract-gaps.test.ts tests/v31-tamper-default.test.ts tests/v31-preflight-error-audit.test.ts
grep -n "tamperMode: TamperMode = 'warn'\|tamperMode: TamperMode = \"warn\"\|\?\? 'warn'\|\?\? \"warn\"" src/*.ts
```

Pass criteria:

- Corrupt `health.json` plus factory-default `createAgentCmdb()` plus `preflight()` does not silently allow an action.
- `preflight()` module-level defaults match the factory default (`fail`).
- Lower-level store/health/analytics default paths do not silently downgrade to warn unless the caller explicitly passes `tamperMode: 'warn'`.
- Explicit warn-mode tests still pass only when `tamperMode: 'warn'` is provided.

Verdict: PASS / FAIL.

## Final Verdict Table

```markdown
| Gate | Verdict | One-line reason |
|------|---------|-----------------|
| G1 README honesty | PASS/FAIL | ... |
| G2 Composable surface | PASS/FAIL | ... |
| G3 Hot path safety | PASS/FAIL | ... |
| G4 Build integrity | PASS/FAIL | ... |
| G5 Scale honesty | PASS/FAIL | ... |
| G6 Test quality | PASS/FAIL | ... |
| G7 Test durability | PASS/FAIL | ... |
| G8 Tamper mode propagation | PASS/FAIL | ... |
```

Run at the end:

```bash
git status --short --branch
git diff --stat
```

Publish only when the release prompt's required pass threshold is met and any explicit blocker gates pass.
