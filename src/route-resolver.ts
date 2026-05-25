import { parseDuration } from './duration.js';
import { agentProfiles, sourceRefs } from './config-access.js';
import type {
  AgentProfile,
  ControlPlane,
  ProfileInspection,
  ResolvedSourceRoute,
  SourceFreshnessInput,
  SourceFreshnessStatus,
  SourceHealth,
  SourceRef,
  SourceRouteRequest
} from './types.js';

export function resolveSourceRoute(
  controlPlane: ControlPlane,
  request: SourceRouteRequest
): ResolvedSourceRoute {
  const normalizedRequest = normalizeSourceRouteRequest(request);
  const profile = ensureProfile(controlPlane, normalizedRequest.profile);
  const route = profile.routes.find((candidate) => candidate.intent === normalizedRequest.intent);

  if (!route) {
    throw new Error(
      `No source route configured for profile ${normalizedRequest.profile} and intent ${normalizedRequest.intent}.`
    );
  }

  const healthBySource = new Map((normalizedRequest.health ?? []).map((health) => [health.sourceId, health]));
  const routeSources = route.sources.map((sourceId) => ensureSource(controlPlane, sourceId));
  const sources = routeSources.filter((source) => routeSourceAvailable(healthBySource.get(source.id)));
  const skippedSources = routeSources
    .filter((source) => !routeSourceAvailable(healthBySource.get(source.id)))
    .map((source) => source.id);

  return {
    profile: profile.id,
    intent: normalizedRequest.intent,
    sources,
    skippedSources,
    guardrails: profile.guardrails,
    notes: route.notes,
    blockOnStale: Boolean(route.blockOnStale),
    ...resolveFreshness(
      sources,
      normalizedRequest.freshness
    )
  };
}

function routeSourceAvailable(health: SourceHealth | undefined): boolean {
  if (!health) return true;
  if (health.status === 'down') return false;
  if (health.status === 'half-open' && health.probeInFlight) return false;
  return true;
}

export function inspectProfile(controlPlane: ControlPlane, profileId: string): ProfileInspection {
  const profile = ensureProfile(controlPlane, requireNonEmptyString(profileId, 'Profile id'));

  return {
    id: profile.id,
    name: profile.name,
    purpose: profile.purpose,
    guardrails: [...profile.guardrails],
    routes: profile.routes.map((route) => ({
      intent: route.intent,
      sources: [...route.sources],
      notes: route.notes,
      blockOnStale: route.blockOnStale
    }))
  };
}

export function ensureProfile(controlPlane: ControlPlane, profileId: string): AgentProfile {
  const profile = agentProfiles(controlPlane).find((candidate) => candidate.id === profileId);
  if (!profile) {
    throw new Error(`Unknown profile: ${profileId}.`);
  }
  return profile;
}

export function ensureSource(controlPlane: ControlPlane, sourceId: string): SourceRef {
  const source = sourceRefs(controlPlane).find((candidate) => candidate.id === sourceId);
  if (!source) {
    throw new Error(`Unknown source referenced by route: ${sourceId}.`);
  }
  return source;
}

function normalizeSourceRouteRequest(request: SourceRouteRequest): SourceRouteRequest {
  const record = requireRecord(request, 'Source route request');

  return {
    profile: requireNonEmptyString(record.profile, 'Source route request profile'),
    intent: requireNonEmptyString(record.intent, 'Source route request intent'),
    freshness: normalizeFreshness(record.freshness),
    health: normalizeHealth(record.health)
  };
}

function normalizeHealth(value: unknown): SourceRouteRequest['health'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error('Source route request health must be an array.');
  }
  return value.map((entry) => {
    const record = requireRecord(entry, 'Source health input');
    const status = requireNonEmptyString(record.status, 'Source health status');
    if (!['up', 'down', 'half-open'].includes(status)) {
      throw new Error(`Source health status must be one of: up, down, half-open.`);
    }
    return {
      sourceId: requireNonEmptyString(record.sourceId, 'Source health sourceId'),
      status: status as 'up' | 'down' | 'half-open',
      failures: Array.isArray(record.failures)
        ? record.failures.map((failure) => {
          const failureRecord = requireRecord(failure, 'Source health failure');
          return {
            timestamp: requireNonEmptyString(failureRecord.timestamp, 'Source health failure timestamp'),
            reason: failureRecord.reason === undefined
              ? undefined
              : requireNonEmptyString(failureRecord.reason, 'Source health failure reason')
          };
        })
        : [],
      failureWindowMs: record.failureWindowMs === undefined
        ? 60_000
        : readNonNegativeNumber(record.failureWindowMs, 'Source health failureWindowMs'),
      failureThreshold: record.failureThreshold === undefined
        ? 5
        : readNonNegativeNumber(record.failureThreshold, 'Source health failureThreshold'),
      recoveryTimeoutMs: record.recoveryTimeoutMs === undefined
        ? 30_000
        : readNonNegativeNumber(record.recoveryTimeoutMs, 'Source health recoveryTimeoutMs'),
      probeInFlight: record.probeInFlight === true,
      recoveryAttempts: record.recoveryAttempts === undefined
        ? 0
        : readNonNegativeNumber(record.recoveryAttempts, 'Source health recoveryAttempts'),
      lastChecked: requireNonEmptyString(record.lastChecked, 'Source health lastChecked'),
      lastFailure: record.lastFailure === undefined
        ? undefined
        : requireNonEmptyString(record.lastFailure, 'Source health lastFailure'),
      lastSuccess: record.lastSuccess === undefined
        ? undefined
        : requireNonEmptyString(record.lastSuccess, 'Source health lastSuccess')
    };
  });
}

function resolveFreshness(
  sources: SourceRef[],
  freshness: SourceFreshnessInput[] | undefined
): Pick<ResolvedSourceRoute, 'staleSourceIds' | 'freshness'> {
  if (!freshness || freshness.length === 0) {
    return {
      staleSourceIds: [],
      freshness: []
    };
  }

  const bySource = new Map(freshness.map((entry) => [entry.sourceId, entry]));
  const now = Date.now();
  const statuses: SourceFreshnessStatus[] = sources
    .filter((source) => source.freshnessTtl)
    .map((source) => {
      const ttl = source.freshnessTtl;
      if (!ttl) {
        throw new Error(`Source ${source.id} has missing freshness TTL.`);
      }
      const snapshot = bySource.get(source.id);
      if (!snapshot) {
        return {
          sourceId: source.id,
          ttl,
          stale: true,
          reason: 'No freshness snapshot supplied.'
        };
      }
      const lastUpdatedMs = parseTimestamp(snapshot.lastUpdated, `Freshness lastUpdated for ${source.id}`);
      const ageMs = Math.max(0, now - lastUpdatedMs);
      const stale = ageMs > parseDuration(ttl);

      return {
        sourceId: source.id,
        ttl,
        lastUpdated: snapshot.lastUpdated,
        ageMs,
        stale,
        reason: stale ? `Source ${source.id} is older than ${ttl}.` : undefined
      };
    });

  return {
    staleSourceIds: statuses.filter((status) => status.stale).map((status) => status.sourceId),
    freshness: statuses
  };
}

function normalizeFreshness(value: unknown): SourceFreshnessInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error('Source route request freshness must be an array.');
  }
  return value.map((entry) => {
    const record = requireRecord(entry, 'Source freshness input');
    return {
      sourceId: requireNonEmptyString(record.sourceId, 'Source freshness sourceId'),
      lastUpdated: requireNonEmptyString(record.lastUpdated, 'Source freshness lastUpdated')
    };
  });
}

function parseTimestamp(value: string, label: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return timestamp;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function readNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}
