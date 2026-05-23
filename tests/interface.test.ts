import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';

describe('IAgentCMDB contract', () => {
  it('exposes preflight, routes, evidence, changes, and health through one stable facade', async () => {
    const storeDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-interface-'));
    const cmdb = createAgentCmdb({ storeDir });

    const preflight = cmdb.preflight({
      profile: 'gemma4cloud',
      action: 'x_account_post',
      tool: 'xurl',
      intent: 'x_research'
    });

    expect(preflight.allowed).toBe(false);
    expect(preflight.decision.code).toBe('xurl_account_actions_disabled');
    expect(preflight.routeExecutable).toBe(false);

    const route = cmdb.resolveRoute({
      profile: 'apple-farming',
      intent: 'weather'
    });

    expect(route.sources[0].id).toBe('apple-wiki');

    await cmdb.logEvidence({
      profile: 'gemma4cloud',
      source: 'techmeme-pp-cli',
      intent: 'x_research',
      summary: 'Interface smoke evidence',
      trust: 'medium',
      capturedAt: '2026-05-24T00:20:00.000Z'
    });

    await cmdb.logChange({
      target: 'policy.global-deny-xurl-account-actions',
      targetType: 'policy',
      action: 'verify',
      actor: 'codex',
      reason: 'Interface smoke change',
      changedAt: '2026-05-24T00:21:00.000Z'
    });

    expect(await cmdb.listEvidence({ profile: 'gemma4cloud' })).toHaveLength(1);
    expect(await cmdb.listChanges({ actor: 'codex' })).toHaveLength(1);
    expect(cmdb.health().ok).toBe(true);
  });
});
