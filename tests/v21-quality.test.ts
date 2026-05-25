import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';
import { evaluatePolicy } from '../src/internal.js';
import { loadControlPlane, multiAgentExampleControlPlanePath } from '../src/loader.js';
import { appendEvidence, listEvidence } from '../src/store.js';
import type { ControlPlane } from '../src/types.js';

const basePolicyLibrary = loadControlPlane(multiAgentExampleControlPlanePath);
const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

function tempStore(prefix = 'agent-cmdb-v21-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function policyLibraryWithProbeTimeout(): ControlPlane {
  return {
    ...basePolicyLibrary,
    sources: basePolicyLibrary.sources.map((source) => ({
      ...source,
      health: { failureThreshold: 1, recoveryTimeoutMs: 0 }
    }))
  };
}

function policyLibraryWithWritableSource(): ControlPlane {
  return {
    ...basePolicyLibrary,
    sources: [
      ...basePolicyLibrary.sources,
      {
        id: 'publish-api',
        label: 'Publish API',
        kind: 'tool',
        readOnly: false
      }
    ],
    profiles: basePolicyLibrary.profiles.map((profile) => (
      profile.id === 'research-agent'
        ? {
          ...profile,
          routes: [
            ...profile.routes,
            { intent: 'publish_content', sources: ['web-search-api', 'publish-api'] }
          ]
        }
        : profile
    )),
    policies: [
      ...basePolicyLibrary.policies,
      {
        id: 'allow-generic-publish',
        effect: 'allow',
        profiles: ['research-agent'],
        actions: ['publish'],
        tools: ['web-search-api', 'publish-api'],
        reason: 'Publish action is allowed for read-only enforcement tests.'
      }
    ]
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('v2.1 policy evaluator honesty', () => {
  it('returns deny instead of throwing for an unknown profile', () => {
    const decision = evaluatePolicy(basePolicyLibrary, {
      profile: 'missing-profile',
      action: 'web_research',
      tool: 'web-search-api'
    });

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('unknown-profile');
    expect(decision.reason).toContain('missing-profile');
  });
});

describe('v2.1 source health monitor probe behavior', () => {
  it('allows exactly one half-open probe before a success or failure is recorded', async () => {
    const cmdb = createAgentCmdb({ controlPlane: policyLibraryWithProbeTimeout(), storeDir: tempStore() });

    await cmdb.ops.recordSourceFailure('web-search-api');

    await expect(cmdb.ops.isSourceAvailable('web-search-api')).resolves.toBe(true);
    await expect(cmdb.ops.isSourceAvailable('web-search-api')).resolves.toBe(false);
  });

  it('recovers from down to up when a success is recorded after timeout', async () => {
    const cmdb = createAgentCmdb({ controlPlane: policyLibraryWithProbeTimeout(), storeDir: tempStore() });

    await cmdb.ops.recordSourceFailure('web-search-api');
    const health = await cmdb.ops.recordSourceSuccess('web-search-api');

    expect(health.status).toBe('up');
    expect(health.probeCount).toBe(0);
  });

  it('uses exponential recovery backoff and resets attempts on success', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T00:00:00.000Z'));
    const controlPlane: ControlPlane = {
      ...basePolicyLibrary,
      sources: basePolicyLibrary.sources.map((source) => ({
        ...source,
        health: { failureThreshold: 1, recoveryTimeoutMs: 30_000 }
      }))
    };
    const cmdb = createAgentCmdb({ controlPlane, storeDir: tempStore() });

    await cmdb.ops.recordSourceFailure('web-search-api');
    vi.advanceTimersByTime(30_000);
    await expect(cmdb.ops.isSourceAvailable('web-search-api')).resolves.toBe(true);
    const reopened = await cmdb.ops.recordSourceFailure('web-search-api');
    expect(reopened.recoveryAttempts).toBe(1);

    vi.advanceTimersByTime(30_000);
    await expect(cmdb.ops.isSourceAvailable('web-search-api')).resolves.toBe(false);
    vi.advanceTimersByTime(30_000);
    await expect(cmdb.ops.isSourceAvailable('web-search-api')).resolves.toBe(true);
    const recovered = await cmdb.ops.recordSourceSuccess('web-search-api');
    expect(recovered.recoveryAttempts).toBe(0);
  });

  it('preflight does not reuse a consumed half-open probe', async () => {
    const cmdb = createAgentCmdb({ controlPlane: policyLibraryWithProbeTimeout(), storeDir: tempStore() });

    await cmdb.ops.recordSourceFailure('web-search-api');
    await expect(cmdb.ops.isSourceAvailable('web-search-api')).resolves.toBe(true);
    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'web-search-api',
      intent: 'web_research'
    });

    expect(result.allowed).toBe(false);
    expect(result.decision.ruleId).toBe('requested-tool-down');
    expect('route' in result).toBe(false);
  });

  it('malformed health state resets to up with warnings instead of breaking preflight', async () => {
    const storeDir = tempStore();
    writeFileSync(join(storeDir, 'health.json'), '{not-json', 'utf8');
    const cmdb = createAgentCmdb({ controlPlane: basePolicyLibrary, storeDir });

    await expect(cmdb.ops.getSourceHealth('web-search-api')).resolves.toMatchObject({
      sourceId: 'web-search-api',
      status: 'up',
      consecutiveFailures: 0
    });
    expect(cmdb.health().issues.some((issue) => issue.message.includes('Health state was tampered'))).toBe(true);
    await expect(cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'web-search-api',
      intent: 'web_research'
    })).resolves.toMatchObject({ allowed: true });
  });
});

describe('v2.1 evidence rotation', () => {
  it('writes evidence to dated JSONL files and filters by date range', async () => {
    const storeDir = tempStore();

    for (const [index, capturedAt] of [
      '2026-05-24T10:00:00.000Z',
      '2026-05-24T11:00:00.000Z',
      '2026-05-24T12:00:00.000Z',
      '2026-05-25T10:00:00.000Z',
      '2026-05-25T11:00:00.000Z'
    ].entries()) {
      await appendEvidence(storeDir, {
        profile: 'research-agent',
        source: 'web-search-api',
        intent: 'web_research',
        summary: `rotated record ${index}`,
        trust: 'high',
        capturedAt
      });
    }

    expect(readdirSync(storeDir).filter((file) => /^evidence-\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)).sort()).toEqual([
      'evidence-2026-05-24.jsonl',
      'evidence-2026-05-25.jsonl'
    ]);

    const records = await listEvidence(storeDir, {
      profile: 'research-agent',
      dateRange: { from: '2026-05-25', to: '2026-05-25' }
    });

    expect(records).toHaveLength(2);
    expect(records.every((record) => record.capturedAt.startsWith('2026-05-25'))).toBe(true);
    expect(records.every((record) => !record.warnings?.length)).toBe(true);
  });

  it('still reads legacy evidence.jsonl stores', async () => {
    const storeDir = tempStore();

    await appendEvidence(storeDir, {
      profile: 'research-agent',
      source: 'legacy-source',
      intent: 'legacy',
      summary: 'legacy compatible',
      trust: 'medium',
      capturedAt: '2026-05-24T00:00:00.000Z'
    });

    expect(existsSync(join(storeDir, 'evidence.jsonl'))).toBe(false);
    const records = await listEvidence(storeDir, { source: 'legacy-source' });
    expect(records).toHaveLength(1);
  });
});

describe('v2.1 composable interface', () => {
  it('exposes policy, memory, and ops clients while preserving flat access', async () => {
    const cmdb = createAgentCmdb({ controlPlane: basePolicyLibrary, storeDir: tempStore() });

    await expect(cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'web-search-api',
      intent: 'web_research'
    })).resolves.toMatchObject({ allowed: true });

    await expect(cmdb.memory.logEvidence({
      profile: 'research-agent',
      source: 'web-search-api',
      intent: 'web_research',
      summary: 'nested memory evidence',
      trust: 'high',
      capturedAt: '2026-05-25T00:00:00.000Z'
    })).resolves.toMatchObject({ source: 'web-search-api' });

    await expect(cmdb.ops.recordSourceFailure('web-search-api')).resolves.toMatchObject({ sourceId: 'web-search-api' });
    await expect(cmdb.preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'web-search-api'
    })).resolves.toHaveProperty('decision');
  });
});

describe('v2.1 route and read-only safety', () => {
  it('passes health state through resolveRoute and skips down sources', async () => {
    const controlPlane = policyLibraryWithProbeTimeout();
    const cmdb = createAgentCmdb({ controlPlane, storeDir: tempStore() });

    await cmdb.ops.recordSourceFailure('web-search-api');
    const route = await cmdb.policy.resolveRoute({ profile: 'research-agent', intent: 'web_research' });

    expect(route.skippedSources).toContain('web-search-api');
    expect(route.sources.map((source) => source.id)).not.toContain('web-search-api');
  });

  it('denies write actions routed to read-only sources', async () => {
    const cmdb = createAgentCmdb({ controlPlane: policyLibraryWithWritableSource(), storeDir: tempStore() });

    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'publish',
      tool: 'web-search-api',
      intent: 'publish_content'
    });

    expect(result.allowed).toBe(false);
    expect(result.decision.reason).toContain('read-only');
  });

  it('allows write actions on read-write sources', async () => {
    const cmdb = createAgentCmdb({ controlPlane: policyLibraryWithWritableSource(), storeDir: tempStore() });

    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'publish',
      tool: 'publish-api',
      intent: 'publish_content'
    });

    expect(result.allowed).toBe(true);
  });

  it('denies write actions on a read-only route even when tool is omitted', async () => {
    const controlPlane: ControlPlane = {
      ...basePolicyLibrary,
      profiles: basePolicyLibrary.profiles.map((profile) => (
        profile.id === 'research-agent'
          ? { ...profile, routes: [...profile.routes, { intent: 'readonly_publish', sources: ['web-search-api'] }] }
          : profile
      )),
      policies: [
        ...basePolicyLibrary.policies,
        {
          id: 'allow-toolless-publish',
          effect: 'allow',
          profiles: ['research-agent'],
          actions: ['publish'],
          reason: 'Publish allowed for route read-only enforcement test.'
        }
      ]
    };
    const cmdb = createAgentCmdb({ controlPlane, storeDir: tempStore() });

    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'publish',
      intent: 'readonly_publish'
    });

    expect(result.allowed).toBe(false);
    expect(result.decision.reason).toContain('read-only');
  });

  it('removes read-only fallback sources from write action routes', async () => {
    const controlPlane: ControlPlane = {
      ...basePolicyLibrary,
      sources: [
        ...basePolicyLibrary.sources,
        {
          id: 'publish-api',
          label: 'Publish API',
          kind: 'tool',
          readOnly: false
        }
      ],
      profiles: basePolicyLibrary.profiles.map((profile) => (
        profile.id === 'research-agent'
          ? { ...profile, routes: [...profile.routes, { intent: 'mixed_publish', sources: ['publish-api', 'web-search-api'] }] }
          : profile
      )),
      policies: [
        ...basePolicyLibrary.policies,
        {
          id: 'allow-mixed-publish',
          effect: 'allow',
          profiles: ['research-agent'],
          actions: ['publish'],
          reason: 'Publish allowed for mixed route read-only enforcement test.'
        }
      ]
    };
    const cmdb = createAgentCmdb({ controlPlane, storeDir: tempStore() });

    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'publish',
      intent: 'mixed_publish'
    });

    expect(result.allowed).toBe(true);
    expect(result.route?.sources.map((source) => source.id)).toEqual(['publish-api']);
    expect(result.route?.skippedSources).toContain('web-search-api');
  });
});

describe('v2.1 preflight result shape', () => {
  it('does not return a route on denied preflight', async () => {
    const cmdb = createAgentCmdb({ controlPlane: basePolicyLibrary, storeDir: tempStore() });

    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'social_post',
      tool: 'social-media-tool',
      intent: 'web_research'
    });

    expect(result.allowed).toBe(false);
    expect('route' in result).toBe(false);
  });
});

describe('v2.1 renamed reliability API', () => {
  it('uses reliability naming instead of legacy service-level naming', async () => {
    const cmdb = createAgentCmdb({ controlPlane: basePolicyLibrary, storeDir: tempStore() });

    await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'web-search-api'
    });
    const reliability = await cmdb.ops.calculateReliability('research-agent');

    expect(reliability.profile).toBe('research-agent');
    expect('calculateSlo' in cmdb.ops).toBe(false);
  });
});

describe('v2.1 tamper and package boundary behavior', () => {
  it('throws on corrupted evidence when tamperMode is fail', async () => {
    const storeDir = tempStore();
    writeFileSync(
      join(storeDir, 'evidence-2026-05-25.jsonl'),
      '{"id":"ev_bad","prevHash":"bad","profile":"research-agent","source":"web-search-api","intent":"web_research","summary":"tampered","trust":"high","capturedAt":"2026-05-25T00:00:00.000Z"}\n',
      'utf8'
    );
    const cmdb = createAgentCmdb({ controlPlane: basePolicyLibrary, storeDir, tamperMode: 'fail' });

    await expect(cmdb.memory.listEvidence({ dateRange: { from: '2026-05-25', to: '2026-05-25' } })).rejects.toThrow(
      'Corrupt JSONL store'
    );
  });

  it('warns on corrupted evidence when tamperMode is warn', async () => {
    const storeDir = tempStore();
    writeFileSync(
      join(storeDir, 'evidence-2026-05-25.jsonl'),
      '{"id":"ev_bad","prevHash":"bad","profile":"research-agent","source":"web-search-api","intent":"web_research","summary":"tampered","trust":"high","capturedAt":"2026-05-25T00:00:00.000Z"}\n',
      'utf8'
    );
    const cmdb = createAgentCmdb({ controlPlane: basePolicyLibrary, storeDir, tamperMode: 'warn' });

    const records = await cmdb.memory.listEvidence({ dateRange: { from: '2026-05-25', to: '2026-05-25' } });

    expect(records).toHaveLength(1);
    expect(records[0].warnings?.[0]).toContain('hash chain warning');
  });

  it('resets corrupted health state to up with warnings instead of blackholing sources', async () => {
    const storeDir = tempStore();
    writeFileSync(
      join(storeDir, 'health.json'),
      JSON.stringify({
        sources: [{
          sourceId: 'web-search-api',
          status: 'down',
          consecutiveFailures: 99,
          lastChecked: '2026-05-25T00:00:00.000Z',
          lastFailure: '2026-05-25T00:00:00.000Z'
        }],
        prevHash: 'tampered'
      }),
      'utf8'
    );
    const cmdb = createAgentCmdb({ controlPlane: basePolicyLibrary, storeDir });

    await expect(cmdb.ops.getSourceHealth('web-search-api')).resolves.toMatchObject({
      sourceId: 'web-search-api',
      status: 'up',
      consecutiveFailures: 0
    });
    expect(cmdb.health().issues.some((issue) => issue.message.includes('Health state was tampered'))).toBe(true);
  });

  it('blocks undocumented dist and src deep imports through package exports', async () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const exportsMap = packageJson.exports;

    expect(exportsMap['./dist/*']).toBe(null);
    expect(exportsMap['./src/*']).toBe(null);
  });
});

describe('v2.1 CLI help completeness', () => {
  for (const [command, expected] of [
    ['route', 'Usage: agent-cmdb route'],
    ['brain', 'Usage: agent-cmdb brain'],
    ['digest', 'Usage: agent-cmdb digest'],
    ['doctor', 'Usage: agent-cmdb doctor'],
    ['inspect', 'Usage: agent-cmdb inspect'],
    ['evidence-add', '--summary <text>'],
    ['change-add', '--target <id>'],
    ['validate', 'Validate the policy library config']
  ]) {
    it(`prints specific help for ${command}`, () => {
      const output = execFileSync(process.execPath, [tsxCli, join(process.cwd(), 'src', 'cli.ts'), command, '--help'], {
        encoding: 'utf8'
      });

      expect(output).toContain(expected);
      expect(output).not.toBe(execFileSync(process.execPath, [tsxCli, join(process.cwd(), 'src', 'cli.ts'), '--help'], {
        encoding: 'utf8'
      }));
    });
  }
});
