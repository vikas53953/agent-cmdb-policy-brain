import { describe, expect, it } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';
import type { ControlPlane } from '../src/types.js';

describe('v3.1 resolveRoute safety', () => {
  it('returns an empty-route result for unknown profiles instead of throwing', async () => {
    const cmdb = createAgentCmdb({
      controlPlane: {
        version: '1.0',
        updatedAt: '2026-05-25',
        sources: [],
        profiles: [],
        policies: [],
        objects: [],
        relationships: []
      } as unknown as ControlPlane
    });

    await expect(cmdb.policy.resolveRoute({
      profile: 'does-not-exist',
      intent: 'anything'
    })).resolves.toMatchObject({
      profile: 'does-not-exist',
      intent: 'anything',
      sources: [],
      skippedSources: [],
      guardrails: [],
      warnings: [expect.any(String)],
      blockOnStale: false,
      staleSourceIds: [],
      freshness: []
    });
  });
});
