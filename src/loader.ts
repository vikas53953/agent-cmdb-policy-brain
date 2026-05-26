import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { validateControlPlane } from './validator.js';
import type {
  AgentProfile,
  CmdbObject,
  ControlPlane,
  PolicyEffect,
  PolicyRule,
  Relationship,
  SourceRef
} from './types.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));

export const defaultControlPlanePath = resolve(moduleDir, '..', 'examples', 'basic', 'policy-library.yaml');
export const multiAgentExampleControlPlanePath = resolve(
  moduleDir,
  '..',
  'examples',
  'multi-agent',
  'policy-library.yaml'
);

export class ControlPlaneLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ControlPlaneLoadError';
  }
}

export function loadControlPlane(filePath: string): ControlPlane {
  const content = readControlPlaneFile(filePath);
  const parsed = parseControlPlaneContent(filePath, content);
  const controlPlane = parseControlPlane(parsed);
  const errors = validateControlPlane(controlPlane).filter((issue) => issue.severity === 'error');

  if (errors.length > 0) {
    const detail = errors.map((issue) => `${issue.code}: ${issue.message}`).join('; ');
    throw new ControlPlaneLoadError(`Policy config validation failed: ${detail}`);
  }

  return controlPlane;
}

export function loadDefaultControlPlane(): ControlPlane {
  return loadControlPlane(defaultControlPlanePath);
}

function readControlPlaneFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ControlPlaneLoadError(`Failed to read policy config at ${filePath}: ${detail}`);
  }
}

function parseControlPlaneContent(filePath: string, content: string): unknown {
  const extension = extname(filePath).toLowerCase();

  try {
    if (extension === '.yaml' || extension === '.yml') {
      return parseYaml(content);
    }

    return JSON.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const format = extension === '.yaml' || extension === '.yml' ? 'YAML' : 'JSON';
    throw new ControlPlaneLoadError(`Failed to parse policy config ${format} at ${filePath}: ${detail}`);
  }
}

function parseControlPlane(value: unknown): ControlPlane {
  const root = requireRecord(value, 'Policy config');
  const policyRoot = root.policy === undefined ? root : requireRecord(root.policy, 'Policy config');
  const sourceRoot = root.sources !== undefined && !Array.isArray(root.sources)
    ? requireRecord(root.sources, 'Source config')
    : root;
  const registryRoot = root.registry === undefined
    ? root
    : requireRecord(root.registry, 'Registry config');

  return {
    version: readString(root, 'version', 'Policy config version'),
    updatedAt: readString(root, 'updatedAt', 'Policy config updatedAt'),
    policy: {
      policies: readArray(policyRoot, 'policies', 'Policy config policies').map(parsePolicyRule),
      writeActions: optionalStringArray(policyRoot, 'writeActions', 'Policy config writeActions')
    },
    sources: {
      sources: readArray(sourceRoot, 'sources', 'Source config sources').map(parseSourceRef),
      profiles: readArray(sourceRoot, 'profiles', 'Source config profiles').map(parseAgentProfile)
    },
    registry: {
      objects: optionalArray(registryRoot, 'objects').map(parseCmdbObject),
      relationships: optionalArray(registryRoot, 'relationships').map(parseRelationship)
    }
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
    notes: optionalString(record, 'notes'),
    freshnessTtl: optionalString(record, 'freshnessTtl'),
    brainEntityId: optionalString(record, 'brainEntityId'),
    health: parseOptionalHealthConfig(record.health),
    costPerCall: optionalNonNegativeNumber(record, 'costPerCall')
  };
}

function parseAgentProfile(value: unknown): AgentProfile {
  const record = requireRecord(value, 'Profile');

  return {
    id: readString(record, 'id', 'Profile id'),
    name: readString(record, 'name', 'Profile name'),
    purpose: readString(record, 'purpose', 'Profile purpose'),
    guardrails: readStringArray(record, 'guardrails', 'Profile guardrails'),
    routes: readArray(record, 'routes', 'Profile routes').map(parseSourceRoute),
    analytics: parseOptionalAnalyticsConfig(record.analytics)
  };
}

function parseSourceRoute(value: unknown): AgentProfile['routes'][number] {
  const record = requireRecord(value, 'Source route');

  return {
    intent: readString(record, 'intent', 'Source route intent'),
    sources: readStringArray(record, 'sources', 'Source route sources'),
    notes: optionalString(record, 'notes'),
    blockOnStale: optionalBoolean(record, 'blockOnStale'),
    writeActions: optionalStringArray(record, 'writeActions', 'Source route writeActions')
  };
}

function parsePolicyRule(value: unknown): PolicyRule {
  const record = requireRecord(value, 'Policy');
  const effect = readString(record, 'effect', 'Policy effect');
  if (!['allow', 'deny'].includes(effect)) {
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

function readArray(record: Record<string, unknown>, key: string, label: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new ControlPlaneLoadError(`${label} must be an array.`);
  }
  return value;
}

function optionalArray(record: Record<string, unknown>, key: string): unknown[] {
  if (record[key] === undefined) return [];
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new ControlPlaneLoadError(`${key} must be an array.`);
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

function optionalNonNegativeNumber(record: Record<string, unknown>, key: string): number | undefined {
  if (record[key] === undefined) return undefined;
  if (typeof record[key] !== 'number' || !Number.isFinite(record[key]) || record[key] < 0) {
    throw new ControlPlaneLoadError(`${key} must be a non-negative number.`);
  }
  return record[key];
}

function parseOptionalHealthConfig(value: unknown): SourceRef['health'] {
  if (value === undefined) return undefined;
  const record = requireRecord(value, 'Source health');
  return {
    failureThreshold: optionalPositiveInteger(record, 'failureThreshold'),
    failureWindowMs: optionalNonNegativeNumber(record, 'failureWindowMs'),
    recoveryTimeoutMs: optionalNonNegativeNumber(record, 'recoveryTimeoutMs')
  };
}

function parseOptionalAnalyticsConfig(value: unknown): AgentProfile['analytics'] {
  if (value === undefined) return undefined;
  const record = requireRecord(value, 'Profile analytics');
  const windowHours = optionalNonNegativeNumber(record, 'windowHours');
  if (windowHours === undefined || windowHours <= 0) {
    throw new ControlPlaneLoadError('Profile analytics windowHours must be greater than 0.');
  }
  return {
    windowHours
  };
}

function optionalPositiveInteger(record: Record<string, unknown>, key: string): number | undefined {
  if (record[key] === undefined) return undefined;
  if (!Number.isInteger(record[key]) || (record[key] as number) <= 0) {
    throw new ControlPlaneLoadError(`${key} must be a positive integer.`);
  }
  return record[key] as number;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ControlPlaneLoadError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ControlPlaneLoadError(`${label} must be a non-empty string.`);
  }
  return value;
}
