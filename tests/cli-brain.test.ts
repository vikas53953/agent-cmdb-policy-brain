import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
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

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

describe('Agent CMDB CLI brain commands', () => {
  it('init creates the brain directory tree', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-cmdb-cli-init-brain-'));

    runCli(['init'], cwd);

    expect(existsSync(join(cwd, 'agent-cmdb', 'brain', 'entities', 'people'))).toBe(true);
    expect(existsSync(join(cwd, 'agent-cmdb', 'brain', 'digest', 'daily'))).toBe(true);
    expect(existsSync(join(cwd, 'agent-cmdb', 'brain', 'index.json'))).toBe(true);
  });

  it('creates, reads, searches, lists, and deletes a brain entity', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-cmdb-cli-brain-'));
    runCli(['init'], cwd);
    const brainDir = join(cwd, 'agent-cmdb', 'brain');
    const storeDir = join(cwd, 'agent-cmdb', 'state');

    const created = parseJson<{ id: string }>(
      runCli([
        'brain',
        'create',
        '--brain-dir',
        brainDir,
        '--store',
        storeDir,
        '--id',
        'agent-security',
        '--kind',
        'topic',
        '--name',
        'Agent Security',
        '--summary',
        'Security notes',
        '--content',
        '# Agent Security'
      ])
    );
    expect(created.id).toBe('agent-security');

    expect(runCli(['brain', 'read', '--brain-dir', brainDir, '--id', 'agent-security'])).toContain('Agent Security');
    expect(parseJson<Array<{ id: string }>>(runCli(['brain', 'search', '--brain-dir', brainDir, '--keyword', 'security']))).toHaveLength(1);
    expect(parseJson<Array<{ id: string }>>(runCli(['brain', 'list', '--brain-dir', brainDir, '--kind', 'topics']))).toHaveLength(1);

    runCli(['brain', 'delete', '--brain-dir', brainDir, '--store', storeDir, '--id', 'agent-security', '--reason', 'cleanup']);
    expect(parseJson<unknown[]>(runCli(['brain', 'list', '--brain-dir', brainDir]))).toHaveLength(0);
  }, 20_000);

  it('generates a daily digest from the CLI', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-cmdb-cli-digest-'));
    runCli(['init'], cwd);
    const brainDir = join(cwd, 'agent-cmdb', 'brain');
    const storeDir = join(cwd, 'agent-cmdb', 'state');
    const date = new Date().toISOString().slice(0, 10);

    runCli([
      'evidence-add',
      '--store',
      storeDir,
      '--profile',
      'research-agent',
      '--source',
      'local-docs',
      '--intent',
      'research',
      '--summary',
      'CLI digest evidence',
      '--trust',
      'medium',
      '--captured-at',
      `${date}T00:00:00.000Z`
    ], cwd);

    const digest = parseJson<{ digestPath: string; evidenceCount: number }>(
      runCli(['digest', '--brain-dir', brainDir, '--store', storeDir, '--profile', 'research-agent', '--date', date], cwd)
    );

    expect(digest.evidenceCount).toBe(1);
    expect(readFileSync(digest.digestPath, 'utf8')).toContain('CLI digest evidence');
  });

  it('generates a weekly digest from the CLI', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-cmdb-cli-weekly-'));
    runCli(['init'], cwd);
    const brainDir = join(cwd, 'agent-cmdb', 'brain');

    const digest = parseJson<{ digestPath: string }>(
      runCli(['digest-weekly', '--brain-dir', brainDir, '--profile', 'research-agent', '--week-start', '2026-05-25'], cwd)
    );

    expect(existsSync(digest.digestPath)).toBe(true);
  });
});
