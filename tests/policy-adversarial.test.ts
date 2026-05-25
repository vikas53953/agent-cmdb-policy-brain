import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../src/internal.js';
import { multiAgentExampleControlPlanePath, loadControlPlane } from '../src/loader.js';
import { validateControlPlane } from '../src/validator.js';
import type { ControlPlane, PolicyRule } from '../src/types.js';

function withPolicies(policies: PolicyRule[]): ControlPlane {
  return {
    ...loadControlPlane(multiAgentExampleControlPlanePath),
    policy: {
      ...loadControlPlane(multiAgentExampleControlPlanePath).policy,
      policies
    }
  };
}

describe('Agent CMDB policy adversarial behavior', () => {
  it('evaluates against 100 policies without meaningful degradation', () => {
    const policies: PolicyRule[] = Array.from({ length: 99 }, (_, index) => ({
      id: `non-match-${index}`,
      effect: 'allow',
      profiles: ['content-agent'],
      actions: [`unused_action_${index}`],
      reason: 'Synthetic non-match.'
    }));
    policies.push({
      id: 'target-deny',
      effect: 'deny',
      profiles: ['research-agent'],
      actions: ['social_post'],
      reason: 'Synthetic target deny.'
    });

    const startedAt = performance.now();
    const decision = evaluatePolicy(withPolicies(policies), {
      profile: 'research-agent',
      action: 'social_post',
      tool: 'web-search-api'
    });
    const elapsedMs = performance.now() - startedAt;

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('target-deny');
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it('lets a global deny beat a profile-specific allow even when deny appears first', () => {
    const decision = evaluatePolicy(
      withPolicies([
        {
          id: 'global-deny',
          effect: 'deny',
          profiles: ['*'],
          actions: ['social_post'],
          reason: 'Global deny.'
        },
        {
          id: 'research-allow',
          effect: 'allow',
          profiles: ['research-agent'],
          actions: ['social_post'],
          reason: 'Profile-specific allow.'
        }
      ]),
      { profile: 'research-agent', action: 'social_post', tool: 'web-search-api' }
    );

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('global-deny');
  });

  it('lets a global deny beat a profile-specific allow even when deny appears last', () => {
    const decision = evaluatePolicy(
      withPolicies([
        {
          id: 'research-allow',
          effect: 'allow',
          profiles: ['research-agent'],
          actions: ['social_post'],
          reason: 'Profile-specific allow.'
        },
        {
          id: 'global-deny',
          effect: 'deny',
          profiles: ['*'],
          actions: ['social_post'],
          reason: 'Global deny.'
        }
      ]),
      { profile: 'research-agent', action: 'social_post', tool: 'web-search-api' }
    );

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('global-deny');
  });

  it('matches wildcard actions, profiles, and tools as a catch-all rule', () => {
    const decision = evaluatePolicy(
      withPolicies([
        {
          id: 'catch-all-approval',
          effect: 'approval_required',
          profiles: ['*'],
          actions: ['*'],
          tools: ['*'],
          reason: 'Everything must be approved.'
        }
      ]),
      { profile: 'research-agent', action: 'brand_new_action', tool: 'web-search-api' }
    );

    expect(decision.effect).toBe('approval_required');
    expect(decision.ruleId).toBe('catch-all-approval');
  });

  it('does not match wildcard tool rules when the request has no tool', () => {
    const decision = evaluatePolicy(
      withPolicies([
        {
          id: 'tool-explicit-catch-all',
          effect: 'allow',
          profiles: ['*'],
          actions: ['*'],
          tools: ['*'],
          reason: 'Only requests carrying a tool should match.'
        }
      ]),
      { profile: 'research-agent', action: 'brand_new_action' }
    );

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('default-deny');
  });

  it('returns deny decisions for empty request strings', () => {
    const controlPlane = loadControlPlane(multiAgentExampleControlPlanePath);

    expect(evaluatePolicy(controlPlane, { profile: '', action: 'web_research' }).effect).toBe('deny');
    expect(evaluatePolicy(controlPlane, { profile: 'research-agent', action: '' }).effect).toBe('deny');
    expect(evaluatePolicy(controlPlane, { profile: 'research-agent', action: 'web_research', tool: '' }).effect).toBe('deny');
  });

  it('is statically and dynamically guarded against nullish string inputs', () => {
    const controlPlane = loadControlPlane(multiAgentExampleControlPlanePath);

    expect(
      evaluatePolicy(controlPlane, {
        // @ts-expect-error runtime adversarial input still needs a clean error
        profile: null,
        action: 'web_research'
      })
    ).toMatchObject({ effect: 'deny', ruleId: 'invalid-request' });

    expect(
      evaluatePolicy(controlPlane, {
        profile: 'research-agent',
        // @ts-expect-error runtime adversarial input still needs a clean error
        action: undefined
      })
    ).toMatchObject({ effect: 'deny', ruleId: 'invalid-request' });
  });

  it('warns when deny and allow policies conflict on the same request shape', () => {
    const issues = validateControlPlane(
      withPolicies([
        {
          id: 'research-allow',
          effect: 'allow',
          profiles: ['research-agent'],
          actions: ['social_post'],
          reason: 'Profile allow.'
        },
        {
          id: 'global-deny',
          effect: 'deny',
          profiles: ['*'],
          actions: ['social_post'],
          reason: 'Global deny.'
        }
      ])
    );

    expect(issues).toContainEqual({
      severity: 'warning',
      code: 'policy_conflict',
      message: 'Policy research-allow conflicts with policy global-deny; deny will win for overlapping requests.'
    });
  });
});
