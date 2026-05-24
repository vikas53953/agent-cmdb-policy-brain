import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { evaluatePolicy, loadDefaultControlPlane, validateControlPlane } from '../src/engine.js';
import type { ControlPlane, PolicyRule } from '../src/types.js';

function withPolicies(policies: PolicyRule[]): ControlPlane {
  return {
    ...loadDefaultControlPlane(),
    policies
  };
}

describe('Agent CMDB policy adversarial behavior', () => {
  it('evaluates against 100 policies without meaningful degradation', () => {
    const policies: PolicyRule[] = Array.from({ length: 99 }, (_, index) => ({
      id: `non-match-${index}`,
      effect: 'allow',
      profiles: ['apple-farming'],
      actions: [`unused_action_${index}`],
      reason: 'Synthetic non-match.'
    }));
    policies.push({
      id: 'target-deny',
      effect: 'deny',
      profiles: ['gemma4cloud'],
      actions: ['x_account_post'],
      reason: 'Synthetic target deny.'
    });

    const startedAt = performance.now();
    const decision = evaluatePolicy(withPolicies(policies), {
      profile: 'gemma4cloud',
      action: 'x_account_post',
      tool: 'xurl'
    });
    const elapsedMs = performance.now() - startedAt;

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('target-deny');
    expect(elapsedMs).toBeLessThan(100);
  });

  it('lets a global deny beat a profile-specific allow even when deny appears first', () => {
    const decision = evaluatePolicy(
      withPolicies([
        {
          id: 'global-deny',
          effect: 'deny',
          profiles: ['*'],
          actions: ['x_account_post'],
          reason: 'Global deny.'
        },
        {
          id: 'gemma-allow',
          effect: 'allow',
          profiles: ['gemma4cloud'],
          actions: ['x_account_post'],
          reason: 'Profile-specific allow.'
        }
      ]),
      { profile: 'gemma4cloud', action: 'x_account_post', tool: 'xurl' }
    );

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('global-deny');
  });

  it('lets a global deny beat a profile-specific allow even when deny appears last', () => {
    const decision = evaluatePolicy(
      withPolicies([
        {
          id: 'gemma-allow',
          effect: 'allow',
          profiles: ['gemma4cloud'],
          actions: ['x_account_post'],
          reason: 'Profile-specific allow.'
        },
        {
          id: 'global-deny',
          effect: 'deny',
          profiles: ['*'],
          actions: ['x_account_post'],
          reason: 'Global deny.'
        }
      ]),
      { profile: 'gemma4cloud', action: 'x_account_post', tool: 'xurl' }
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
      { profile: 'gemma4cloud', action: 'brand_new_action', tool: 'unknown-tool' }
    );

    expect(decision.effect).toBe('approval_required');
    expect(decision.ruleId).toBe('catch-all-approval');
  });

  it('throws descriptive runtime errors for empty request strings', () => {
    const controlPlane = loadDefaultControlPlane();

    expect(() => evaluatePolicy(controlPlane, { profile: '', action: 'x_research' })).toThrow(
      'Policy request profile must be a non-empty string.'
    );
    expect(() => evaluatePolicy(controlPlane, { profile: 'gemma4cloud', action: '' })).toThrow(
      'Policy request action must be a non-empty string.'
    );
    expect(() =>
      evaluatePolicy(controlPlane, { profile: 'gemma4cloud', action: 'x_research', tool: '' })
    ).toThrow('Policy request tool must be a non-empty string when provided.');
  });

  it('is statically and dynamically guarded against nullish string inputs', () => {
    const controlPlane = loadDefaultControlPlane();

    expect(() =>
      evaluatePolicy(controlPlane, {
        // @ts-expect-error runtime adversarial input still needs a clean error
        profile: null,
        action: 'x_research'
      })
    ).toThrow('Policy request profile must be a non-empty string.');

    expect(() =>
      evaluatePolicy(controlPlane, {
        profile: 'gemma4cloud',
        // @ts-expect-error runtime adversarial input still needs a clean error
        action: undefined
      })
    ).toThrow('Policy request action must be a non-empty string.');
  });

  it('warns when deny and allow policies conflict on the same request shape', () => {
    const issues = validateControlPlane(
      withPolicies([
        {
          id: 'gemma-allow',
          effect: 'allow',
          profiles: ['gemma4cloud'],
          actions: ['x_account_post'],
          reason: 'Profile allow.'
        },
        {
          id: 'global-deny',
          effect: 'deny',
          profiles: ['*'],
          actions: ['x_account_post'],
          reason: 'Global deny.'
        }
      ])
    );

    expect(issues).toContainEqual({
      severity: 'warning',
      code: 'policy_conflict',
      message: 'Policy gemma-allow conflicts with policy global-deny; deny will win for overlapping requests.'
    });
  });
});
