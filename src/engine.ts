import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgentProfile,
  AgentCmdbReport,
  ControlPlane,
  CmdbObject,
  GraphResult,
  ObjectQuery,
  PolicyEffect,
  PolicyDecision,
  PolicyRequest,
  PolicyRule,
  PreflightRequest,
  PreflightResult,
  ProfileInspection,
  Relationship,
  ResolvedSourceRoute,
  SourceRef,
  SourceRouteRequest,
  ValidationIssue
} from './types.js';

const effectRank: Record<PolicyEffect, number> = {
  deny: 3,
  approval_required: 2,
  allow: 1
};

const moduleDir = dirname(fileURLToPath(import.meta.url));

export const defaultControlPlanePath = resolve(moduleDir, '..', 'data', 'hermes-v2.json');

export class ControlPlaneLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ControlPlaneLoadError';
  }
}

export function loadControlPlane(filePath: string): ControlPlane {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ControlPlaneLoadError(`Failed to parse control plane JSON at ${filePath}: ${detail}`);
  }

  const controlPlane = parseControlPlane(parsed);
  const errors = validateControlPlane(controlPlane).filter((issue) => issue.severity === 'error');

  if (errors.length > 0) {
    const detail = errors.map((issue) => `${issue.code}: ${issue.message}`).join('; ');
    throw new ControlPlaneLoadError(`Control plane validation failed: ${detail}`);
  }

  return controlPlane;
}

export function loadDefaultControlPlane(): ControlPlane {
  return loadControlPlane(defaultControlPlanePath);
}

export const hermesV1ControlPlane = loadDefaultControlPlane();

export function evaluatePolicy(controlPlane: ControlPlane, request: PolicyRequest): PolicyDecision {
  const normalizedRequest = normalizePolicyRequest(request);
  ensureProfile(controlPlane, normalizedRequest.profile);

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

export function listObjects(controlPlane: ControlPlane, query: ObjectQuery = {}): CmdbObject[] {
  return controlPlane.objects.filter((object) => {
    if (query.profile && object.profile && object.profile !== query.profile) return false;
    if (query.profile && !object.profile && object.kind !== 'profile') return false;
    if (query.kind && object.kind !== query.kind) return false;
    if (query.status && object.status !== query.status) return false;
    if (query.tag && !object.tags.includes(query.tag)) return false;
    return true;
  });
}

export function getObject(controlPlane: ControlPlane, objectId: string): CmdbObject {
  const normalizedObjectId = requireNonEmptyString(objectId, 'CMDB object id');
  const object = controlPlane.objects.find((candidate) => candidate.id === normalizedObjectId);
  if (!object) {
    throw new Error(`Unknown CMDB object: ${normalizedObjectId}.`);
  }
  return object;
}

export function resolveGraphNeighbors(controlPlane: ControlPlane, nodeId: string): GraphResult {
  const normalizedNodeId = requireNonEmptyString(nodeId, 'Graph node id');
  const node = ensureGraphNode(controlPlane, normalizedNodeId);
  const neighbors = controlPlane.relationships
    .filter((relationship) => relationship.from === normalizedNodeId || relationship.to === normalizedNodeId)
    .map((relationship) => {
      const otherId = relationship.from === normalizedNodeId ? relationship.to : relationship.from;
      return {
        relationship,
        node: ensureGraphNode(controlPlane, otherId)
      };
    });

  return { node, neighbors };
}

export function validateControlPlane(controlPlane: ControlPlane): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sourceIds = new Set(controlPlane.sources.map((source) => source.id));
  const profileIds = new Set(controlPlane.profiles.map((profile) => profile.id));
  const policyIds = new Set<string>();

  for (const profile of controlPlane.profiles) {
    for (const route of profile.routes) {
      for (const sourceId of route.sources) {
        if (!sourceIds.has(sourceId)) {
          issues.push({
            severity: 'error',
            code: 'route_unknown_source',
            message: `Route ${profile.id}/${route.intent} references unknown source ${sourceId}.`
          });
        }
      }
    }
  }

  for (const policy of controlPlane.policies) {
    if (policyIds.has(policy.id)) {
      issues.push({
        severity: 'error',
        code: 'duplicate_policy_id',
        message: `Duplicate policy id ${policy.id}.`
      });
    }
    policyIds.add(policy.id);

    for (const profileId of policy.profiles ?? []) {
      if (profileId !== '*' && !profileIds.has(profileId)) {
        issues.push({
          severity: 'error',
          code: 'policy_unknown_profile',
          message: `Policy ${policy.id} references unknown profile ${profileId}.`
        });
      }
    }

    for (const toolId of policy.tools ?? []) {
      if (toolId !== '*' && !sourceIds.has(toolId)) {
        issues.push({
          severity: 'error',
          code: 'policy_unknown_tool',
          message: `Policy ${policy.id} references unknown tool ${toolId}.`
        });
      }
    }
  }

  for (let index = 1; index < controlPlane.policies.length; index += 1) {
    const policy = controlPlane.policies[index];
    const shadowingPolicy = controlPlane.policies
      .slice(0, index)
      .find((candidate) => policyShadows(candidate, policy));

    if (shadowingPolicy) {
      issues.push({
        severity: 'warning',
        code: 'policy_shadowed',
        message: `Policy ${policy.id} is shadowed by earlier policy ${shadowingPolicy.id}.`
      });
    }
  }

  for (let leftIndex = 0; leftIndex < controlPlane.policies.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < controlPlane.policies.length; rightIndex += 1) {
      const left = controlPlane.policies[leftIndex];
      const right = controlPlane.policies[rightIndex];
      if (policiesConflict(left, right)) {
        issues.push({
          severity: 'warning',
          code: 'policy_conflict',
          message: `Policy ${left.id} conflicts with policy ${right.id}; deny will win for overlapping requests.`
        });
      }
    }
  }

  for (const relationship of controlPlane.relationships) {
    for (const endpoint of [relationship.from, relationship.to]) {
      try {
        ensureGraphNode(controlPlane, endpoint);
      } catch {
        issues.push({
          severity: 'error',
          code: 'relationship_unknown_node',
          message: `Relationship ${relationship.from} -> ${relationship.to} references unknown node ${endpoint}.`
        });
      }
    }
  }

  return issues;
}

export function preflightAction(controlPlane: ControlPlane, request: PreflightRequest): PreflightResult {
  const normalizedRequest = normalizePreflightRequest(request);
  const decision = evaluatePolicy(controlPlane, normalizedRequest);
  let route: ResolvedSourceRoute | undefined;
  const warnings: string[] = [];

  if (normalizedRequest.intent) {
    try {
      route = resolveSourceRoute(controlPlane, {
        profile: normalizedRequest.profile,
        intent: normalizedRequest.intent
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
    warnings
  };
}

export function generateReadinessReport(controlPlane: ControlPlane): AgentCmdbReport {
  const issues = validateControlPlane(controlPlane);
  const deniedActions = unique(
    controlPlane.policies
      .filter((policy) => policy.effect === 'deny')
      .flatMap((policy) => policy.actions)
  );

  return {
    version: controlPlane.version,
    updatedAt: controlPlane.updatedAt,
    counts: {
      profiles: controlPlane.profiles.length,
      sources: controlPlane.sources.length,
      policies: controlPlane.policies.length,
      objects: controlPlane.objects.length,
      relationships: controlPlane.relationships.length
    },
    guardrails: {
      deniedActions,
      pausedObjects: controlPlane.objects.filter((object) => object.status === 'paused').map((object) => object.id),
      blockedObjects: controlPlane.objects.filter((object) => object.status === 'blocked').map((object) => object.id)
    },
    validation: {
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
      issues
    }
  };
}

function parseControlPlane(value: unknown): ControlPlane {
  const root = requireRecord(value, 'Control plane');

  return {
    version: readString(root, 'version', 'Control plane version'),
    updatedAt: readString(root, 'updatedAt', 'Control plane updatedAt'),
    sources: readArray(root, 'sources', 'Control plane sources').map(parseSourceRef),
    profiles: readArray(root, 'profiles', 'Control plane profiles').map(parseAgentProfile),
    policies: readArray(root, 'policies', 'Control plane policies').map(parsePolicyRule),
    objects: readArray(root, 'objects', 'Control plane objects').map(parseCmdbObject),
    relationships: readArray(root, 'relationships', 'Control plane relationships').map(parseRelationship)
  };
}

function parseSourceRef(value: unknown): SourceRef {
  const record = requireRecord(value, 'Source');
  const kind = readString(record, 'kind', 'Source kind');
  if (!['memory', 'tool', 'oauth', 'wiki', 'web', 'evidence'].includes(kind)) {
    throw new ControlPlaneLoadError(`Source kind has invalid value ${kind}.`);
  }

  return {
    id: readString(record, 'id', 'Source id'),
    label: readString(record, 'label', 'Source label'),
    kind: kind as SourceRef['kind'],
    readOnly: readBoolean(record, 'readOnly', 'Source readOnly'),
    notes: optionalString(record, 'notes')
  };
}

function parseAgentProfile(value: unknown): AgentProfile {
  const record = requireRecord(value, 'Profile');

  return {
    id: readString(record, 'id', 'Profile id'),
    name: readString(record, 'name', 'Profile name'),
    purpose: readString(record, 'purpose', 'Profile purpose'),
    guardrails: readStringArray(record, 'guardrails', 'Profile guardrails'),
    routes: readArray(record, 'routes', 'Profile routes').map(parseSourceRoute)
  };
}

function parseSourceRoute(value: unknown): AgentProfile['routes'][number] {
  const record = requireRecord(value, 'Source route');

  return {
    intent: readString(record, 'intent', 'Source route intent'),
    sources: readStringArray(record, 'sources', 'Source route sources'),
    notes: optionalString(record, 'notes')
  };
}

function parsePolicyRule(value: unknown): PolicyRule {
  const record = requireRecord(value, 'Policy');
  const effect = readString(record, 'effect', 'Policy effect');
  if (!['allow', 'deny', 'approval_required'].includes(effect)) {
    throw new ControlPlaneLoadError(`Policy effect has invalid value ${effect}.`);
  }

  return {
    id: readString(record, 'id', 'Policy id'),
    effect: effect as PolicyEffect,
    actions: readStringArray(record, 'actions', 'Policy actions'),
    profiles: optionalStringArray(record, 'profiles', 'Policy profiles'),
    tools: optionalStringArray(record, 'tools', 'Policy tools'),
    reason: readString(record, 'reason', 'Policy reason'),
    code: optionalString(record, 'code'),
    canEscalate: optionalBoolean(record, 'canEscalate'),
    suggestedAlternative: optionalString(record, 'suggestedAlternative')
  };
}

function parseCmdbObject(value: unknown): CmdbObject {
  const record = requireRecord(value, 'CMDB object');
  const kind = readString(record, 'kind', 'CMDB object kind');
  const status = readString(record, 'status', 'CMDB object status');
  if (!['profile', 'source', 'tool', 'job', 'memory', 'policy', 'workspace'].includes(kind)) {
    throw new ControlPlaneLoadError(`CMDB object kind has invalid value ${kind}.`);
  }
  if (!['active', 'paused', 'blocked', 'planned'].includes(status)) {
    throw new ControlPlaneLoadError(`CMDB object status has invalid value ${status}.`);
  }

  return {
    id: readString(record, 'id', 'CMDB object id'),
    kind: kind as CmdbObject['kind'],
    label: readString(record, 'label', 'CMDB object label'),
    status: status as CmdbObject['status'],
    profile: optionalString(record, 'profile'),
    tags: readStringArray(record, 'tags', 'CMDB object tags'),
    dependsOn: optionalStringArray(record, 'dependsOn', 'CMDB object dependsOn'),
    notes: optionalString(record, 'notes')
  };
}

function parseRelationship(value: unknown): Relationship {
  const record = requireRecord(value, 'Relationship');
  const type = readString(record, 'type', 'Relationship type');
  if (!['uses', 'owns', 'governed_by', 'depends_on', 'blocks', 'writes_to'].includes(type)) {
    throw new ControlPlaneLoadError(`Relationship type has invalid value ${type}.`);
  }

  return {
    from: readString(record, 'from', 'Relationship from'),
    to: readString(record, 'to', 'Relationship to'),
    type: type as Relationship['type'],
    notes: optionalString(record, 'notes')
  };
}

function normalizePolicyRequest(request: PolicyRequest): PolicyRequest {
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

function normalizeSourceRouteRequest(request: SourceRouteRequest): SourceRouteRequest {
  const record = requireRecord(request, 'Source route request');

  return {
    profile: requireNonEmptyString(record.profile, 'Source route request profile'),
    intent: requireNonEmptyString(record.intent, 'Source route request intent')
  };
}

function normalizePreflightRequest(request: PreflightRequest): PreflightRequest {
  const normalizedPolicy = normalizePolicyRequest(request);
  const record = requireRecord(request, 'Preflight request');
  const intent = record.intent === undefined
    ? undefined
    : requireNonEmptyString(record.intent, 'Preflight request intent', 'when provided');

  return {
    ...normalizedPolicy,
    intent
  };
}

function policyMatches(rule: PolicyRule, request: PolicyRequest): boolean {
  if (!matchesList(rule.actions, request.action)) return false;
  if (rule.profiles && !matchesList(rule.profiles, request.profile)) return false;
  if (rule.tools && !request.tool) return rule.tools.includes('*');
  if (rule.tools && request.tool && !matchesList(rule.tools, request.tool)) return false;
  return true;
}

function matchesList(values: string[], candidate: string): boolean {
  return values.includes('*') || values.includes(candidate);
}

function ensureProfile(controlPlane: ControlPlane, profileId: string): AgentProfile {
  const profile = controlPlane.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) {
    throw new Error(`Unknown profile: ${profileId}.`);
  }
  return profile;
}

function ensureSource(controlPlane: ControlPlane, sourceId: string): SourceRef {
  const source = controlPlane.sources.find((candidate) => candidate.id === sourceId);
  if (!source) {
    throw new Error(`Unknown source referenced by route: ${sourceId}.`);
  }
  return source;
}

function ensureGraphNode(controlPlane: ControlPlane, nodeId: string): CmdbObject | SourceRef | AgentProfile | PolicyRule {
  const object = controlPlane.objects.find((candidate) => candidate.id === nodeId);
  if (object) return object;

  const source = controlPlane.sources.find((candidate) => candidate.id === nodeId || `source.${candidate.id}` === nodeId);
  if (source) return source;

  const profile = controlPlane.profiles.find((candidate) => candidate.id === nodeId || `profile.${candidate.id}` === nodeId);
  if (profile) return profile;

  const policy = controlPlane.policies.find((candidate) => candidate.id === nodeId || `policy.${candidate.id}` === nodeId);
  if (policy) return policy;

  throw new Error(`Unknown graph node: ${nodeId}.`);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function policyShadows(candidate: PolicyRule, policy: PolicyRule): boolean {
  if (candidate.effect !== policy.effect) return false;
  return listCovers(candidate.actions, policy.actions)
    && optionalListCovers(candidate.profiles, policy.profiles)
    && optionalListCovers(candidate.tools, policy.tools);
}

function policiesConflict(left: PolicyRule, right: PolicyRule): boolean {
  if (left.effect === right.effect) return false;
  if (left.effect !== 'deny' && right.effect !== 'deny') return false;
  return listOverlaps(left.actions, right.actions)
    && optionalListOverlaps(left.profiles, right.profiles)
    && optionalListOverlaps(left.tools, right.tools);
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

function readArray(record: Record<string, unknown>, key: string, label: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new ControlPlaneLoadError(`${label} must be an array.`);
  }
  return value;
}

function readStringArray(record: Record<string, unknown>, key: string, label: string): string[] {
  return readArray(record, key, label).map((value) => requireNonEmptyString(value, label));
}

function optionalStringArray(record: Record<string, unknown>, key: string, label: string): string[] | undefined {
  if (record[key] === undefined) return undefined;
  return readStringArray(record, key, label);
}

function readString(record: Record<string, unknown>, key: string, label: string): string {
  return requireNonEmptyString(record[key], label);
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  if (record[key] === undefined) return undefined;
  return requireNonEmptyString(record[key], key);
}

function readBoolean(record: Record<string, unknown>, key: string, label: string): boolean {
  if (typeof record[key] !== 'boolean') {
    throw new ControlPlaneLoadError(`${label} must be a boolean.`);
  }
  return record[key];
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  if (record[key] === undefined) return undefined;
  if (typeof record[key] !== 'boolean') {
    throw new ControlPlaneLoadError(`${key} must be a boolean.`);
  }
  return record[key];
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ControlPlaneLoadError(`${label} must be an object.`);
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
