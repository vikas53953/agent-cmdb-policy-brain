import type { AgentProfile, ControlPlane, ProfileInspection, ResolvedSourceRoute, SourceRef, SourceRouteRequest } from './types.js';

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

  return {
    profile: profile.id,
    intent: normalizedRequest.intent,
    sources: route.sources.map((sourceId) => ensureSource(controlPlane, sourceId)),
    guardrails: profile.guardrails,
    notes: route.notes
  };
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
      notes: route.notes
    }))
  };
}

export function ensureProfile(controlPlane: ControlPlane, profileId: string): AgentProfile {
  const profile = controlPlane.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) {
    throw new Error(`Unknown profile: ${profileId}.`);
  }
  return profile;
}

export function ensureSource(controlPlane: ControlPlane, sourceId: string): SourceRef {
  const source = controlPlane.sources.find((candidate) => candidate.id === sourceId);
  if (!source) {
    throw new Error(`Unknown source referenced by route: ${sourceId}.`);
  }
  return source;
}

function normalizeSourceRouteRequest(request: SourceRouteRequest): SourceRouteRequest {
  const record = requireRecord(request, 'Source route request');

  return {
    profile: requireNonEmptyString(record.profile, 'Source route request profile'),
    intent: requireNonEmptyString(record.intent, 'Source route request intent')
  };
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
