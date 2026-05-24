import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const cliPath = 'src/cli.ts';

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): CliResult {
  try {
    const stdout = execFileSync(process.execPath, [tsxCli, cliPath, ...args], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const failed = error as { status: number; stdout: Buffer | string; stderr: Buffer | string };
      return {
        status: failed.status,
        stdout: String(failed.stdout),
        stderr: String(failed.stderr)
      };
    }
    throw error;
  }
}

describe('Agent CMDB CLI adversarial behavior', () => {
  it.each([
    [['policy', '--action', 'social_post'], 'Missing required --profile.'],
    [['policy', '--profile', 'research-agent'], 'Missing required --action.'],
    [['route', '--intent', 'weather'], 'Missing required --profile.'],
    [['route', '--profile', 'content-agent'], 'Missing required --intent.'],
    [['inspect'], 'Missing required --profile.'],
    [['preflight', '--action', 'social_post'], 'Missing required --profile.'],
    [['preflight', '--profile', 'research-agent'], 'Missing required --action.'],
    [['graph'], 'Missing required --id.'],
    [['evidence-add', '--source', 'web-search-api', '--intent', 'web_research', '--summary', 'probe'], 'Missing required --profile.'],
    [['evidence-add', '--profile', 'research-agent', '--intent', 'web_research', '--summary', 'probe'], 'Missing required --source.'],
    [['evidence-add', '--profile', 'research-agent', '--source', 'web-search-api', '--summary', 'probe'], 'Missing required --intent.'],
    [['evidence-add', '--profile', 'research-agent', '--source', 'web-search-api', '--intent', 'web_research'], 'Missing required --summary.'],
    [['change-add', '--target-type', 'policy', '--action', 'verify', '--reason', 'probe'], 'Missing required --target.'],
    [['change-add', '--target', 'policy.global-deny-social-media-tool-account-actions', '--action', 'verify', '--reason', 'probe'], 'Missing required --target-type.'],
    [['change-add', '--target', 'policy.global-deny-social-media-tool-account-actions', '--target-type', 'policy', '--reason', 'probe'], 'Missing required --action.'],
    [['change-add', '--target', 'policy.global-deny-social-media-tool-account-actions', '--target-type', 'policy', '--action', 'verify'], 'Missing required --reason.']
  ])('prints a clean error for missing required flags: %s', (args, expectedError) => {
    const result = runCli(args);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(expectedError);
  });

  it('prints valid object kind values for invalid --kind', () => {
    const result = runCli(['inventory', '--kind', 'invalid']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid object kind: invalid.');
    expect(result.stderr).toContain('profile, source, tool, job, memory, policy, workspace');
  });

  it('prints valid trust values for invalid --trust', () => {
    const result = runCli(['evidence-list', '--trust', 'garbage']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid trust level: garbage.');
    expect(result.stderr).toContain('high, medium, low');
  });

  it('creates a missing evidence store directory', () => {
    const parent = mkdtempSync(join(tmpdir(), 'agent-cmdb-cli-evidence-parent-'));
    const storeDir = join(parent, 'nonexistent-evidence-store');
    const result = runCli([
      'evidence-add',
      '--store',
      storeDir,
      '--profile',
      'research-agent',
      '--source',
      'web-search-api',
      '--intent',
      'web_research',
      '--summary',
      'CLI evidence store creation probe'
    ]);

    expect(result.status).toBe(0);
    expect(existsSync(join(storeDir, 'evidence.jsonl'))).toBe(true);
  });

  it('creates a missing change store directory', () => {
    const parent = mkdtempSync(join(tmpdir(), 'agent-cmdb-cli-change-parent-'));
    const storeDir = join(parent, 'nonexistent-change-store');
    const result = runCli([
      'change-add',
      '--store',
      storeDir,
      '--target',
      'policy.global-deny-social-media-tool-account-actions',
      '--target-type',
      'policy',
      '--action',
      'verify',
      '--reason',
      'CLI change store creation probe'
    ]);

    expect(result.status).toBe(0);
    expect(existsSync(join(storeDir, 'changes.jsonl'))).toBe(true);
  });
});
