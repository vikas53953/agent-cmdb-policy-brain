import { agentProfiles, policyRules, registryObjects, registryRelationships, sourceRefs } from './config-access.js';
import type { AgentProfile, CmdbObject, ControlPlane, GraphResult, PolicyRule, SourceRef } from './types.js';

export function resolveGraphNeighbors(controlPlane: ControlPlane, nodeId: string): GraphResult {
  const normalizedNodeId = requireNonEmptyString(nodeId, 'Graph node id');
  const node = ensureGraphNode(controlPlane, normalizedNodeId);
  const neighbors = registryRelationships(controlPlane)
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

export function ensureGraphNode(controlPlane: ControlPlane, nodeId: string): CmdbObject | SourceRef | AgentProfile | PolicyRule {
  const object = registryObjects(controlPlane).find((candidate) => candidate.id === nodeId);
  if (object) return object;

  const source = sourceRefs(controlPlane).find((candidate) => candidate.id === nodeId || `source.${candidate.id}` === nodeId);
  if (source) return source;

  const profile = agentProfiles(controlPlane).find((candidate) => candidate.id === nodeId || `profile.${candidate.id}` === nodeId);
  if (profile) return profile;

  const policy = policyRules(controlPlane).find((candidate) => candidate.id === nodeId || `policy.${candidate.id}` === nodeId);
  if (policy) return policy;

  throw new Error(`Unknown graph node: ${nodeId}.`);
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}
