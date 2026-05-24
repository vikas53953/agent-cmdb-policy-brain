import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';
import { loadControlPlane, multiAgentExampleControlPlanePath } from '../src/loader.js';
import type { AgentCheckpoint, ControlPlane } from '../src/types.js';

const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

function runtimeControlPlane(overrides: Partial<ControlPlane> = {}): ControlPlane {
  const base = loadControlPlane(multiAgentExampleControlPlanePath);
  return {
    ...base,
    ...overrides,
    sources: (overrides.sources ?? base.sources).map((source) => ({
      ...source,
      health: source.health ?? { failureThreshold: 2, recoveryTimeoutMs: 30_000 },
      costPerCall: source.id === 'web-search-api' ? 0.02 : source.costPerCall
    })),
    profiles: (overrides.profiles ?? base.profiles).map((profile) => ({
      ...profile,
      slo: profile.id === 'research-agent'
        ? { target: 0.95, windowHours: 24, metric: 'allow_rate' }
        : profile.slo
    }))
  };
}

function tempStore(prefix = 'agent-cmdb-v2-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('V2 source health and circuit breakers', () => {
  it('starts unknown sources as available/up by default', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await expect(cmdb.isSourceAvailable('web-search-api')).resolves.toBe(true);
    await expect(cmdb.getCircuitState('web-search-api')).resolves.toBe('closed');
  });

  it('records failures and opens the circuit at the configured threshold', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    expect((await cmdb.recordSourceFailure('web-search-api')).status).toBe('up');
    const health = await cmdb.recordSourceFailure('web-search-api');

    expect(health.status).toBe('down');
    expect(health.consecutiveFailures).toBe(2);
    await expect(cmdb.getCircuitState('web-search-api')).resolves.toBe('open');
  });

  it('does not close a down circuit from a success before half-open recovery', async () => {
    const controlPlane = runtimeControlPlane({
      sources: runtimeControlPlane().sources.map((source) => source.id === 'web-search-api'
        ? { ...source, health: { failureThreshold: 1, recoveryTimeoutMs: 30_000 } }
        : source)
    });
    const cmdb = createAgentCmdb({ controlPlane, storeDir: tempStore() });

    await cmdb.recordSourceFailure('web-search-api');
    const health = await cmdb.recordSourceSuccess('web-search-api');

    expect(health.status).toBe('down');
    expect(health.consecutiveFailures).toBe(1);
  });

  it('moves down sources to half-open after recovery timeout', async () => {
    const controlPlane = runtimeControlPlane({
      sources: runtimeControlPlane().sources.map((source) => source.id === 'web-search-api'
        ? { ...source, health: { failureThreshold: 1, recoveryTimeoutMs: 0 } }
        : source)
    });
    const cmdb = createAgentCmdb({ controlPlane, storeDir: tempStore() });

    await cmdb.recordSourceFailure('web-search-api');

    await expect(cmdb.isSourceAvailable('web-search-api')).resolves.toBe(true);
    await expect(cmdb.getCircuitState('web-search-api')).resolves.toBe('half-open');
  });

  it('closes a half-open circuit after success', async () => {
    const controlPlane = runtimeControlPlane({
      sources: runtimeControlPlane().sources.map((source) => source.id === 'web-search-api'
        ? { ...source, health: { failureThreshold: 1, recoveryTimeoutMs: 0 } }
        : source)
    });
    const cmdb = createAgentCmdb({ controlPlane, storeDir: tempStore() });

    await cmdb.recordSourceFailure('web-search-api');
    await cmdb.isSourceAvailable('web-search-api');
    const health = await cmdb.recordSourceSuccess('web-search-api');

    expect(health.status).toBe('up');
    expect(health.consecutiveFailures).toBe(0);
  });

  it('lets preflight move expired down sources to half-open for recovery', async () => {
    const controlPlane = runtimeControlPlane({
      sources: runtimeControlPlane().sources.map((source) => source.id === 'web-search-api'
        ? { ...source, health: { failureThreshold: 1, recoveryTimeoutMs: 0 } }
        : source)
    });
    const cmdb = createAgentCmdb({ controlPlane, storeDir: tempStore() });

    await cmdb.recordSourceFailure('web-search-api');
    await cmdb.preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'web-search-api',
      intent: 'web_research'
    });

    await expect(cmdb.getCircuitState('web-search-api')).resolves.toBe('half-open');
  });

  it('reopens a half-open circuit after failure', async () => {
    const controlPlane = runtimeControlPlane({
      sources: runtimeControlPlane().sources.map((source) => source.id === 'web-search-api'
        ? { ...source, health: { failureThreshold: 1, recoveryTimeoutMs: 0 } }
        : source)
    });
    const cmdb = createAgentCmdb({ controlPlane, storeDir: tempStore() });

    await cmdb.recordSourceFailure('web-search-api');
    await cmdb.isSourceAvailable('web-search-api');
    const health = await cmdb.recordSourceFailure('web-search-api');

    expect(health.status).toBe('down');
    expect(health.consecutiveFailures).toBeGreaterThanOrEqual(1);
  });

  it('denies when the specifically requested tool is down even if fallback exists', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await cmdb.recordSourceFailure('web-search-api');
    await cmdb.recordSourceFailure('web-search-api');
    const result = await cmdb.preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'web-search-api',
      intent: 'web_research'
    });

    expect(result.allowed).toBe(false);
    expect(result.decision.ruleId).toBe('requested-tool-down');
    expect(result.route?.skippedSources).toContain('web-search-api');
    expect(result.route?.sources.map((source) => source.id)).not.toContain('web-search-api');
  });

  it('skips down route sources and allows fallback when no specific down tool is requested', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await cmdb.recordSourceFailure('web-search-api');
    await cmdb.recordSourceFailure('web-search-api');
    const result = await cmdb.preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'recent-history-cache',
      intent: 'web_research'
    });

    expect(result.allowed).toBe(true);
    expect(result.route?.skippedSources).toContain('web-search-api');
    expect(result.route?.sources[0].id).toBe('recent-history-cache');
  });

  it('denies preflight when every route source is down', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    for (const sourceId of ['web-search-api', 'recent-history-cache', 'news-aggregator', 'tech-forum']) {
      await cmdb.recordSourceFailure(sourceId);
      await cmdb.recordSourceFailure(sourceId);
    }
    const result = await cmdb.preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'web-search-api',
      intent: 'web_research'
    });

    expect(result.allowed).toBe(false);
    expect(result.decision.ruleId).toBe('all-sources-down');
  });

  it('persists health across createAgentCmdb calls', async () => {
    const storeDir = tempStore();
    const first = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir });

    await first.recordSourceFailure('web-search-api');
    await first.recordSourceFailure('web-search-api');
    const second = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir });

    expect((await second.getSourceHealth('web-search-api')).status).toBe('down');
  });

  it('resets source health manually', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await cmdb.recordSourceFailure('web-search-api');
    await cmdb.recordSourceFailure('web-search-api');
    const health = await cmdb.resetSourceHealth('web-search-api');

    expect(health.status).toBe('up');
    expect(health.consecutiveFailures).toBe(0);
  });

  it('rejects unknown sources with a descriptive error', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await expect(cmdb.recordSourceFailure('missing-source')).rejects.toThrow('Unknown source: missing-source.');
  });

  it('lists health for every configured source', async () => {
    const controlPlane = runtimeControlPlane();
    const cmdb = createAgentCmdb({ controlPlane, storeDir: tempStore() });

    const health = await cmdb.listSourceHealth();

    expect(health).toHaveLength(controlPlane.sources.length);
    expect(health.every((entry) => entry.status === 'up')).toBe(true);
  });
});

describe('V2 SLO and cost tracking', () => {
  it('updates SLO cache on audited preflight calls', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await cmdb.preflight({ profile: 'research-agent', action: 'web_research', tool: 'web-search-api' });
    await cmdb.preflight({ profile: 'research-agent', action: 'unknown_action', tool: 'web-search-api' });
    const slo = await cmdb.calculateSlo('research-agent');

    expect(slo.totalDecisions).toBe(2);
    expect(slo.allowedCount).toBe(1);
    expect(slo.deniedCount).toBe(1);
  });

  it('reports within budget for 97 allowed decisions out of 100', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    for (let index = 0; index < 97; index += 1) {
      await cmdb.preflight({ profile: 'research-agent', action: 'web_research', tool: 'web-search-api' });
    }
    for (let index = 0; index < 3; index += 1) {
      await cmdb.preflight({ profile: 'research-agent', action: `unknown_action_${index}`, tool: 'web-search-api' });
    }

    const slo = await cmdb.calculateSlo('research-agent');
    expect(slo.totalDecisions).toBe(100);
    expect(slo.withinBudget).toBe(true);
  });

  it('reports exhausted budget for 93 allowed decisions out of 100', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    for (let index = 0; index < 93; index += 1) {
      await cmdb.preflight({ profile: 'research-agent', action: 'web_research', tool: 'web-search-api' });
    }
    for (let index = 0; index < 7; index += 1) {
      await cmdb.preflight({ profile: 'research-agent', action: `blocked_action_${index}`, tool: 'web-search-api' });
    }

    const slo = await cmdb.calculateSlo('research-agent');
    expect(slo.totalDecisions).toBe(100);
    expect(slo.withinBudget).toBe(false);
  });

  it('treats zero SLO decisions as healthy', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });
    const slo = await cmdb.calculateSlo('research-agent');

    expect(slo.totalDecisions).toBe(0);
    expect(slo.actual).toBe(1);
    expect(slo.withinBudget).toBe(true);
  });

  it('lets profiles without SLO config run preflight normally', async () => {
    const controlPlane = runtimeControlPlane({
      profiles: runtimeControlPlane().profiles.map((profile) => ({ ...profile, slo: undefined }))
    });
    const cmdb = createAgentCmdb({ controlPlane, storeDir: tempStore() });

    await expect(cmdb.preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'web-search-api'
    })).resolves.toMatchObject({ allowed: true });
  });

  it('summarizes evidence costs by source and date', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await cmdb.logEvidence({
      profile: 'research-agent',
      source: 'web-search-api',
      intent: 'web_research',
      summary: 'call one',
      trust: 'high',
      capturedAt: '2026-05-24T10:00:00.000Z',
      tokenCount: 100,
      estimatedCost: 0.02
    });
    await cmdb.logEvidence({
      profile: 'research-agent',
      source: 'news-aggregator',
      intent: 'web_research',
      summary: 'call two',
      trust: 'medium',
      capturedAt: '2026-05-24T11:00:00.000Z',
      tokenCount: 50,
      estimatedCost: 0.01
    });

    const summary = await cmdb.getCostSummary('research-agent', '2026-05-24');
    expect(summary.totalCalls).toBe(2);
    expect(summary.totalTokens).toBe(150);
    expect(summary.totalCost).toBeCloseTo(0.03);
  });

  it('returns zero cost when no evidence exists', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });
    const summary = await cmdb.getCostSummary('research-agent', '2026-05-24');

    expect(summary.totalCalls).toBe(0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.totalCost).toBe(0);
  });

  it('infers zero cost when source has no configured cost', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await cmdb.logEvidence({
      profile: 'research-agent',
      source: 'news-aggregator',
      intent: 'web_research',
      summary: 'free source',
      trust: 'medium',
      capturedAt: '2026-05-24T11:00:00.000Z'
    });

    const summary = await cmdb.getCostSummary('research-agent', '2026-05-24');
    expect(summary.totalCost).toBe(0);
    expect(summary.bySource[0].cost).toBe(0);
  });

  it('rejects SLO calculation for an unknown profile', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await expect(cmdb.calculateSlo('missing-profile')).rejects.toThrow('Unknown profile: missing-profile.');
  });

  it('rejects malformed cost dates', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await expect(cmdb.getCostSummary('research-agent', 'today')).rejects.toThrow('Cost date must be YYYY-MM-DD.');
  });
});

describe('V2 checkpoints', () => {
  function checkpoint(overrides: Partial<AgentCheckpoint> = {}): AgentCheckpoint {
    return {
      id: 'daily-research-1',
      profile: 'research-agent',
      taskDescription: 'Daily research workflow',
      currentStep: 1,
      totalSteps: 3,
      completedSteps: ['preflight'],
      pendingSteps: ['research', 'digest'],
      state: { route: 'web_research' },
      createdAt: '2026-05-24T00:00:00.000Z',
      updatedAt: '2026-05-24T00:01:00.000Z',
      prevHash: 'genesis',
      ...overrides
    };
  }

  it('saves and loads checkpoints roundtrip', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await cmdb.saveCheckpoint(checkpoint());
    const loaded = await cmdb.loadCheckpoint('daily-research-1');

    expect(loaded?.profile).toBe('research-agent');
    expect(loaded?.completedSteps).toEqual(['preflight']);
  });

  it('returns null for missing checkpoints', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await expect(cmdb.loadCheckpoint('missing-checkpoint')).resolves.toBeNull();
  });

  it('lists checkpoints by profile', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await cmdb.saveCheckpoint(checkpoint());
    await cmdb.saveCheckpoint(checkpoint({ id: 'content-1', profile: 'content-agent' }));

    const research = await cmdb.listCheckpoints('research-agent');
    expect(research).toHaveLength(1);
    expect(research[0].id).toBe('daily-research-1');
  });

  it('deletes checkpoints', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await cmdb.saveCheckpoint(checkpoint());
    await cmdb.deleteCheckpoint('daily-research-1');

    await expect(cmdb.loadCheckpoint('daily-research-1')).resolves.toBeNull();
  });

  it('adds warnings when checkpoint content is tampered', async () => {
    const storeDir = tempStore();
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir });

    await cmdb.saveCheckpoint(checkpoint());
    const filePath = join(storeDir, 'checkpoints', 'daily-research-1.json');
    writeFileSync(filePath, readFileSync(filePath, 'utf8').replace('Daily research workflow', 'Tampered workflow'), 'utf8');
    const loaded = await cmdb.loadCheckpoint('daily-research-1');

    expect(loaded?.warnings?.[0]).toContain('hash');
  });

  it('keeps preflight working when checkpoints are never used', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await expect(cmdb.preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'web-search-api'
    })).resolves.toMatchObject({ allowed: true });
  });

  it('rejects unsafe checkpoint ids', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await expect(cmdb.loadCheckpoint('../bad')).rejects.toThrow('Checkpoint id must be a safe identifier.');
  });
});

describe('V2 public surface and CLI', () => {
  it('does not expose internal policy evaluators from the package root', async () => {
    const mod = await import('../src/interface.js');

    expect('evaluatePolicy' in mod).toBe(false);
    expect('evaluatePreflight' in mod).toBe(false);
  });

  it('does not publish direct policy-engine or preflight subpath exports', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };

    expect(packageJson.exports['./policy-engine']).toBeUndefined();
    expect(packageJson.exports['./preflight']).toBeUndefined();
  });

  it('prints health help text', () => {
    const output = execFileSync(process.execPath, [tsxCli, join(process.cwd(), 'src', 'cli.ts'), 'health', '--help'], {
      encoding: 'utf8'
    });

    expect(output).toContain('agent-cmdb health');
    expect(output).toContain('--source');
  });

  it('prints SLO help text', () => {
    const output = execFileSync(process.execPath, [tsxCli, join(process.cwd(), 'src', 'cli.ts'), 'slo', '--help'], {
      encoding: 'utf8'
    });

    expect(output).toContain('agent-cmdb slo');
    expect(output).toContain('--profile');
  });

  it('prints cost help text', () => {
    const output = execFileSync(process.execPath, [tsxCli, join(process.cwd(), 'src', 'cli.ts'), 'cost', '--help'], {
      encoding: 'utf8'
    });

    expect(output).toContain('agent-cmdb cost');
    expect(output).toContain('--date');
  });

  it('runs health command from the CLI', () => {
    const cwd = tempStore('agent-cmdb-cli-health-');
    const output = execFileSync(process.execPath, [
      tsxCli,
      join(process.cwd(), 'src', 'cli.ts'),
      'health',
      '--config',
      multiAgentExampleControlPlanePath,
      '--store',
      join(cwd, 'state')
    ], { encoding: 'utf8' });

    expect(output).toContain('web-search-api');
  });

  it('runs health reset command from the CLI', () => {
    const cwd = tempStore('agent-cmdb-cli-reset-');
    const output = execFileSync(process.execPath, [
      tsxCli,
      join(process.cwd(), 'src', 'cli.ts'),
      'health',
      'reset',
      '--source',
      'web-search-api',
      '--config',
      multiAgentExampleControlPlanePath,
      '--store',
      join(cwd, 'state')
    ], { encoding: 'utf8' });

    expect(output).toContain('"status": "up"');
  });

  it('runs SLO command from the CLI', () => {
    const cwd = tempStore('agent-cmdb-cli-slo-');
    const output = execFileSync(process.execPath, [
      tsxCli,
      join(process.cwd(), 'src', 'cli.ts'),
      'slo',
      '--profile',
      'research-agent',
      '--config',
      multiAgentExampleControlPlanePath,
      '--store',
      join(cwd, 'state')
    ], { encoding: 'utf8' });

    expect(output).toContain('"profile": "research-agent"');
  });

  it('runs cost command from the CLI', () => {
    const cwd = tempStore('agent-cmdb-cli-cost-');
    const output = execFileSync(process.execPath, [
      tsxCli,
      join(process.cwd(), 'src', 'cli.ts'),
      'cost',
      '--profile',
      'research-agent',
      '--date',
      '2026-05-24',
      '--config',
      multiAgentExampleControlPlanePath,
      '--store',
      join(cwd, 'state')
    ], { encoding: 'utf8' });

    expect(output).toContain('"totalCost": 0');
  });

  it('writes health state to disk', async () => {
    const storeDir = tempStore();
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir });

    await cmdb.recordSourceFailure('web-search-api');

    expect(existsSync(join(storeDir, 'health.json'))).toBe(true);
  });

  it('fails closed when health state is tampered', async () => {
    const storeDir = tempStore();
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir });

    await cmdb.recordSourceFailure('web-search-api');
    await cmdb.recordSourceFailure('web-search-api');
    const healthPath = join(storeDir, 'health.json');
    writeFileSync(healthPath, readFileSync(healthPath, 'utf8').replace('"status": "down"', '"status": "up"'), 'utf8');

    const health = await cmdb.getSourceHealth('web-search-api');
    expect(health.status).toBe('down');
    expect(health.warnings?.[0]).toContain('hash');
    await expect(cmdb.getCircuitState('web-search-api')).resolves.toBe('open');
  });

  it('reports forged SLO cache as out of budget with warnings', async () => {
    const storeDir = tempStore();
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir });

    await cmdb.preflight({ profile: 'research-agent', action: 'blocked_action', tool: 'web-search-api' });
    const cachePath = join(storeDir, 'slo-cache', 'research-agent.json');
    writeFileSync(cachePath, readFileSync(cachePath, 'utf8').replace('"denied": 1', '"denied": 0'), 'utf8');

    const slo = await cmdb.calculateSlo('research-agent');
    expect(slo.withinBudget).toBe(false);
    expect(slo.actual).toBe(0);
    expect(slo.warnings?.[0]).toContain('hash');
  });
});
