import type { CmdbObject, ControlPlane, PolicyDecision, PolicyEffect, PolicyRequest, PolicyRule } from './types.js';
import { agentProfiles, policyRules, registryObjects, sourceRefs } from './config-access.js';

type LegacyPolicyEffect = PolicyEffect | 'approval_required';

const effectRank: Record<LegacyPolicyEffect, number> = {
  deny: 3,
  approval_required: 2,
  allow: 1
};

export function evaluatePolicy(controlPlane: ControlPlane, request: PolicyRequest): PolicyDecision {
  try {
    const normalizedRequest = normalizePolicyRequest(request);
    if (!profileExists(controlPlane, normalizedRequest.profile)) {
      return {
        effect: 'deny',
        ruleId: 'unknown-profile',
        code: 'unknown_profile',
        reason: `Profile ${normalizedRequest.profile} is not defined in the policy library.`,
        profile: normalizedRequest.profile,
        action: normalizedRequest.action,
        tool: normalizedRequest.tool,
        canEscalate: false,
        suggestedAlternative: 'Add the profile to the policy library before evaluating this action.'
      };
    }
    if (normalizedRequest.tool && !sourceOrToolExists(controlPlane, normalizedRequest.tool)) {
      return {
        effect: 'deny',
        ruleId: 'unknown-source',
        code: 'unknown_source',
        reason: `Source or tool ${normalizedRequest.tool} is not defined in the policy library.`,
        profile: normalizedRequest.profile,
        action: normalizedRequest.action,
        tool: normalizedRequest.tool,
        canEscalate: false,
        suggestedAlternative: 'Add the source or tool to the policy library before evaluating this action.'
      };
    }
    const blockedObject = findUnavailableReferencedObject(controlPlane, normalizedRequest);

    if (blockedObject) {
      return {
        effect: 'deny',
        ruleId: `object-status-${blockedObject.status}`,
        code: `object_${blockedObject.status}`,
        reason: `Object ${blockedObject.id} is ${blockedObject.status}.`,
        profile: normalizedRequest.profile,
        action: normalizedRequest.action,
        tool: normalizedRequest.tool,
        canEscalate: false,
        suggestedAlternative: 'Use an active source or tool.'
      };
    }

    const rules = policyRules(controlPlane);
    const matchingRules = rules.filter((rule) => policyMatches(rule, normalizedRequest));
    const selectedRule = matchingRules.sort((left, right) => {
      const rankDelta = effectRank[policyEffect(right)] - effectRank[policyEffect(left)];
      if (rankDelta !== 0) return rankDelta;
      return rules.indexOf(left) - rules.indexOf(right);
    })[0];

    if (!selectedRule) {
      return {
        effect: 'deny',
        ruleId: 'default-deny',
        code: 'default_deny',
        reason: 'No explicit allow rule matched this action.',
        profile: normalizedRequest.profile,
        action: normalizedRequest.action,
        tool: normalizedRequest.tool,
        canEscalate: false,
        suggestedAlternative: 'Add an explicit allow policy rule.'
      };
    }

    if (policyEffect(selectedRule) === 'approval_required') {
      return {
        effect: 'deny',
        ruleId: selectedRule.id,
        code: 'needs_approval',
        reason: selectedRule.reason,
        profile: normalizedRequest.profile,
        action: normalizedRequest.action,
        tool: normalizedRequest.tool,
        canEscalate: false,
        suggestedAlternative: selectedRule.suggestedAlternative ?? 'Route this action to a human approval workflow outside Agent CMDB.'
      };
    }

    return {
      effect: selectedRule.effect,
      ruleId: selectedRule.id,
      code: selectedRule.code ?? selectedRule.id,
      reason: selectedRule.reason,
      profile: normalizedRequest.profile,
      action: normalizedRequest.action,
      tool: normalizedRequest.tool,
      canEscalate: selectedRule.canEscalate ?? false,
      suggestedAlternative: selectedRule.suggestedAlternative
    };
  } catch (error) {
    const fallback = extractFallbackRequest(request);
    return {
      effect: 'deny',
      ruleId: 'invalid-request',
      code: 'invalid_request',
      reason: `Invalid policy request: ${error instanceof Error ? error.message : String(error)}`,
      profile: fallback.profile,
      action: fallback.action,
      tool: fallback.tool,
      canEscalate: false,
      suggestedAlternative: 'Provide a non-empty profile and action before evaluating policy.'
    };
  }
}

export function normalizePolicyRequest(request: PolicyRequest): PolicyRequest {
  const record = requireRecord(request, 'Policy request');
  const tool = record.tool === undefined
    ? undefined
    : requireNonEmptyString(record.tool, 'Policy request tool', 'when provided');

  return {
    profile: requireNonEmptyString(record.profile, 'Policy request profile'),
    action: requireNonEmptyString(record.action, 'Policy request action'),
    tool
  };
}

export function policyMatches(rule: PolicyRule, request: PolicyRequest): boolean {
  if (!matchesList(rule.actions, request.action)) return false;
  if (rule.profiles && !matchesList(rule.profiles, request.profile)) return false;
  if (rule.tools && !request.tool) return false;
  if (rule.tools && request.tool && !matchesList(rule.tools, request.tool)) return false;
  return true;
}

export function policyShadows(candidate: PolicyRule, policy: PolicyRule): boolean {
  if (candidate.effect !== policy.effect) return false;
  return listCovers(candidate.actions, policy.actions)
    && optionalListCovers(candidate.profiles, policy.profiles)
    && optionalListCovers(candidate.tools, policy.tools);
}

export function policiesConflict(left: PolicyRule, right: PolicyRule): boolean {
  if (left.effect === right.effect) return false;
  if (left.effect !== 'deny' && right.effect !== 'deny') return false;
  return listOverlaps(left.actions, right.actions)
    && optionalListOverlaps(left.profiles, right.profiles)
    && optionalListOverlaps(left.tools, right.tools);
}

function matchesList(values: string[], candidate: string): boolean {
  return values.includes('*') || values.includes(candidate);
}

function policyEffect(rule: PolicyRule): LegacyPolicyEffect {
  return (rule as PolicyRule & { effect: LegacyPolicyEffect }).effect;
}

function optionalListCovers(candidate: string[] | undefined, policy: string[] | undefined): boolean {
  if (!candidate) return true;
  if (!policy) return candidate.includes('*');
  return listCovers(candidate, policy);
}

function listCovers(candidate: string[], policy: string[]): boolean {
  return candidate.includes('*') || policy.every((value) => candidate.includes(value));
}

function optionalListOverlaps(left: string[] | undefined, right: string[] | undefined): boolean {
  if (!left || !right) return true;
  return listOverlaps(left, right);
}

function listOverlaps(left: string[], right: string[]): boolean {
  return left.includes('*') || right.includes('*') || left.some((value) => right.includes(value));
}

function findUnavailableReferencedObject(controlPlane: ControlPlane, request: PolicyRequest): CmdbObject | undefined {
  if (!request.tool) return undefined;

  const candidateIds = new Set([
    request.tool,
    `source.${request.tool}`,
    `tool.${request.tool}`
  ]);

  return registryObjects(controlPlane).find((object) => (
    candidateIds.has(object.id)
    && (object.status === 'blocked' || object.status === 'paused')
  ));
}

function profileExists(controlPlane: ControlPlane, profileId: string): boolean {
  try {
    return agentProfiles(controlPlane).some((candidate) => candidate.id === profileId);
  } catch {
    return false;
  }
}

function sourceOrToolExists(controlPlane: ControlPlane, sourceId: string): boolean {
  const candidateIds = new Set([
    sourceId,
    `source.${sourceId}`,
    `tool.${sourceId}`
  ]);
  try {
    return sourceRefs(controlPlane).some((source) => candidateIds.has(source.id))
      || registryObjects(controlPlane).some((object) => candidateIds.has(object.id));
  } catch {
    return false;
  }
}

function extractFallbackRequest(request: unknown): PolicyRequest {
  if (request && typeof request === 'object' && !Array.isArray(request)) {
    const record = request as Record<string, unknown>;
    return {
      profile: typeof record.profile === 'string' && record.profile.trim() ? record.profile : 'unknown-profile',
      action: typeof record.action === 'string' && record.action.trim() ? record.action : 'unknown-action',
      tool: typeof record.tool === 'string' && record.tool.trim() ? record.tool : undefined
    };
  }
  return {
    profile: 'unknown-profile',
    action: 'unknown-action'
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string, suffix?: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    const suffixText = suffix ? ` ${suffix}` : '';
    throw new Error(`${label} must be a non-empty string${suffixText}.`);
  }
  return value;
}
