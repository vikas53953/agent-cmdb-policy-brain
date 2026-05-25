import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { multiAgentExampleControlPlanePath } from '../src/engine.js';
import { createAgentCmdb } from '../src/interface.js';

describe('IAgentCMDB contract', () => {
  it('exposes preflight, routes, evidence, changes, and health through one stable facade', async () => {
    const storeDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-interface-'));
    const cmdb = createAgentCmdb({ configPath: multiAgentExampleControlPlanePath, storeDir });

    const preflight = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'social_post',
      tool: 'social-media-tool',
      intent: 'web_research'
    });

    expect(preflight.allowed).toBe(false);
    expect(preflight.decision.code).toBe('object_blocked');
    expect(preflight.route).toBeUndefined();

    const route = await cmdb.policy.resolveRoute({
      profile: 'content-agent',
      intent: 'weather'
    });

    expect(route.sources[0].id).toBe('local-knowledge-base');

    await cmdb.memory.logEvidence({
      profile: 'research-agent',
      source: 'news-aggregator',
      intent: 'web_research',
      summary: 'Interface smoke evidence',
      trust: 'medium',
      capturedAt: '2026-05-24T00:20:00.000Z'
    });

    await cmdb.memory.logChange({
      target: 'policy.global-deny-social-media-tool-account-actions',
      targetType: 'policy',
      action: 'verify',
      actor: 'codex',
      reason: 'Interface smoke change',
      changedAt: '2026-05-24T00:21:00.000Z'
    });

    expect(await cmdb.memory.listEvidence({ profile: 'research-agent' })).toHaveLength(2);
    expect(await cmdb.memory.listChanges({ actor: 'codex' })).toHaveLength(1);
    expect(await cmdb.memory.listChanges({ actor: 'agent-cmdb-preflight' })).toHaveLength(1);
    expect(cmdb.health().ok).toBe(true);
  });
});
