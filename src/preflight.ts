import { evaluatePolicy, normalizePolicyRequest } from './policy-engine.js';
import { inspectProfile, resolveSourceRoute } from './route-resolver.js';
import { isSourceAvailable, listSourceHealth } from './health.js';
import { updatePreflightAnalyticsCache } from './analytics.js';
import { appendChange, appendEvidence } from './store.js';
import { agentProfiles, policyWriteActions, sourceRefs } from './config-access.js';
import type {
  ControlPlane,
  PolicyDecision,
  PreflightRequest,
  PreflightResult,
  ResolvedSourceRoute,
  SourceHealth,
  TamperMode
} from './types.js';

export function evaluatePreflight(
  controlPlane: ControlPlane,
  request: PreflightRequest,
  options: { health?: SourceHealth[] } = {}
): PreflightResult {
  let normalizedRequest: PreflightRequest;
  try {
    normalizedRequest = normalizePreflightRequest(request);
  } catch (error) {
    const fallback = fallbackPreflightRequest(request);
    const message = error instanceof Error ? error.message : String(error);
    const decision = denyDecision(
      fallback,
      'invalid-request',
      'invalid_request',
      `Invalid preflight request: ${message}`,
      'Pass non-empty profile and action strings before evaluating policy.'
    );
    if (fallback.dryRun) {
      return {
        allowed: false,
        decision,
        guardrails: [],
        warnings: [decision.reason],
        dryRun: true,
        wouldAllow: false
      };
    }
    return {
      allowed: false,
      decision,
      route: undefined,
      guardrails: [],
      warnings: [decision.reason],
      dryRun: false
    };
  }
  const decision = evaluatePolicy(controlPlane, normalizedRequest);
  let finalDecision: PolicyDecision = decision;
  let route: ResolvedSourceRoute | undefined;
  const warnings: string[] = [];

  if (normalizedRequest.intent) {
    try {
      route = resolveSourceRoute(controlPlane, {
        profile: normalizedRequest.profile,
        intent: normalizedRequest.intent,
        freshness: normalizedRequest.freshness,
        health: options.health
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

      if (decision.effect === 'allow' && route.sources.length === 0 && route.skippedSources.length > 0) {
        const reason = `All route sources are down: ${route.skippedSources.join(', ')}.`;
        warnings.push(reason);
        finalDecision = denyDecision(
          normalizedRequest,
          'all-sources-down',
          'all_sources_down',
          reason,
          'Wait for source recovery or reset source health after manual verification.'
        );
      }

      if (
        finalDecision.effect === 'allow'
        && normalizedRequest.tool
        && skippedSourcesIncludeTool(route.skippedSources, normalizedRequest.tool)
      ) {
        const reason = `Requested tool ${normalizedRequest.tool} is down.`;
        warnings.push(reason);
        finalDecision = denyDecision(
          normalizedRequest,
          'requested-tool-down',
          'requested_tool_down',
          reason,
          'Use one of the returned route fallback sources instead of the down requested tool.'
        );
      }

      if (finalDecision.effect === 'allow' && isWriteAction(controlPlane, route, normalizedRequest.action)) {
        const readOnlySourceIds = route.sources.filter((source) => source.readOnly).map((source) => source.id);
        const readOnlySource = normalizedRequest.tool && readOnlySourceIds.includes(normalizedRequest.tool)
          ? route.sources.find((source) => source.id === normalizedRequest.tool)
          : undefined;
        if (readOnlySource) {
          const reason = `Source ${readOnlySource.id} is read-only and the action ${normalizedRequest.action} is a write operation.`;
          warnings.push(reason);
          finalDecision = denyDecision(
            normalizedRequest,
            'read-only-source-write-blocked',
            'read_only_source_write_blocked',
            reason,
            'Use a read-write source for write operations.'
          );
        } else if (readOnlySourceIds.length > 0) {
          route = {
            ...route,
            sources: route.sources.filter((source) => !source.readOnly),
            skippedSources: [...new Set([...route.skippedSources, ...readOnlySourceIds])]
          };
          if (route.sources.length === 0) {
            const reason = `All route sources are read-only for write action ${normalizedRequest.action}: ${readOnlySourceIds.join(', ')}.`;
            warnings.push(reason);
            finalDecision = denyDecision(
              normalizedRequest,
              'read-only-route-write-blocked',
              'read_only_route_write_blocked',
              reason,
              'Use a route with at least one read-write source for write operations.'
            );
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = `Route resolution failed: ${message}`;
      warnings.push(reason);
      if (decision.effect === 'allow') {
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

  if (
    finalDecision.effect === 'allow'
    && !route
    && normalizedRequest.tool
    && isPolicyWriteAction(controlPlane, normalizedRequest.action)
  ) {
    const readOnlySource = sourceRefs(controlPlane).find((source) => source.id === normalizedRequest.tool && source.readOnly);
    if (readOnlySource) {
      const reason = `Source ${readOnlySource.id} is read-only and the action ${normalizedRequest.action} is a write operation.`;
      warnings.push(reason);
      finalDecision = denyDecision(
        normalizedRequest,
        'read-only-source-write-blocked',
        'read_only_source_write_blocked',
        reason,
        'Use a read-write source for write operations.'
      );
    }
  }

  let profileGuardrails: string[] = [];
  try {
    profileGuardrails = inspectProfile(controlPlane, normalizedRequest.profile).guardrails;
  } catch {
    profileGuardrails = [];
  }

  const allowed = finalDecision.effect === 'allow';
  const base = {
    allowed,
    decision: finalDecision,
    guardrails: route?.guardrails ?? profileGuardrails,
    warnings
  };

  if (normalizedRequest.dryRun) {
    return {
      ...base,
      ...(allowed && route ? { route } : {}),
      dryRun: true,
      wouldAllow: allowed
    };
  }

  if (allowed) {
    return {
      ...base,
      route: route ?? emptyRoute(normalizedRequest, profileGuardrails),
      allowed: true,
      dryRun: false
    };
  }

  return {
    ...base,
    allowed: false,
    route: undefined,
    dryRun: false
  };
}

export async function preflight(
  controlPlane: ControlPlane,
  storeDir: string,
  request: PreflightRequest,
  options: { tamperMode?: TamperMode } = {}
): Promise<PreflightResult> {
  const tamperMode = options.tamperMode ?? 'warn';
  try {
    const availabilityEntries = await Promise.all(safeSourceRefs(controlPlane).map(async (source) => [
      source.id,
      await isSourceAvailable(controlPlane, storeDir, source.id, tamperMode)
    ] as const));
    const availability = new Map(availabilityEntries);
    const health = (await safeListSourceHealth(controlPlane, storeDir, tamperMode)).map((entry) => {
      const available = availability.get(entry.sourceId);
      if (available === false) return { ...entry, status: 'down' as const };
      if (available === true && entry.status === 'half-open') return { ...entry, probeInFlight: false };
      return entry;
    });
    const result = evaluatePreflight(controlPlane, request, { health });

    if (result.dryRun) {
      return result;
    }

    await auditPreflightResult(controlPlane, storeDir, request, result);

    try {
      await updatePreflightAnalyticsCache(controlPlane, storeDir, result, tamperMode);
    } catch {
      // Analytics are advisory; policy decisions must not throw after evaluation.
    }

    return result;
  } catch (error) {
    const result = preflightErrorResult(request, error);
    try {
      await auditPreflightResult(controlPlane, storeDir, request, result);
    } catch (auditError) {
      const message = auditError instanceof Error ? auditError.message : String(auditError);
      result.warnings.push(`Audit write failed for preflight-error deny: ${message}`);
    }
    return result;
  }
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

function fallbackPreflightRequest(request: unknown): PreflightRequest {
  const record = request && typeof request === 'object' && !Array.isArray(request)
    ? request as Record<string, unknown>
    : {};
  return {
    profile: typeof record.profile === 'string' && record.profile.trim() ? record.profile : 'unknown-profile',
    action: typeof record.action === 'string' && record.action.trim() ? record.action : 'unknown-action',
    tool: typeof record.tool === 'string' && record.tool.trim() ? record.tool : undefined,
    intent: typeof record.intent === 'string' && record.intent.trim() ? record.intent : undefined,
    dryRun: record.dryRun === true
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

function estimateCost(controlPlane: ControlPlane, result: PreflightResult): number {
  const sourceId = result.decision.tool ?? result.route?.sources[0]?.id;
  if (!sourceId) return 0;
  try {
    return safeSourceRefs(controlPlane).find((source) => source.id === sourceId)?.costPerCall ?? 0;
  } catch {
    return 0;
  }
}

async function auditPreflightResult(
  controlPlane: ControlPlane,
  storeDir: string,
  request: unknown,
  result: PreflightResult
): Promise<void> {
  if (!result.allowed) {
    const intent = request && typeof request === 'object' && !Array.isArray(request)
      ? (request as { intent?: string }).intent
      : undefined;
    await appendEvidence(storeDir, {
      profile: result.decision.profile,
      source: 'agent-cmdb-preflight',
      intent: intent ?? result.decision.action,
      summary: `Denied by ${result.decision.ruleId}: ${result.decision.reason}`,
      trust: 'high',
      capturedAt: new Date().toISOString(),
      estimatedCost: estimateCost(controlPlane, result),
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
}

function safeSourceRefs(controlPlane: ControlPlane) {
  try {
    const sources = sourceRefs(controlPlane);
    return Array.isArray(sources) ? sources : [];
  } catch {
    return [];
  }
}

async function safeListSourceHealth(controlPlane: ControlPlane, storeDir: string, tamperMode: TamperMode): Promise<SourceHealth[]> {
  try {
    return await listSourceHealth(controlPlane, storeDir, tamperMode);
  } catch {
    return [];
  }
}

function preflightErrorResult(request: unknown, error: unknown): PreflightResult {
  const fallback = fallbackPreflightRequest(request);
  const message = error instanceof Error ? error.message : String(error);
  const decision = denyDecision(
    fallback,
    'preflight-error',
    'preflight_error',
    `Preflight failed safely: ${message}`,
    'Fix the policy library or request before retrying.'
  );
  return {
    allowed: false,
    decision,
    route: undefined,
    guardrails: [],
    warnings: [decision.reason],
    dryRun: false
  };
}

function skippedSourcesIncludeTool(skippedSources: string[], tool: string): boolean {
  return skippedSources.includes(tool) || skippedSources.includes(`source.${tool}`) || skippedSources.includes(`tool.${tool}`);
}

function isWriteAction(controlPlane: ControlPlane, route: ResolvedSourceRoute, action: string): boolean {
  const writeActions = routeWriteActions(controlPlane, route);
  return writeActions.some((writeAction) => action === writeAction || action.includes(writeAction));
}

function isPolicyWriteAction(controlPlane: ControlPlane, action: string): boolean {
  return configuredWriteActions(controlPlane).some((writeAction) => action === writeAction || action.includes(writeAction));
}

function routeWriteActions(controlPlane: ControlPlane, route: ResolvedSourceRoute): string[] {
  const profile = agentProfiles(controlPlane).find((candidate) => candidate.id === route.profile);
  const sourceRoute = profile?.routes.find((candidate) => candidate.intent === route.intent);
  return sourceRoute?.writeActions ?? configuredWriteActions(controlPlane);
}

function configuredWriteActions(controlPlane: ControlPlane): string[] {
  return policyWriteActions(controlPlane) ?? [
    'create',
    'update',
    'delete',
    'write',
    'post',
    'publish',
    'send',
    'modify',
    'remove',
    'edit'
  ];
}

function emptyRoute(request: PreflightRequest, guardrails: string[]): ResolvedSourceRoute {
  return {
    profile: request.profile,
    intent: request.intent ?? request.action,
    sources: [],
    skippedSources: [],
    guardrails,
    blockOnStale: false,
    staleSourceIds: [],
    freshness: []
  };
}
