import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const cliPath = process.cwd().endsWith('agent-cmdb') ? 'src/cli.ts' : 'agent-cmdb/src/cli.ts';

function runCli(args: string[]): unknown {
  const output = execFileSync(process.execPath, [tsxCli, cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  return JSON.parse(output);
}

describe('Agent CMDB CLI', () => {
  it('prints inventory objects for a profile', () => {
    const output = runCli(['inventory', '--profile', 'gemma4cloud']) as Array<{ id: string }>;

    expect(output.map((object) => object.id)).toContain('job.gemma-pp-radar');
  });

  it('runs preflight for a blocked xurl action', () => {
    const output = runCli([
      'preflight',
      '--profile',
      'gemma4cloud',
      '--action',
      'x_account_post',
      '--tool',
      'xurl',
      '--intent',
      'x_research'
    ]) as { allowed: boolean; decision: { ruleId: string } };

    expect(output.allowed).toBe(false);
    expect(output.decision.ruleId).toBe('global-deny-xurl-account-actions');
  });

  it('prints readiness report', () => {
    const output = runCli(['report']) as { validation: { errors: number }; counts: { profiles: number } };

    expect(output.validation.errors).toBe(0);
    expect(output.counts.profiles).toBe(2);
  });
});
