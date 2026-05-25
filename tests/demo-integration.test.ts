import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const demoDir = join(process.cwd(), 'demo');
const stateDir = join(demoDir, 'state');
const brainDir = join(demoDir, 'brain');

describe('live demo integration', () => {
  it('runs the day 1 and day 2 agent simulations with durable state', () => {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(brainDir, { recursive: true, force: true });

    const day1Output = runDemo('agent-sim.ts');

    expect(day1Output).toContain('Agent CMDB - Live Demo (research-agent, day 1)');
    expect(day1Output).toContain('[BOOT]       Control plane: HEALTHY');
    expect(day1Output).toContain('[BRAIN]      No prior knowledge');
    expect(day1Output).toContain('[DIGEST]     Generated daily digest');
    expect(evidenceJsonlCount()).toBeGreaterThanOrEqual(4);
    expect(jsonlCount(join(stateDir, 'changes.jsonl'))).toBeGreaterThanOrEqual(3);
    expect(existsSync(join(brainDir, 'entities', 'topics', 'ai-agent-security.md'))).toBe(true);
    expect(readBrainIndexEntityCount()).toBeGreaterThanOrEqual(1);
    expect(readdirSync(join(brainDir, 'digest', 'daily')).some((file) => file.endsWith('-research-agent.md'))).toBe(true);

    const day2Output = runDemo('agent-sim-day2.ts');

    expect(day2Output).toContain('Agent CMDB - Live Demo (research-agent, day 2)');
    expect(day2Output).toContain('Found prior knowledge');
    expect(day2Output).toContain('Total evidence across 2 days:');
    expect(readFileSync(join(brainDir, 'entities', 'topics', 'ai-agent-security.md'), 'utf8')).toContain(
      '---\n## Update'
    );
    expect(readdirSync(join(brainDir, 'digest', 'weekly')).some((file) => file.endsWith('-research-agent.md'))).toBe(true);
  }, 120_000);
});

function runDemo(scriptName: string): string {
  return execFileSync(process.execPath, [tsxCli, join(demoDir, scriptName)], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
}

function jsonlCount(filePath: string): number {
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0).length;
}

function evidenceJsonlCount(): number {
  return readdirSync(stateDir)
    .filter((file) => /^evidence-\d{4}-\d{2}-\d{2}\.jsonl$/.test(file) || file === 'evidence.jsonl')
    .reduce((sum, file) => sum + jsonlCount(join(stateDir, file)), 0);
}

function readBrainIndexEntityCount(): number {
  const index = JSON.parse(readFileSync(join(brainDir, 'index.json'), 'utf8')) as {
    entities: unknown[];
  };
  return index.entities.length;
}
