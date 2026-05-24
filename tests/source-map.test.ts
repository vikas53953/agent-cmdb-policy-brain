import { describe, expect, it } from 'vitest';
import { multiAgentExampleControlPlanePath, inspectProfile, loadControlPlane, resolveSourceRoute } from '../src/engine.js';

const controlPlane = loadControlPlane(multiAgentExampleControlPlanePath);

describe('Agent CMDB source map', () => {
  it('routes content-agent weather through local knowledge before weather tools', () => {
    const route = resolveSourceRoute(controlPlane, {
      profile: 'content-agent',
      intent: 'weather'
    });

    expect(route.sources.map((source) => source.id)).toEqual([
      'local-knowledge-base',
      'weather-api',
      'weather-backup'
    ]);
    expect(route.guardrails).toContain('Prefer local knowledge before external sources.');
  });

  it('routes research-agent web research through read-only sources', () => {
    const route = resolveSourceRoute(controlPlane, {
      profile: 'research-agent',
      intent: 'web_research'
    });

    expect(route.sources.map((source) => source.id)).toEqual([
      'web-search-api',
      'recent-history-cache',
      'news-aggregator',
      'tech-forum'
    ]);
  });

  it('returns profile inspection with routes and guardrails', () => {
    const profile = inspectProfile(controlPlane, 'content-agent');

    expect(profile.id).toBe('content-agent');
    expect(profile.guardrails).toContain('Prefer local knowledge before external sources.');
    expect(profile.routes.map((route) => route.intent)).toContain('weather');
  });

  it('throws a clear error for unknown source routes', () => {
    expect(() =>
      resolveSourceRoute(controlPlane, {
        profile: 'content-agent',
        intent: 'social_post'
      })
    ).toThrow('No source route configured for profile content-agent and intent social_post.');
  });
});
