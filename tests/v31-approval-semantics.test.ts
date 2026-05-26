import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';
import { evaluatePolicy } from '../src/internal.js';
import type { ControlPlane, PolicyRule } from '../src/types.js';

const legacyApprovalRule = {
  id: 'human-review-required',
  effect: 'approval_required',
  profiles: ['research-agent'],
  actions: ['publish_report'],
  tools: ['web-search-api'],
  reason: 'Human review is required before publishing.'
} as unknown as PolicyRule;

function controlPlaneWith(policies: PolicyRule[]): ControlPlane {
  return {
    version: '1.0',
    updatedAt: '2026-05-25',
    policy: {
      policies
    },
    sources: {
      sources: [
        {
          id: 'web-search-api',
          label: 'Web Search API',
          kind: 'tool',
          readOnly: false
        }
      ],
      profiles: [
        {
          id: 'research-agent',
          name: 'Research Agent',
          purpose: 'Research and report drafting',
          guardrails: ['Human review before publication'],
          routes: [
            {
              intent: 'publish',
              sources: ['web-search-api']
            }
          ]
        }
      ]
    },
    registry: {
      objects: [],
      relationships: []
    }
  };
}

describe('v3.1 approval semantics', () => {
  it('collapses legacy approval_required policy decisions into deny decisions with needs_approval code', () => {
    const decision = evaluatePolicy(controlPlaneWith([legacyApprovalRule]), {
      profile: 'research-agent',
      action: 'publish_report',
      tool: 'web-search-api'
    });

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('human-review-required');
    expect(decision.code).toBe('needs_approval');
    expect(decision.canEscalate).toBe(false);
    expect(decision.reason).toContain('Human review is required');
  });

  it('returns denied preflight results without routes for legacy approval_required policies', async () => {
    const storeDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-approval-'));
    try {
      const cmdb = createAgentCmdb({
        controlPlane: controlPlaneWith([legacyApprovalRule]),
        storeDir
      });

      const result = await cmdb.policy.preflight({
        profile: 'research-agent',
        action: 'publish_report',
        tool: 'web-search-api',
        intent: 'publish'
      });

      expect(result.allowed).toBe(false);
      expect(result.decision.effect).toBe('deny');
      expect(result.decision.code).toBe('needs_approval');
      expect(result.route).toBeUndefined();
    } finally {
      rmSync(storeDir, { recursive: true, force: true });
    }
  });
});
