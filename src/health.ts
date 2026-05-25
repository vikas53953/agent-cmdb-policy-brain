import { appendChange, readJsonState, writeJsonState } from './store.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ControlPlane, HealthGateState, SourceHealth, SourceHealthConfig } from './types.js';

interface HealthState {
  sources: SourceHealth[];
  warnings?: string[];
}

const healthFile = 'health.json';
const defaultHealthConfig: Required<SourceHealthConfig> = {
  failureThreshold: 5,
  recoveryTimeoutMs: 30_000
};
const maxRecoveryTimeoutMs = 300_000;

export async function recordSourceSuccess(
  controlPlane: ControlPlane,
  storeDir: string,
  sourceId: string
): Promise<SourceHealth> {
  ensureKnownSource(controlPlane, sourceId);
  const state = await readHealthState(storeDir);
  const current = getHealthFromState(state, sourceId);
  const now = new Date().toISOString();

  if (current.warnings && current.warnings.length > 0) {
    return current;
  }

  if (current.status === 'down' && !recoveryElapsed(controlPlane, current)) {
    return current;
  }

  const next: SourceHealth = {
    sourceId,
    status: 'up',
    consecutiveFailures: 0,
    probeCount: 0,
    recoveryAttempts: 0,
    lastChecked: now,
    lastFailure: current.lastFailure,
    lastSuccess: now
  };
  await writeHealthEntry(storeDir, state, next);
  await appendChange(storeDir, {
    target: `source.${sourceId}`,
    targetType: 'source',
    action: 'verify',
    actor: 'agent-cmdb-health',
    reason: `Source ${sourceId} reported success.`,
    changedAt: now,
    after: next
  });
  return next;
}

export async function recordSourceFailure(
  controlPlane: ControlPlane,
  storeDir: string,
  sourceId: string
): Promise<SourceHealth> {
  ensureKnownSource(controlPlane, sourceId);
  const state = await readHealthState(storeDir);
  const current = getHealthFromState(state, sourceId);
  const config = healthConfig(controlPlane, sourceId);
  const now = new Date().toISOString();
  const recoveredForProbe = current.status === 'down' && recoveryElapsed(controlPlane, current);
  const effectiveCurrent: SourceHealth = recoveredForProbe
    ? { ...current, status: 'half-open', probeCount: 1, lastChecked: now }
    : current;
  const consecutiveFailures = effectiveCurrent.status === 'half-open'
    ? config.failureThreshold
    : effectiveCurrent.consecutiveFailures + 1;
  const status: SourceHealth['status'] = consecutiveFailures >= config.failureThreshold ? 'down' : 'up';
  const next: SourceHealth = {
    sourceId,
    status,
    consecutiveFailures,
    probeCount: 0,
    recoveryAttempts: status === 'down' && effectiveCurrent.status === 'half-open'
      ? Math.min((effectiveCurrent.recoveryAttempts ?? 0) + 1, 32)
      : effectiveCurrent.recoveryAttempts ?? 0,
    lastChecked: now,
    lastFailure: now,
    lastSuccess: effectiveCurrent.lastSuccess
  };

  await writeHealthEntry(storeDir, state, next);
  await appendChange(storeDir, {
    target: `source.${sourceId}`,
    targetType: 'source',
    action: 'verify',
    actor: 'agent-cmdb-health',
    reason: `Source ${sourceId} reported failure.`,
    changedAt: now,
    after: next
  });
  return next;
}

export async function getSourceHealth(
  controlPlane: ControlPlane,
  storeDir: string,
  sourceId: string
): Promise<SourceHealth> {
  ensureKnownSource(controlPlane, sourceId);
  return getHealthFromState(await readHealthState(storeDir), sourceId);
}

export async function listSourceHealth(controlPlane: ControlPlane, storeDir: string): Promise<SourceHealth[]> {
  const state = await readHealthState(storeDir);
  return controlPlane.sources.map((source) => getHealthFromState(state, source.id));
}

export async function isSourceAvailable(
  controlPlane: ControlPlane,
  storeDir: string,
  sourceId: string
): Promise<boolean> {
  ensureKnownSource(controlPlane, sourceId);
  const state = await readHealthState(storeDir);
  const current = getHealthFromState(state, sourceId);

  if (current.status === 'up') {
    return true;
  }

  if (current.status === 'half-open') {
    if ((current.probeCount ?? 0) > 0) {
      return false;
    }
    await writeHealthEntry(storeDir, state, {
      ...current,
      probeCount: 1,
      lastChecked: new Date().toISOString()
    });
    return true;
  }

  if (!recoveryElapsed(controlPlane, current)) {
    return false;
  }

  const next: SourceHealth = {
    ...current,
    status: 'half-open',
    probeCount: 1,
    lastChecked: new Date().toISOString()
  };
  await writeHealthEntry(storeDir, state, next);
  return true;
}

export async function getHealthState(
  controlPlane: ControlPlane,
  storeDir: string,
  sourceId: string
): Promise<HealthGateState> {
  const health = await getSourceHealth(controlPlane, storeDir, sourceId);
  if (health.status === 'down') return 'open';
  if (health.status === 'half-open') return 'half-open';
  return 'closed';
}

export async function resetSourceHealth(
  controlPlane: ControlPlane,
  storeDir: string,
  sourceId: string
): Promise<SourceHealth> {
  ensureKnownSource(controlPlane, sourceId);
  const state = await readHealthState(storeDir);
  const now = new Date().toISOString();
  const next: SourceHealth = {
    sourceId,
    status: 'up',
    consecutiveFailures: 0,
    probeCount: 0,
    recoveryAttempts: 0,
    lastChecked: now,
    lastSuccess: now
  };
  await writeHealthEntry(storeDir, state, next);
  await appendChange(storeDir, {
    target: `source.${sourceId}`,
    targetType: 'source',
    action: 'resume',
    actor: 'agent-cmdb-health',
    reason: `Source ${sourceId} health manually reset.`,
    changedAt: now,
    after: next
  });
  return next;
}

async function readHealthState(storeDir: string): Promise<HealthState> {
  try {
    return await readJsonState<HealthState>(storeDir, healthFile, { sources: [] }, parseHealthState);
  } catch {
    return {
      sources: [],
      warnings: [healthTamperWarning()]
    };
  }
}

export function readHealthWarningsSync(storeDir: string): string[] {
  try {
    const raw = readFileSync(join(storeDir, healthFile), 'utf8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw) as { prevHash?: unknown };
    if (typeof parsed.prevHash === 'string' && parsed.prevHash.length > 0 && parsed.prevHash !== hashHealthPayload(parsed)) {
      return [healthTamperWarning()];
    }
    return [];
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    return [healthTamperWarning()];
  }
}

function healthTamperWarning(): string {
  return 'Health state was tampered. All sources reset to up. Re-record failures to rebuild health state.';
}

async function writeHealthEntry(storeDir: string, state: HealthState, entry: SourceHealth): Promise<void> {
  const sources = state.sources.filter((source) => source.sourceId !== entry.sourceId);
  sources.push(entry);
  sources.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  await writeJsonState(storeDir, healthFile, { sources }, parseHealthState);
}

function getHealthFromState(state: HealthState, sourceId: string): SourceHealth {
  const health = state.sources.find((source) => source.sourceId === sourceId) ?? {
    sourceId,
    status: 'up',
    consecutiveFailures: 0,
    lastChecked: new Date(0).toISOString()
  };
  if (!state.warnings || state.warnings.length === 0) return health;

  return {
    sourceId,
    status: 'up',
    consecutiveFailures: 0,
    probeCount: 0,
    recoveryAttempts: 0,
    lastChecked: new Date(0).toISOString(),
    warnings: ['Health state was tampered. All sources reset to up. Re-record failures to rebuild health state.']
  };
}

function recoveryElapsed(controlPlane: ControlPlane, health: SourceHealth): boolean {
  if (!health.lastFailure) return true;
  const elapsedMs = Date.now() - Date.parse(health.lastFailure);
  return elapsedMs >= effectiveRecoveryTimeoutMs(controlPlane, health);
}

function effectiveRecoveryTimeoutMs(controlPlane: ControlPlane, health: SourceHealth): number {
  const base = healthConfig(controlPlane, health.sourceId).recoveryTimeoutMs;
  return Math.min(base * 2 ** (health.recoveryAttempts ?? 0), maxRecoveryTimeoutMs);
}

function healthConfig(controlPlane: ControlPlane, sourceId: string): Required<SourceHealthConfig> {
  const source = controlPlane.sources.find((candidate) => candidate.id === sourceId);
  return {
    failureThreshold: source?.health?.failureThreshold ?? defaultHealthConfig.failureThreshold,
    recoveryTimeoutMs: source?.health?.recoveryTimeoutMs ?? defaultHealthConfig.recoveryTimeoutMs
  };
}

function ensureKnownSource(controlPlane: ControlPlane, sourceId: string): void {
  if (!controlPlane.sources.some((source) => source.id === sourceId)) {
    throw new Error(`Unknown source: ${sourceId}.`);
  }
}

function parseHealthState(value: unknown): HealthState {
  const record = requireRecord(value, 'Health state');
  const sources = Array.isArray(record.sources) ? record.sources.map(parseSourceHealth) : [];
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.filter((warning): warning is string => typeof warning === 'string')
    : undefined;
  return {
    sources,
    warnings: warnings && warnings.length > 0 ? warnings : undefined
  };
}

function parseSourceHealth(value: unknown): SourceHealth {
  const record = requireRecord(value, 'Source health');
  const status = readString(record, 'status', 'Source health status');
  if (!['up', 'down', 'half-open'].includes(status)) {
    throw new Error(`Invalid source health status: ${status}.`);
  }

  return {
    sourceId: readString(record, 'sourceId', 'Source health sourceId'),
    status: status as SourceHealth['status'],
    consecutiveFailures: readNumber(record, 'consecutiveFailures', 'Source health consecutiveFailures'),
    probeCount: optionalNumber(record, 'probeCount') ?? 0,
    recoveryAttempts: optionalNumber(record, 'recoveryAttempts') ?? 0,
    lastChecked: readString(record, 'lastChecked', 'Source health lastChecked'),
    lastFailure: optionalString(record, 'lastFailure'),
    lastSuccess: optionalString(record, 'lastSuccess')
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  if (record[key] === undefined) return undefined;
  return readString(record, key, key);
}

function readNumber(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  if (record[key] === undefined) return undefined;
  return readNumber(record, key, key);
}

function hashHealthPayload(value: Record<string, unknown>): string {
  return sha256(stableStringify(stripHashFields(value)));
}

function stripHashFields(value: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...value };
  delete clone.prevHash;
  delete clone.warnings;
  return clone;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
