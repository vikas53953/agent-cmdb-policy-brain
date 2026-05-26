import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';
import type { ControlPlane } from '../src/types.js';

function controlPlane(): ControlPlane {
  return {
    version: '1.0',
    updatedAt: '2026-05-25',
    policy: {
      writeActions: ['create', 'update', 'delete', 'write', 'post', 'publish', 'send', 'modify'],
      policies: [
        {
          id: 'allow-research-update',
          effect: 'allow',
          profiles: ['research-agent'],
          actions: ['research_update'],
          tools: ['web-search-api'],
          reason: 'Research status updates are read-only summaries.'
        },
        {
          id: 'allow-send-summary',
          effect: 'allow',
          profiles: ['research-agent'],
          actions: ['send_summary'],
          tools: ['web-search-api'],
          reason: 'Summary generation is read-only.'
        },
        {
          id: 'allow-web-search',
          effect: 'allow',
          profiles: ['research-agent'],
          actions: ['web_search'],
          tools: ['web-search-api'],
          reason: 'Research is allowed.'
        }
      ]
    },
    sources: {
      sources: [
        {
          id: 'web-search-api',
          label: 'Web Search API',
          kind: 'tool',
          readOnly: true
        }
      ],
      profiles: [
        {
          id: 'research-agent',
          name: 'Research Agent',
          purpose: 'Research',
          guardrails: [],
          routes: [
            {
              intent: 'web_research',
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

describe('v3.1.1 contract gaps', () => {
  it('does not classify compound read action research_update as a write just because it contains update', async () => {
    const cmdb = createAgentCmdb({
      controlPlane: controlPlane(),
      storeDir: mkdtempSync(join(tmpdir(), 'agent-cmdb-v311-write-match-'))
    });

    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'research_update',
      tool: 'web-search-api',
      intent: 'web_research'
    });

    expect(result.allowed).toBe(true);
  });

  it('does not classify compound read action send_summary as a write just because it contains send', async () => {
    const cmdb = createAgentCmdb({
      controlPlane: controlPlane(),
      storeDir: mkdtempSync(join(tmpdir(), 'agent-cmdb-v311-send-summary-'))
    });

    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'send_summary',
      tool: 'web-search-api'
    });

    expect(result.allowed).toBe(true);
  });

  it('does not silently allow preflight when default tamperMode sees corrupt health state', async () => {
    const storeDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-v311-preflight-tamper-'));
    writeFileSync(join(storeDir, 'health.json'), '{"sources":[],"prevHash":"bad"}', 'utf8');
    const cmdb = createAgentCmdb({
      controlPlane: controlPlane(),
      storeDir
    });

    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'web_search',
      tool: 'web-search-api',
      intent: 'web_research'
    });

    expect(result.allowed).toBe(false);
    expect(result.decision.ruleId).toBe('preflight-error');
    const evidence = await cmdb.memory.listEvidence();
    expect(evidence).toContainEqual(expect.objectContaining({
      tags: expect.arrayContaining(['preflight', 'deny', 'preflight-error'])
    }));
  });

  it('returns explicit deny metadata from resolveRoute failures instead of warnings-only empty routes', async () => {
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

    const result = await cmdb.policy.resolveRoute({
      profile: 'does-not-exist',
      intent: 'anything'
    });

    expect(result).toMatchObject({
      profile: 'does-not-exist',
      intent: 'anything',
      sources: [],
      warnings: [expect.any(String)],
      allowed: false,
      decision: {
        effect: 'deny',
        ruleId: 'route-resolution-failed',
        code: 'route_resolution_failed'
      }
    });
  });
});
