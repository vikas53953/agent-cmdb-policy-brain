import { appendChange, readJsonState, writeJsonState } from './store.js';
import type { CircuitState, ControlPlane, SourceHealth, SourceHealthConfig } from './types.js';

interface HealthState {
  sources: SourceHealth[];
  warnings?: string[];
}

const healthFile = 'health.json';
const defaultHealthConfig: Required<SourceHealthConfig> = {
  failureThreshold: 5,
  recoveryTimeoutMs: 30_000
};

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
  const consecutiveFailures = current.status === 'half-open'
    ? config.failureThreshold
    : current.consecutiveFailures + 1;
  const status: SourceHealth['status'] = consecutiveFailures >= config.failureThreshold ? 'down' : 'up';
  const next: SourceHealth = {
    sourceId,
    status,
    consecutiveFailures,
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

  if (current.status === 'up' || current.status === 'half-open') {
    return true;
  }

  if (!recoveryElapsed(controlPlane, current)) {
    return false;
  }

  const next: SourceHealth = {
    ...current,
    status: 'half-open',
    lastChecked: new Date().toISOString()
  };
  await writeHealthEntry(storeDir, state, next);
  return true;
}

export async function getCircuitState(
  controlPlane: ControlPlane,
  storeDir: string,
  sourceId: string
): Promise<CircuitState> {
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
  return readJsonState<HealthState>(storeDir, healthFile, { sources: [] }, parseHealthState);
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
    ...health,
    status: 'down',
    consecutiveFailures: Math.max(health.consecutiveFailures, healthConfigFromStateFallback()),
    warnings: state.warnings
  };
}

function recoveryElapsed(controlPlane: ControlPlane, health: SourceHealth): boolean {
  if (!health.lastFailure) return true;
  const elapsedMs = Date.now() - Date.parse(health.lastFailure);
  return elapsedMs >= healthConfig(controlPlane, health.sourceId).recoveryTimeoutMs;
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

function healthConfigFromStateFallback(): number {
  return defaultHealthConfig.failureThreshold;
}
