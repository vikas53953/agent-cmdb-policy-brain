import { evaluatePolicy, normalizePolicyRequest } from './policy-engine.js';
import { inspectProfile, resolveSourceRoute } from './route-resolver.js';
import type { ControlPlane, PreflightRequest, PreflightResult, ResolvedSourceRoute } from './types.js';

export function preflightAction(controlPlane: ControlPlane, request: PreflightRequest): PreflightResult {
  const normalizedRequest = normalizePreflightRequest(request);
  const decision = evaluatePolicy(controlPlane, normalizedRequest);
  let route: ResolvedSourceRoute | undefined;
  const warnings: string[] = [];

  if (normalizedRequest.intent) {
    try {
      route = resolveSourceRoute(controlPlane, {
        profile: normalizedRequest.profile,
        intent: normalizedRequest.intent,
        freshness: normalizedRequest.freshness,
        now: normalizedRequest.now
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(message);
    }
  }

  const profile = inspectProfile(controlPlane, normalizedRequest.profile);

  return {
    allowed: decision.effect === 'allow',
    approvalRequired: decision.effect === 'approval_required',
    decision,
    route,
    routeExecutable: decision.effect === 'allow' && Boolean(route),
    guardrails: route?.guardrails ?? profile.guardrails,
    warnings,
    dryRun: Boolean(normalizedRequest.dryRun)
  };
}

function normalizePreflightRequest(request: PreflightRequest): PreflightRequest {
  const normalizedPolicy = normalizePolicyRequest(request);
  const record = requireRecord(request, 'Preflight request');
  const intent = record.intent === undefined
    ? undefined
    : requireNonEmptyString(record.intent, 'Preflight request intent', 'when provided');
  const dryRun = record.dryRun === undefined ? undefined : requireBoolean(record.dryRun, 'Preflight request dryRun');
  const freshness = normalizeFreshness(record.freshness);
  const now = record.now === undefined
    ? undefined
    : requireNonEmptyString(record.now, 'Preflight request now', 'when provided');

  return {
    ...normalizedPolicy,
    intent,
    dryRun,
    freshness,
    now
  };
}

function normalizeFreshness(value: unknown): PreflightRequest['freshness'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error('Preflight request freshness must be an array.');
  }
  return value.map((entry) => {
    const record = requireRecord(entry, 'Preflight freshness input');
    return {
      sourceId: requireNonEmptyString(record.sourceId, 'Preflight freshness sourceId'),
      lastUpdated: requireNonEmptyString(record.lastUpdated, 'Preflight freshness lastUpdated')
    };
  });
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
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
