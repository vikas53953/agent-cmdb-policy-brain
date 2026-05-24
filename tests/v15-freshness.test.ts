import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';
import { resolveSourceRoute } from '../src/route-resolver.js';
import type { ControlPlane } from '../src/types.js';

const controlPlane: ControlPlane = {
  version: '1.5-test',
  updatedAt: '2026-05-24T00:00:00.000Z',
  sources: [
    {
      id: 'local-docs',
      label: 'Local Docs',
      kind: 'wiki',
      readOnly: true,
      freshnessTtl: '7d',
      brainEntityId: 'agent-security'
    },
    {
      id: 'web-search',
      label: 'Web Search',
      kind: 'web',
      readOnly: true,
      freshnessTtl: '1h'
    }
  ],
  profiles: [
    {
      id: 'research-agent',
      name: 'Research Agent',
      purpose: 'Research',
      guardrails: ['Prefer local docs first.'],
      routes: [
        {
          intent: 'web_research',
          sources: ['local-docs', 'web-search'],
          blockOnStale: true
        }
      ]
    }
  ],
  policies: [],
  objects: [],
  relationships: []
};

describe('source freshness scoring', () => {
  it('marks sources stale when provided freshness is older than the TTL', () => {
    const route = resolveSourceRoute(controlPlane, {
      profile: 'research-agent',
      intent: 'web_research',
      freshness: [
        {
          sourceId: 'local-docs',
          lastUpdated: '2020-01-01T00:00:00.000Z'
        },
        {
          sourceId: 'web-search',
          lastUpdated: new Date().toISOString()
        }
      ]
    });

    expect(route.staleSourceIds).toEqual(['local-docs']);
    expect(route.freshness.map((entry) => [entry.sourceId, entry.stale])).toEqual([
      ['local-docs', true],
      ['web-search', false]
    ]);
  });

  it('keeps freshness empty when no freshness snapshot is supplied', () => {
    const route = resolveSourceRoute(controlPlane, {
      profile: 'research-agent',
      intent: 'web_research'
    });

    expect(route.staleSourceIds).toEqual([]);
    expect(route.freshness).toEqual([]);
  });

  it('denies preflight when blockOnStale is true and a routed source is stale', async () => {
    const cmdb = createAgentCmdb({
      controlPlane: {
        ...controlPlane,
        policies: [
          {
            id: 'allow-web-research',
            effect: 'allow',
            profiles: ['research-agent'],
            actions: ['web_research'],
            tools: ['web-search'],
            reason: 'Research is allowed.'
          }
        ]
      },
      storeDir: joinTempStore()
    });

    const result = await cmdb.preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'web-search',
      intent: 'web_research',
      freshness: [
        {
          sourceId: 'local-docs',
          lastUpdated: '2020-01-01T00:00:00.000Z'
        },
        {
          sourceId: 'web-search',
          lastUpdated: new Date().toISOString()
        }
      ]
    });

    expect(result.allowed).toBe(false);
    expect(result.decision.ruleId).toBe('stale-source-blocked');
    expect(result.decision.reason).toContain('local-docs');
  });
});

function joinTempStore(): string {
  return mkdtempSync(join(tmpdir(), 'agent-cmdb-freshness-preflight-'));
}
