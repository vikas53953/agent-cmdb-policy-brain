import type { CmdbObject, ControlPlane, PolicyDecision, PolicyEffect, PolicyRequest, PolicyRule } from './types.js';

const effectRank: Record<PolicyEffect, number> = {
  deny: 3,
  approval_required: 2,
  allow: 1
};

export function evaluatePolicy(controlPlane: ControlPlane, request: PolicyRequest): PolicyDecision {
  const normalizedRequest = normalizePolicyRequest(request);
  ensureProfileExists(controlPlane, normalizedRequest.profile);
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

  const matchingRules = controlPlane.policies.filter((rule) => policyMatches(rule, normalizedRequest));
  const selectedRule = matchingRules.sort((left, right) => {
    const rankDelta = effectRank[right.effect] - effectRank[left.effect];
    if (rankDelta !== 0) return rankDelta;
    return controlPlane.policies.indexOf(left) - controlPlane.policies.indexOf(right);
  })[0];

  if (!selectedRule) {
    return {
      effect: 'approval_required',
      ruleId: 'default-approval-required',
      code: 'no_explicit_policy_match',
      reason: 'No explicit allow rule matched this action, so approval is required.',
      profile: normalizedRequest.profile,
      action: normalizedRequest.action,
      tool: normalizedRequest.tool,
      canEscalate: true,
      suggestedAlternative: 'Ask for explicit approval or add a policy rule.'
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
    canEscalate: selectedRule.canEscalate ?? selectedRule.effect === 'approval_required',
    suggestedAlternative: selectedRule.suggestedAlternative
  };
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
  if (rule.tools && !request.tool) return rule.tools.includes('*');
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

  return controlPlane.objects.find((object) => (
    candidateIds.has(object.id)
    && (object.status === 'blocked' || object.status === 'paused')
  ));
}

function ensureProfileExists(controlPlane: ControlPlane, profileId: string): void {
  if (!controlPlane.profiles.some((candidate) => candidate.id === profileId)) {
    throw new Error(`Unknown profile: ${profileId}.`);
  }
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
