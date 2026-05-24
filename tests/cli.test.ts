import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const cliPath = 'src/cli.ts';
const exampleConfig = join(process.cwd(), 'examples', 'multi-agent', 'control-plane.yaml');

function runCli(args: string[]): unknown {
  const output = execFileSync(process.execPath, [tsxCli, cliPath, ...args, '--config', exampleConfig], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  return JSON.parse(output);
}

describe('Agent CMDB CLI', () => {
  it('prints inventory objects for a profile', () => {
    const output = runCli(['inventory', '--profile', 'research-agent']) as Array<{ id: string }>;

    expect(output.map((object) => object.id)).toContain('job.research-radar');
  });

  it('runs preflight for a blocked social-media-tool action', () => {
    const output = runCli([
      'preflight',
      '--profile',
      'research-agent',
      '--action',
      'social_post',
      '--tool',
      'social-media-tool',
      '--intent',
      'web_research'
    ]) as { allowed: boolean; decision: { ruleId: string } };

    expect(output.allowed).toBe(false);
    expect(output.decision.ruleId).toBe('object-status-blocked');
  });

  it('prints readiness report', () => {
    const output = runCli(['report']) as { validation: { errors: number }; counts: { profiles: number } };

    expect(output.validation.errors).toBe(0);
    expect(output.counts.profiles).toBe(3);
  });
});
