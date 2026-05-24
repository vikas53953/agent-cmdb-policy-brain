import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const cliPath = join(process.cwd(), 'src', 'cli.ts');

function runCli(args: string[], cwd = process.cwd()): string {
  return execFileSync(process.execPath, [tsxCli, cliPath, ...args], {
    cwd,
    encoding: 'utf8'
  });
}

describe('V1.5 CLI', () => {
  it('prints root help with command descriptions', () => {
    const output = runCli(['--help']);

    expect(output).toContain('Usage: agent-cmdb <command>');
    expect(output).toContain('preflight');
    expect(output).toContain('Run a policy preflight check');
  });

  it('prints init and preflight specific help', () => {
    expect(runCli(['init', '--help'])).toContain('Create an agent-cmdb workspace');
    expect(runCli(['preflight', '--help'])).toContain('--profile');
    expect(runCli(['preflight', '--help'])).toContain('--dry-run');
  });

  it('accepts --dry-run as a boolean preflight flag', () => {
    const output = JSON.parse(
      runCli([
        'preflight',
        '--profile',
        'research-agent',
        '--action',
        'web_search',
        '--tool',
        'serpapi',
        '--intent',
        'web_research',
        '--dry-run'
      ])
    ) as { dryRun: boolean; allowed: boolean };

    expect(output.dryRun).toBe(true);
    expect(output.allowed).toBe(true);
  });

  it('prints a doctor report for an initialized workspace', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-cmdb-doctor-cli-'));
    runCli(['init'], cwd);

    const output = runCli(['doctor'], cwd);

    expect(output).toContain('Agent CMDB Doctor');
    expect(output).toContain('Control plane');
    expect(output).toContain('Store');
    expect(output).toContain('Brain');
    expect(existsSync(join(cwd, 'agent-cmdb', 'brain', 'index.json'))).toBe(true);
  }, 15_000);
});
