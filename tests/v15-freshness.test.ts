import { describe, expect, it } from 'vitest';
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
          sources: ['local-docs', 'web-search']
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
      now: '2026-05-24T12:00:00.000Z',
      freshness: [
        {
          sourceId: 'local-docs',
          lastUpdated: '2026-05-10T12:00:00.000Z'
        },
        {
          sourceId: 'web-search',
          lastUpdated: '2026-05-24T11:30:00.000Z'
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
});
