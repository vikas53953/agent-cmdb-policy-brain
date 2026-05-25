import type { AgentProfile, CmdbObject, ControlPlane, PolicyRule, Relationship, SourceRef } from './types.js';

export function sourceRefs(config: ControlPlane): SourceRef[] {
  return config.sources.sources;
}

export function agentProfiles(config: ControlPlane): AgentProfile[] {
  return config.sources.profiles;
}

export function policyRules(config: ControlPlane): PolicyRule[] {
  return config.policy.policies;
}

export function registryObjects(config: ControlPlane): CmdbObject[] {
  return config.registry?.objects ?? [];
}

export function registryRelationships(config: ControlPlane): Relationship[] {
  return config.registry?.relationships ?? [];
}

export function policyWriteActions(config: ControlPlane): string[] | undefined {
  return config.policy.writeActions;
}
