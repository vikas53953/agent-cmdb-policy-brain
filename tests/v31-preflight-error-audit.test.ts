import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';
import type { ControlPlane, SourceRef } from '../src/types.js';

describe('v3.1 preflight-error audit', () => {
  it('writes evidence and change records when the outer preflight catch fails closed', async () => {
    const brokenSource = {} as SourceRef;
    Object.defineProperty(brokenSource, 'id', {
      get() {
        throw new Error('synthetic source id failure');
      }
    });

    const cmdb = createAgentCmdb({
      storeDir: mkdtempSync(join(tmpdir(), 'agent-cmdb-preflight-error-audit-')),
      controlPlane: {
        version: '1.0',
        updatedAt: '2026-05-25',
        policy: { policies: [] },
        sources: {
          sources: [brokenSource],
          profiles: []
        },
        registry: {
          objects: [],
          relationships: []
        }
      } as ControlPlane
    });

    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'anything',
      tool: 'nothing'
    });

    expect(result.allowed).toBe(false);
    expect(result.decision.ruleId).toBe('preflight-error');

    const evidence = await cmdb.memory.listEvidence();
    expect(evidence).toEqual([
      expect.objectContaining({
        trust: 'high',
        tags: expect.arrayContaining(['preflight', 'preflight-error'])
      })
    ]);

    const changes = await cmdb.memory.listChanges();
    expect(changes).toEqual([
      expect.objectContaining({
        target: 'policy.preflight-error',
        action: 'verify',
        actor: 'agent-cmdb-preflight'
      })
    ]);
  });
});
