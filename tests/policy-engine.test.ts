import { describe, expect, it } from 'vitest';
import { evaluatePolicy, hermesV1ControlPlane } from '../src/engine.js';

describe('Agent CMDB policy engine', () => {
  it('denies xurl-backed X account posting even when research is otherwise allowed', () => {
    const decision = evaluatePolicy(hermesV1ControlPlane, {
      profile: 'gemma4cloud',
      action: 'x_account_post',
      tool: 'xurl'
    });

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('global-deny-xurl-account-actions');
    expect(decision.reason).toContain('xurl');
  });

  it('denies Bot Ops status sends for Gemma', () => {
    const decision = evaluatePolicy(hermesV1ControlPlane, {
      profile: 'gemma4cloud',
      action: 'send_bot_ops_status',
      tool: 'telegram'
    });

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('global-deny-bot-ops-status');
    expect(decision.canEscalate).toBe(false);
  });

  it('allows read-only X research for Gemma through xAI OAuth', () => {
    const decision = evaluatePolicy(hermesV1ControlPlane, {
      profile: 'gemma4cloud',
      action: 'x_research',
      tool: 'xai-oauth'
    });

    expect(decision.effect).toBe('allow');
    expect(decision.ruleId).toBe('gemma-allow-readonly-research');
  });

  it('denies X account actions even when no tool is provided', () => {
    const decision = evaluatePolicy(hermesV1ControlPlane, {
      profile: 'gemma4cloud',
      action: 'x_account_reply'
    });

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('global-deny-x-account-actions');
    expect(decision.suggestedAlternative).toContain('Grok/xAI OAuth');
  });

  it('supports wildcard actions for catch-all rules', () => {
    const decision = evaluatePolicy(
      {
        ...hermesV1ControlPlane,
        policies: [
          {
            id: 'gemma-maintenance-freeze',
            effect: 'deny',
            profiles: ['gemma4cloud'],
            actions: ['*'],
            reason: 'Profile is in a maintenance freeze.',
            canEscalate: true,
            suggestedAlternative: 'Wait until the freeze is lifted.'
          }
        ]
      },
      {
        profile: 'gemma4cloud',
        action: 'x_research',
        tool: 'xai-oauth'
      }
    );

    expect(decision.effect).toBe('deny');
    expect(decision.ruleId).toBe('gemma-maintenance-freeze');
    expect(decision.canEscalate).toBe(true);
  });

  it('requires approval for unknown actions', () => {
    const decision = evaluatePolicy(hermesV1ControlPlane, {
      profile: 'gemma4cloud',
      action: 'new_unclassified_action',
      tool: 'unknown-tool'
    });

    expect(decision.effect).toBe('approval_required');
    expect(decision.ruleId).toBe('default-approval-required');
  });
});
