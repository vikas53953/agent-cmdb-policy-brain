import { ensureGraphNode } from './graph-engine.js';
import { policiesConflict, policyShadows } from './policy-engine.js';
import type {
  AgentCmdbReport,
  CmdbObject,
  ControlPlane,
  ObjectQuery,
  ValidationIssue
} from './types.js';

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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}
