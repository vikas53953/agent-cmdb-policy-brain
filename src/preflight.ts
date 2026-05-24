import { evaluatePolicy, normalizePolicyRequest } from './policy-engine.js';
import { inspectProfile, resolveSourceRoute } from './route-resolver.js';
import { appendChange, appendEvidence } from './store.js';
import type {
  ControlPlane,
  PolicyDecision,
  PreflightRequest,
  PreflightResult,
  ResolvedSourceRoute
} from './types.js';

export function evaluatePreflight(controlPlane: ControlPlane, request: PreflightRequest): PreflightResult {
  const normalizedRequest = normalizePreflightRequest(request);
  const decision = evaluatePolicy(controlPlane, normalizedRequest);
  let finalDecision: PolicyDecision = decision;
  let route: ResolvedSourceRoute | undefined;
  const warnings: string[] = [];

  if (normalizedRequest.intent) {
    try {
      route = resolveSourceRoute(controlPlane, {
        profile: normalizedRequest.profile,
        intent: normalizedRequest.intent,
        freshness: normalizedRequest.freshness
      });

      if (decision.effect === 'allow' && route.blockOnStale && route.staleSourceIds.length > 0) {
        const reason = `Route contains stale sources and blockOnStale is enabled: ${route.staleSourceIds.join(', ')}.`;
        warnings.push(reason);
        finalDecision = denyDecision(
          normalizedRequest,
          'stale-source-blocked',
          'stale_source_blocked',
          reason,
          'Refresh the source freshness snapshots or choose a fresh route.'
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = `Route resolution failed: ${message}`;
      warnings.push(reason);
      if (decision.effect === 'allow' || decision.effect === 'approval_required') {
        finalDecision = denyDecision(
          normalizedRequest,
          'route-resolution-failed',
          'route_resolution_failed',
          reason,
          'Fix the source route for this profile and intent before executing.'
        );
      }
    }
  }

  const profile = inspectProfile(controlPlane, normalizedRequest.profile);

  return {
    allowed: finalDecision.effect === 'allow',
    approvalRequired: finalDecision.effect === 'approval_required',
    decision: finalDecision,
    route,
    routeExecutable: finalDecision.effect === 'allow' && Boolean(route),
    guardrails: route?.guardrails ?? profile.guardrails,
    warnings,
    dryRun: Boolean(normalizedRequest.dryRun)
  };
}

export async function preflight(
  controlPlane: ControlPlane,
  storeDir: string,
  request: PreflightRequest
): Promise<PreflightResult> {
  const result = evaluatePreflight(controlPlane, request);

  if (result.dryRun) {
    return result;
  }

  if (!result.allowed) {
    await appendEvidence(storeDir, {
      profile: result.decision.profile,
      source: 'agent-cmdb-preflight',
      intent: request.intent ?? result.decision.action,
      summary: `Denied by ${result.decision.ruleId}: ${result.decision.reason}`,
      trust: 'high',
      capturedAt: new Date().toISOString(),
      tags: ['preflight', 'deny', result.decision.ruleId]
    });
  }

  await appendChange(storeDir, {
    target: `policy.${result.decision.ruleId}`,
    targetType: 'policy',
    action: 'verify',
    actor: 'agent-cmdb-preflight',
    reason: `Preflight ${result.decision.effect} for ${result.decision.profile}:${result.decision.action}.`,
    changedAt: new Date().toISOString(),
    after: result
  });

  return result;
}

function normalizePreflightRequest(request: PreflightRequest): PreflightRequest {
  const normalizedPolicy = normalizePolicyRequest(request);
  const record = requireRecord(request, 'Preflight request');
  const intent = record.intent === undefined
    ? undefined
    : requireNonEmptyString(record.intent, 'Preflight request intent', 'when provided');
  const dryRun = record.dryRun === undefined ? undefined : requireBoolean(record.dryRun, 'Preflight request dryRun');
  const freshness = normalizeFreshness(record.freshness);

  return {
    ...normalizedPolicy,
    intent,
    dryRun,
    freshness
  };
}

function denyDecision(
  request: PreflightRequest,
  ruleId: string,
  code: string,
  reason: string,
  suggestedAlternative: string
): PolicyDecision {
  return {
    effect: 'deny',
    ruleId,
    code,
    reason,
    profile: request.profile,
    action: request.action,
    tool: request.tool,
    canEscalate: false,
    suggestedAlternative
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
