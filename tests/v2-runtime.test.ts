import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';
import { loadControlPlane, multiAgentExampleControlPlanePath } from '../src/loader.js';
import type { ControlPlane } from '../src/types.js';

const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

function runtimeControlPlane(overrides: Partial<ControlPlane> = {}): ControlPlane {
  const base = loadControlPlane(multiAgentExampleControlPlanePath);
  return {
    ...base,
    ...overrides,
    policy: overrides.policy ?? base.policy,
    sources: overrides.sources ?? {
      ...base.sources,
      sources: base.sources.sources.map((source) => ({
        ...source,
        health: source.health ?? { failureThreshold: 2, failureWindowMs: 60_000, recoveryTimeoutMs: 30_000 },
        costPerCall: source.id === 'web-search-api' ? 0.02 : source.costPerCall
      })),
      profiles: base.sources.profiles.map((profile) => ({
        ...profile,
        analytics: profile.id === 'research-agent' ? { windowHours: 24 } : profile.analytics
      }))
    },
    registry: overrides.registry ?? base.registry
  };
}

function withSourceHealth(sourceId: string, health: { failureThreshold?: number; failureWindowMs?: number; recoveryTimeoutMs?: number }): ControlPlane {
  const base = runtimeControlPlane();
  return {
    ...base,
    sources: {
      ...base.sources,
      sources: base.sources.sources.map((source) => source.id === sourceId
        ? { ...source, health: { ...source.health, ...health } }
        : source)
    }
  };
}

function tempStore(prefix = 'agent-cmdb-v3-runtime-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('V3 source health monitor runtime', () => {
  it('starts unknown health records as available/up by default', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await expect(cmdb.ops.isSourceAvailable('web-search-api')).resolves.toBe(true);
    await expect(cmdb.ops.getHealthState('web-search-api')).resolves.toBe('closed');
  });

  it('records failures and marks the source down at the configured window threshold', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    expect((await cmdb.ops.recordSourceFailure('web-search-api')).status).toBe('up');
    const health = await cmdb.ops.recordSourceFailure('web-search-api');

    expect(health.status).toBe('down');
    expect(health.failures).toHaveLength(2);
    await expect(cmdb.ops.getHealthState('web-search-api')).resolves.toBe('open');
  });

  it('does not close a down source from a success before recovery timeout', async () => {
    const cmdb = createAgentCmdb({
      controlPlane: withSourceHealth('web-search-api', { failureThreshold: 1, recoveryTimeoutMs: 30_000 }),
      storeDir: tempStore()
    });

    await cmdb.ops.recordSourceFailure('web-search-api');
    const health = await cmdb.ops.recordSourceSuccess('web-search-api');

    expect(health.status).toBe('down');
    expect(health.failures).toHaveLength(1);
  });

  it('moves down sources to one-probe half-open after recovery timeout', async () => {
    const cmdb = createAgentCmdb({
      controlPlane: withSourceHealth('web-search-api', { failureThreshold: 1, recoveryTimeoutMs: 0 }),
      storeDir: tempStore()
    });

    await cmdb.ops.recordSourceFailure('web-search-api');

    await expect(cmdb.ops.isSourceAvailable('web-search-api')).resolves.toBe(true);
    await expect(cmdb.ops.isSourceAvailable('web-search-api')).resolves.toBe(false);
    await expect(cmdb.ops.getHealthState('web-search-api')).resolves.toBe('half-open');
  });

  it('recovers a half-open source after success', async () => {
    const cmdb = createAgentCmdb({
      controlPlane: withSourceHealth('web-search-api', { failureThreshold: 1, recoveryTimeoutMs: 0 }),
      storeDir: tempStore()
    });

    await cmdb.ops.recordSourceFailure('web-search-api');
    await cmdb.ops.isSourceAvailable('web-search-api');
    const health = await cmdb.ops.recordSourceSuccess('web-search-api');

    expect(health.status).toBe('up');
    expect(health.failures).toHaveLength(0);
  });

  it('applies exponential backoff after half-open failures', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.setSystemTime(new Date('2026-05-25T00:00:00.000Z'));
    const cmdb = createAgentCmdb({
      controlPlane: withSourceHealth('web-search-api', { failureThreshold: 1, recoveryTimeoutMs: 30_000 }),
      storeDir: tempStore()
    });

    await cmdb.ops.recordSourceFailure('web-search-api');
    vi.advanceTimersByTime(30_000);
    await cmdb.ops.isSourceAvailable('web-search-api');
    await cmdb.ops.recordSourceFailure('web-search-api');
    vi.advanceTimersByTime(30_000);
    await expect(cmdb.ops.isSourceAvailable('web-search-api')).resolves.toBe(false);
    vi.advanceTimersByTime(30_000);
    await expect(cmdb.ops.isSourceAvailable('web-search-api')).resolves.toBe(true);
    vi.useRealTimers();
  });

  it('skips down route sources and allows fallback when no specific down tool is requested', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await cmdb.ops.recordSourceFailure('web-search-api');
    await cmdb.ops.recordSourceFailure('web-search-api');
    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'recent-history-cache',
      intent: 'web_research'
    });

    expect(result.allowed).toBe(true);
    expect(result.route).toBeDefined();
    const route = result.route!;
    expect(route.skippedSources).toContain('web-search-api');
    expect(route.sources[0].id).toBe('recent-history-cache');
  });

  it('denies when the specifically requested tool is down', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await cmdb.ops.recordSourceFailure('web-search-api');
    await cmdb.ops.recordSourceFailure('web-search-api');
    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'web-search-api',
      intent: 'web_research'
    });

    expect(result.allowed).toBe(false);
    expect(result.decision.ruleId).toBe('requested-tool-down');
    expect(result.route).toBeUndefined();
  });

  it('denies preflight when every route source is down', async () => {
    const base = runtimeControlPlane();
    const cmdb = createAgentCmdb({
      controlPlane: {
        ...base,
        policy: {
          ...base.policy,
          policies: [
            ...base.policy.policies,
            {
              id: 'allow-route-health-test',
              effect: 'allow',
              profiles: ['research-agent'],
              actions: ['route_health_test'],
              reason: 'Route health test action is allowed before health filtering.'
            }
          ]
        }
      },
      storeDir: tempStore()
    });

    for (const sourceId of ['web-search-api', 'recent-history-cache', 'news-aggregator', 'tech-forum']) {
      await cmdb.ops.recordSourceFailure(sourceId);
      await cmdb.ops.recordSourceFailure(sourceId);
    }
    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'route_health_test',
      intent: 'web_research'
    });

    expect(result.allowed).toBe(false);
    expect(result.decision.ruleId).toBe('all-sources-down');
  });

  it('persists health across createAgentCmdb calls', async () => {
    const storeDir = tempStore();
    const first = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir });

    await first.ops.recordSourceFailure('web-search-api');
    await first.ops.recordSourceFailure('web-search-api');
    const second = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir });

    expect((await second.ops.getSourceHealth('web-search-api')).status).toBe('down');
  });

  it('resets source health manually', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await cmdb.ops.recordSourceFailure('web-search-api');
    await cmdb.ops.recordSourceFailure('web-search-api');
    const health = await cmdb.ops.resetSourceHealth('web-search-api');

    expect(health.status).toBe('up');
    expect(health.failures).toHaveLength(0);
  });

  it('lists health for every configured source', async () => {
    const controlPlane = runtimeControlPlane();
    const cmdb = createAgentCmdb({ controlPlane, storeDir: tempStore() });

    const health = await cmdb.ops.listSourceHealth();

    expect(health).toHaveLength(controlPlane.sources.sources.length);
    expect(health.every((entry) => entry.status === 'up')).toBe(true);
  });
});

describe('V3 preflight analytics and caller-provided cost estimation', () => {
  it('updates preflight analytics cache on audited preflight calls', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await cmdb.policy.preflight({ profile: 'research-agent', action: 'web_research', tool: 'web-search-api' });
    await cmdb.policy.preflight({ profile: 'research-agent', action: 'unknown_action', tool: 'web-search-api' });
    const analytics = await cmdb.ops.calculatePreflightAnalytics('research-agent');

    expect(analytics.totalDecisions).toBe(2);
    expect(analytics.allowedCount).toBe(1);
    expect(analytics.deniedCount).toBe(1);
    expect(analytics.allowRate).toBe(0.5);
    expect(analytics.denyRate).toBe(0.5);
  });

  it('reports zero-decision analytics as allowRate 1 and denyRate 0', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });
    const analytics = await cmdb.ops.calculatePreflightAnalytics('research-agent');

    expect(analytics.totalDecisions).toBe(0);
    expect(analytics.allowRate).toBe(1);
    expect(analytics.denyRate).toBe(0);
  });

  it('keeps preflight working when analytics config is omitted', async () => {
    const base = runtimeControlPlane();
    const controlPlane: ControlPlane = {
      ...base,
      sources: {
        ...base.sources,
        profiles: base.sources.profiles.map((profile) => ({ ...profile, analytics: undefined }))
      }
    };
    const cmdb = createAgentCmdb({ controlPlane, storeDir: tempStore() });

    await expect(cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'web-search-api'
    })).resolves.toMatchObject({ allowed: true });
  });

  it('summarizes evidence costs by source and date', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await cmdb.memory.logEvidence({
      profile: 'research-agent',
      source: 'web-search-api',
      intent: 'web_research',
      summary: 'call one',
      trust: 'high',
      capturedAt: '2026-05-24T10:00:00.000Z',
      tokenCount: 100,
      estimatedCost: 0.02
    });
    await cmdb.memory.logEvidence({
      profile: 'research-agent',
      source: 'news-aggregator',
      intent: 'web_research',
      summary: 'call two',
      trust: 'medium',
      capturedAt: '2026-05-24T11:00:00.000Z',
      tokenCount: 50,
      estimatedCost: 0.01
    });

    const summary = await cmdb.ops.getCostSummary('research-agent', '2026-05-24');
    expect(summary.totalCalls).toBe(2);
    expect(summary.totalTokens).toBe(150);
    expect(summary.totalCost).toBeCloseTo(0.03);
  });

  it('returns zero cost when no evidence exists', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });
    const summary = await cmdb.ops.getCostSummary('research-agent', '2026-05-24');

    expect(summary.totalCalls).toBe(0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.totalCost).toBe(0);
  });

  it('rejects analytics calculation for an unknown profile', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await expect(cmdb.ops.calculatePreflightAnalytics('missing-profile')).rejects.toThrow('Unknown profile: missing-profile.');
  });

  it('rejects malformed cost dates', async () => {
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir: tempStore() });

    await expect(cmdb.ops.getCostSummary('research-agent', 'today')).rejects.toThrow('Cost date must be YYYY-MM-DD.');
  });
});

describe('V3 public surface and CLI', () => {
  it('does not expose internal policy evaluators from the package root', async () => {
    const mod = await import('../src/interface.js');

    expect('evaluatePolicy' in mod).toBe(false);
    expect('evaluatePreflight' in mod).toBe(false);
  });

  it('does not publish direct internal subpath exports', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };

    expect(packageJson.exports['./policy-engine']).toBe(null);
    expect(packageJson.exports['./preflight']).toBeUndefined();
    expect(packageJson.exports['./store']).toBe(null);
    expect(packageJson.exports['./internal']).toBe(null);
    expect(packageJson.exports['./analytics']).toBe(null);
    expect(packageJson.exports['./brain']).toBe(null);
    expect(packageJson.exports['./digest']).toBe(null);
  });

  it('prints health help text', () => {
    const output = execFileSync(process.execPath, [tsxCli, join(process.cwd(), 'src', 'cli.ts'), 'health', '--help'], {
      encoding: 'utf8'
    });

    expect(output).toContain('agent-cmdb health');
    expect(output).toContain('--source');
  });

  it('prints analytics help text', () => {
    const output = execFileSync(process.execPath, [tsxCli, join(process.cwd(), 'src', 'cli.ts'), 'analytics', '--help'], {
      encoding: 'utf8'
    });

    expect(output).toContain('agent-cmdb analytics');
    expect(output).toContain('--profile');
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

  it('runs analytics command from the CLI', () => {
    const cwd = tempStore('agent-cmdb-cli-analytics-');
    const output = execFileSync(process.execPath, [
      tsxCli,
      join(process.cwd(), 'src', 'cli.ts'),
      'analytics',
      '--profile',
      'research-agent',
      '--config',
      multiAgentExampleControlPlanePath,
      '--store',
      join(cwd, 'state')
    ], { encoding: 'utf8' });

    expect(output).toContain('"profile": "research-agent"');
  });

  it('writes health state to disk', async () => {
    const storeDir = tempStore();
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir });

    await cmdb.ops.recordSourceFailure('web-search-api');

    expect(existsSync(join(storeDir, 'health.json'))).toBe(true);
  });

  it('resets source health to up when health state is tampered in warn mode', async () => {
    const storeDir = tempStore();
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir });

    await cmdb.ops.recordSourceFailure('web-search-api');
    await cmdb.ops.recordSourceFailure('web-search-api');
    const healthPath = join(storeDir, 'health.json');
    writeFileSync(healthPath, readFileSync(healthPath, 'utf8').replace('"status": "down"', '"status": "up"'), 'utf8');

    const health = await cmdb.ops.getSourceHealth('web-search-api');
    expect(health.status).toBe('up');
    expect(health.warnings?.[0]).toContain('tampered');
    await expect(cmdb.ops.getHealthState('web-search-api')).resolves.toBe('closed');
  });

  it('reports forged analytics cache with warnings in warn mode and throws in fail mode', async () => {
    const storeDir = tempStore();
    const cmdb = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir });

    await cmdb.policy.preflight({ profile: 'research-agent', action: 'blocked_action', tool: 'web-search-api' });
    const cachePath = join(storeDir, 'analytics-cache', 'research-agent.json');
    writeFileSync(cachePath, readFileSync(cachePath, 'utf8').replace('"denied": 1', '"denied": 0'), 'utf8');

    const analytics = await cmdb.ops.calculatePreflightAnalytics('research-agent');
    expect(analytics.warnings?.[0]).toContain('hash');
    expect(analytics.totalDecisions).toBe(0);

    const fail = createAgentCmdb({ controlPlane: runtimeControlPlane(), storeDir, tamperMode: 'fail' });
    await expect(fail.ops.calculatePreflightAnalytics('research-agent')).rejects.toThrow();
  });
});
