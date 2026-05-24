import { describe, expect, it } from 'vitest';
import { inspectProfile, loadDefaultControlPlane, resolveSourceRoute } from '../src/engine.js';

const controlPlane = loadDefaultControlPlane();

describe('Agent CMDB source map', () => {
  it('routes apple-farming weather through wiki before PP weather tools', () => {
    const route = resolveSourceRoute(controlPlane, {
      profile: 'apple-farming',
      intent: 'weather'
    });

    expect(route.sources.map((source) => source.id)).toEqual([
      'apple-wiki',
      'open-meteo-pp-cli',
      'weather-goat-pp-cli'
    ]);
    expect(route.guardrails).toContain('Use Obsidian/wiki as primary truth before public sources.');
  });

  it('routes Gemma X research through xAI OAuth before supporting PP sources', () => {
    const route = resolveSourceRoute(controlPlane, {
      profile: 'gemma4cloud',
      intent: 'x_research'
    });

    expect(route.sources.map((source) => source.id)).toEqual([
      'xai-oauth',
      'last30days',
      'techmeme-pp-cli',
      'hackernews-pp-cli'
    ]);
  });

  it('returns profile inspection with routes and guardrails', () => {
    const profile = inspectProfile(controlPlane, 'apple-farming');

    expect(profile.id).toBe('apple-farming');
    expect(profile.guardrails).toContain('GBrain remains paused.');
    expect(profile.routes.map((route) => route.intent)).toContain('weather');
  });

  it('throws a clear error for unknown source routes', () => {
    expect(() =>
      resolveSourceRoute(controlPlane, {
        profile: 'apple-farming',
        intent: 'x_account_post'
      })
    ).toThrow('No source route configured for profile apple-farming and intent x_account_post.');
  });
});
