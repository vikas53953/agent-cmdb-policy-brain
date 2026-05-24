import { describe, expect, it } from 'vitest';
import { evaluatePolicy, multiAgentExampleControlPlanePath, loadControlPlane } from '../src/engine.js';

const controlPlane = loadControlPlane(multiAgentExampleControlPlanePath);

describe('Agent CMDB policy engine', () => {
  it('denies social-media-tool-backed social account posting even when research is otherwise allowed', () => {
    const decision = evaluatePolicy(controlPlane, {
      profile: 'research-agent',
      action: 'social_post',
      tool: 'social-media-tool'
    });

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('object-status-blocked');
    expect(decision.reason).toBe('Object tool.social-media-tool is blocked.');
  });

  it('denies Bot Ops status sends for Research', () => {
    const decision = evaluatePolicy(controlPlane, {
      profile: 'research-agent',
      action: 'send_bot_ops_status',
      tool: 'telegram'
    });

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('global-deny-bot-ops-status');
    expect(decision.canEscalate).toBe(false);
  });

  it('allows read-only web research through read-only sources', () => {
    const decision = evaluatePolicy(controlPlane, {
      profile: 'research-agent',
      action: 'web_research',
      tool: 'web-search-api'
    });

    expect(decision.effect).toBe('allow');
    expect(decision.ruleId).toBe('research-allow-readonly-research');
  });

  it('denies a request when the referenced source object is blocked', () => {
    const decision = evaluatePolicy(
      {
        ...controlPlane,
        objects: controlPlane.objects.map((object) => object.id === 'source.web-search-api'
          ? { ...object, status: 'blocked' }
          : object)
      },
      {
        profile: 'research-agent',
        action: 'web_research',
        tool: 'web-search-api'
      }
    );

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('object-status-blocked');
    expect(decision.reason).toBe('Object source.web-search-api is blocked.');
  });

  it('denies a request when the referenced source object is paused', () => {
    const decision = evaluatePolicy(
      {
        ...controlPlane,
        objects: controlPlane.objects.map((object) => object.id === 'source.web-search-api'
          ? { ...object, status: 'paused' }
          : object)
      },
      {
        profile: 'research-agent',
        action: 'web_research',
        tool: 'web-search-api'
      }
    );

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('object-status-paused');
    expect(decision.reason).toBe('Object source.web-search-api is paused.');
  });

  it('uses normal policy evaluation when the referenced object is active', () => {
    const decision = evaluatePolicy(controlPlane, {
      profile: 'research-agent',
      action: 'web_research',
      tool: 'web-search-api'
    });

    expect(decision.effect).toBe('allow');
    expect(decision.ruleId).toBe('research-allow-readonly-research');
  });

  it('uses normal policy evaluation when no source or tool object exists', () => {
    const decision = evaluatePolicy(
      {
        ...controlPlane,
        objects: controlPlane.objects.filter((object) => object.id !== 'source.web-search-api')
      },
      {
        profile: 'research-agent',
        action: 'web_research',
        tool: 'web-search-api'
      }
    );

    expect(decision.effect).toBe('allow');
    expect(decision.ruleId).toBe('research-allow-readonly-research');
  });

  it('denies social account actions even when no tool is provided', () => {
    const decision = evaluatePolicy(controlPlane, {
      profile: 'research-agent',
      action: 'social_reply'
    });

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('global-deny-social-account-actions');
    expect(decision.suggestedAlternative).toContain('read-only research sources');
  });

  it('supports wildcard actions for catch-all rules', () => {
    const decision = evaluatePolicy(
      {
        ...controlPlane,
        policies: [
          {
            id: 'research-maintenance-freeze',
            effect: 'deny',
            profiles: ['research-agent'],
            actions: ['*'],
            reason: 'Profile is in a maintenance freeze.',
            canEscalate: true,
            suggestedAlternative: 'Wait until the freeze is lifted.'
          }
        ]
      },
      {
        profile: 'research-agent',
        action: 'web_research',
        tool: 'web-search-api'
      }
    );

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('research-maintenance-freeze');
    expect(decision.canEscalate).toBe(true);
  });

  it('requires approval for unknown actions', () => {
    const decision = evaluatePolicy(controlPlane, {
      profile: 'research-agent',
      action: 'new_unclassified_action',
      tool: 'unknown-tool'
    });

    expect(decision.effect).toBe('approval_required');
    expect(decision.ruleId).toBe('default-approval-required');
  });
});
