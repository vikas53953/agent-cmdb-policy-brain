import { describe, expect, it } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';
import { loadControlPlane, multiAgentExampleControlPlanePath } from '../src/loader.js';
import type { ControlPlane } from '../src/types.js';

const basePolicyLibrary = loadControlPlane(multiAgentExampleControlPlanePath);

describe('v3 hot path safety', () => {
  it('returns deny for unknown profile instead of throwing', async () => {
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

    await expect(cmdb.policy.preflight({
      profile: 'does-not-exist',
      action: 'anything',
      tool: 'nothing'
    })).resolves.toMatchObject({
      allowed: false,
      decision: {
        effect: 'deny',
        ruleId: 'unknown-profile'
      }
    });
  });

  it('returns deny for unknown source or tool instead of throwing', async () => {
    const cmdb = createAgentCmdb({ controlPlane: basePolicyLibrary });

    await expect(cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'not-a-real-source'
    })).resolves.toMatchObject({
      allowed: false,
      decision: {
        effect: 'deny',
        ruleId: 'unknown-source'
      }
    });
  });

  it('returns deny for missing profile field instead of throwing', async () => {
    const cmdb = createAgentCmdb({ controlPlane: basePolicyLibrary });
    type PreflightInput = Parameters<typeof cmdb.policy.preflight>[0];

    await expect(cmdb.policy.preflight({
      action: 'anything',
      tool: 'web-search-api'
    } as unknown as PreflightInput)).resolves.toMatchObject({
      allowed: false,
      decision: {
        effect: 'deny',
        ruleId: 'invalid-request'
      }
    });
  });

  it('returns deny for missing action field instead of throwing', async () => {
    const cmdb = createAgentCmdb({ controlPlane: basePolicyLibrary });
    type PreflightInput = Parameters<typeof cmdb.policy.preflight>[0];

    await expect(cmdb.policy.preflight({
      profile: 'research-agent',
      tool: 'web-search-api'
    } as unknown as PreflightInput)).resolves.toMatchObject({
      allowed: false,
      decision: {
        effect: 'deny',
        ruleId: 'invalid-request'
      }
    });
  });

  it('returns deny for empty profile string instead of throwing', async () => {
    const cmdb = createAgentCmdb({ controlPlane: basePolicyLibrary });

    await expect(cmdb.policy.preflight({
      profile: '',
      action: 'anything',
      tool: 'web-search-api'
    })).resolves.toMatchObject({
      allowed: false,
      decision: {
        effect: 'deny',
        ruleId: 'invalid-request'
      }
    });
  });
});
