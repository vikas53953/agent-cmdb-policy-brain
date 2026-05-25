import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceRefs } from './config-access.js';
import { appendChange, readJsonState, writeJsonState } from './store.js';
import type { ControlPlane, HealthGateState, SourceHealth, SourceHealthConfig, TamperMode } from './types.js';

interface HealthState {
  sources: SourceHealth[];
  warnings?: string[];
}

const healthFile = 'health.json';
const maxRecoveryTimeoutMs = 300_000;
const maxRecoveryJitterMs = 5_000;
const healthQueues = new Map<string, Promise<unknown>>();
const defaultHealthConfig: Required<SourceHealthConfig> = {
  failureThreshold: 5,
  failureWindowMs: 60_000,
  recoveryTimeoutMs: 30_000
};

export async function recordSourceSuccess(
  controlPlane: ControlPlane,
  storeDir: string,
  sourceId: string,
  tamperMode: TamperMode = 'warn'
): Promise<SourceHealth> {
  return withHealthLock(storeDir, async () => {
    ensureKnownSource(controlPlane, sourceId);
    const state = await readHealthState(storeDir, tamperMode);
    const current = transitionForRecovery(getHealthFromState(state, sourceId));
    const now = new Date().toISOString();

    if (state.warnings?.length) {
      return getHealthFromState(state, sourceId);
    }

    if (current.status === 'down') {
      return current;
    }

    const next: SourceHealth = {
      ...healthySource(controlPlane, sourceId, now),
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
  });
}

export async function recordSourceFailure(
  controlPlane: ControlPlane,
  storeDir: string,
  sourceId: string,
  reason = 'source failure',
  tamperMode: TamperMode = 'warn'
): Promise<SourceHealth> {
  return withHealthLock(storeDir, async () => {
    ensureKnownSource(controlPlane, sourceId);
    const state = await readHealthState(storeDir, tamperMode);
    const current = transitionForRecovery(getHealthFromState(state, sourceId));
    const config = healthConfig(controlPlane, sourceId);
    const now = new Date().toISOString();

    if (state.warnings?.length) {
      return getHealthFromState(state, sourceId);
    }

    const nextFailures = pruneFailures([
      ...current.failures,
      { timestamp: now, reason }
    ], config.failureWindowMs);
    const halfOpenFailure = current.status === 'half-open';
    const status: SourceHealth['status'] = halfOpenFailure || nextFailures.length >= config.failureThreshold
      ? 'down'
      : 'up';
    const next: SourceHealth = {
      sourceId,
      status,
      failures: nextFailures,
      failureWindowMs: config.failureWindowMs,
      failureThreshold: config.failureThreshold,
      recoveryTimeoutMs: config.recoveryTimeoutMs,
      recoveryAttempts: halfOpenFailure
        ? Math.min(current.recoveryAttempts + 1, 32)
        : current.recoveryAttempts,
      probeInFlight: false,
      lastChecked: now,
      lastFailure: now,
      lastSuccess: current.lastSuccess
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
  });
}

export async function getSourceHealth(
  controlPlane: ControlPlane,
  storeDir: string,
  sourceId: string,
  tamperMode: TamperMode = 'warn'
): Promise<SourceHealth> {
  ensureKnownSource(controlPlane, sourceId);
  return getHealthFromState(await readHealthState(storeDir, tamperMode), sourceId);
}

export async function listSourceHealth(
  controlPlane: ControlPlane,
  storeDir: string,
  tamperMode: TamperMode = 'warn'
): Promise<SourceHealth[]> {
  const state = await readHealthState(storeDir, tamperMode);
  return sourceRefs(controlPlane).map((source) => getHealthFromState(state, source.id));
}

export async function isSourceAvailable(
  controlPlane: ControlPlane,
  storeDir: string,
  sourceId: string,
  tamperMode: TamperMode = 'warn'
): Promise<boolean> {
  return withHealthLock(storeDir, async () => {
    ensureKnownSource(controlPlane, sourceId);
    const state = await readHealthState(storeDir, tamperMode);
    const current = transitionForRecovery(getHealthFromState(state, sourceId));

    if (state.warnings?.length) {
      return true;
    }

    if (current.status === 'up') {
      if (current.lastChecked !== getHealthFromState(state, sourceId).lastChecked) {
        await writeHealthEntry(storeDir, state, current);
      }
      return true;
    }

    if (current.status === 'down') {
      return false;
    }

    if (current.probeInFlight) {
      return false;
    }

    await writeHealthEntry(storeDir, state, {
      ...current,
      probeInFlight: true,
      lastChecked: new Date().toISOString()
    });
    return true;
  });
}

export async function getHealthState(
  controlPlane: ControlPlane,
  storeDir: string,
  sourceId: string,
  tamperMode: TamperMode = 'warn'
): Promise<HealthGateState> {
  const health = await getSourceHealth(controlPlane, storeDir, sourceId, tamperMode);
  if (health.status === 'down') return 'open';
  if (health.status === 'half-open') return 'half-open';
  return 'closed';
}

export async function resetSourceHealth(
  controlPlane: ControlPlane,
  storeDir: string,
  sourceId: string,
  tamperMode: TamperMode = 'warn'
): Promise<SourceHealth> {
  return withHealthLock(storeDir, async () => {
    ensureKnownSource(controlPlane, sourceId);
    const state = await readHealthState(storeDir, tamperMode);
    const now = new Date().toISOString();
    const next = healthySource(controlPlane, sourceId, now);
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
  });
}

function withHealthLock<T>(storeDir: string, operation: () => Promise<T>): Promise<T> {
  const key = join(storeDir, healthFile);
  const previous = healthQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  healthQueues.set(key, next.catch(() => undefined));
  return next;
}

async function readHealthState(storeDir: string, tamperMode: TamperMode): Promise<HealthState> {
  try {
    const state = await readJsonState<HealthState>(
      storeDir,
      healthFile,
      { sources: [] },
      parseHealthState,
      { tamperMode }
    );
    if (state.warnings?.length) {
      if (tamperMode === 'fail') {
        throw new Error(state.warnings.join('; '));
      }
      return { sources: [], warnings: [healthTamperWarning()] };
    }
    return state;
  } catch (error) {
    if (tamperMode === 'fail') throw error;
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
  if (state.warnings?.length) {
    return {
      ...healthySourceFromConfig(sourceId, new Date(0).toISOString(), defaultHealthConfig),
      warnings: [healthTamperWarning()]
    };
  }
  return state.sources.find((source) => source.sourceId === sourceId)
    ?? healthySourceFromConfig(sourceId, new Date(0).toISOString(), defaultHealthConfig);
}

function transitionForRecovery(health: SourceHealth): SourceHealth {
  if (health.status !== 'down' || !recoveryElapsed(health)) {
    return health;
  }
  return {
    ...health,
    status: 'half-open',
    probeInFlight: false,
    lastChecked: new Date().toISOString()
  };
}

function recoveryElapsed(health: SourceHealth): boolean {
  if (!health.lastFailure) return true;
  const elapsedMs = Date.now() - Date.parse(health.lastFailure);
  return elapsedMs >= effectiveRecoveryTimeoutMs(health);
}

function effectiveRecoveryTimeoutMs(health: SourceHealth): number {
  if (health.recoveryTimeoutMs === 0) return 0;
  const exponential = health.recoveryTimeoutMs * 2 ** health.recoveryAttempts;
  const jitter = Math.floor(Math.random() * maxRecoveryJitterMs);
  return Math.min(exponential + jitter, maxRecoveryTimeoutMs);
}

function pruneFailures(failures: SourceHealth['failures'], windowMs: number): SourceHealth['failures'] {
  const cutoff = Date.now() - windowMs;
  return failures.filter((failure) => Date.parse(failure.timestamp) >= cutoff);
}

function healthySource(controlPlane: ControlPlane, sourceId: string, timestamp: string): SourceHealth {
  return healthySourceFromConfig(sourceId, timestamp, healthConfig(controlPlane, sourceId));
}

function healthySourceFromConfig(
  sourceId: string,
  timestamp: string,
  config: Required<SourceHealthConfig>
): SourceHealth {
  return {
    sourceId,
    status: 'up',
    failures: [],
    failureWindowMs: config.failureWindowMs,
    failureThreshold: config.failureThreshold,
    recoveryTimeoutMs: config.recoveryTimeoutMs,
    recoveryAttempts: 0,
    probeInFlight: false,
    lastChecked: timestamp,
    lastSuccess: timestamp === new Date(0).toISOString() ? undefined : timestamp
  };
}

function healthConfig(controlPlane: ControlPlane, sourceId: string): Required<SourceHealthConfig> {
  const source = sourceRefs(controlPlane).find((candidate) => candidate.id === sourceId);
  return {
    failureThreshold: source?.health?.failureThreshold ?? defaultHealthConfig.failureThreshold,
    failureWindowMs: source?.health?.failureWindowMs ?? defaultHealthConfig.failureWindowMs,
    recoveryTimeoutMs: source?.health?.recoveryTimeoutMs ?? defaultHealthConfig.recoveryTimeoutMs
  };
}

function ensureKnownSource(controlPlane: ControlPlane, sourceId: string): void {
  if (!sourceRefs(controlPlane).some((source) => source.id === sourceId)) {
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
    failures: Array.isArray(record.failures) ? record.failures.map(parseFailureRecord) : [],
    failureWindowMs: optionalNumber(record, 'failureWindowMs') ?? defaultHealthConfig.failureWindowMs,
    failureThreshold: optionalNumber(record, 'failureThreshold') ?? defaultHealthConfig.failureThreshold,
    recoveryTimeoutMs: optionalNumber(record, 'recoveryTimeoutMs') ?? defaultHealthConfig.recoveryTimeoutMs,
    recoveryAttempts: optionalNumber(record, 'recoveryAttempts') ?? 0,
    probeInFlight: record.probeInFlight === true,
    lastChecked: readString(record, 'lastChecked', 'Source health lastChecked'),
    lastFailure: optionalString(record, 'lastFailure'),
    lastSuccess: optionalString(record, 'lastSuccess')
  };
}

function parseFailureRecord(value: unknown): { timestamp: string; reason?: string } {
  const record = requireRecord(value, 'Source failure record');
  return {
    timestamp: readString(record, 'timestamp', 'Source failure timestamp'),
    reason: optionalString(record, 'reason')
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

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  if (record[key] === undefined) return undefined;
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${key} must be a non-negative number.`);
  }
  return value;
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
