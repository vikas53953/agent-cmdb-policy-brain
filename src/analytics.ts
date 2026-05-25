import { agentProfiles } from './config-access.js';
import { readJsonState, writeJsonState } from './store.js';
import type { ControlPlane, PreflightAnalytics, PreflightResult, TamperMode } from './types.js';

interface AnalyticsBucket {
  bucketStart: string;
  total: number;
  allowed: number;
  denied: number;
  denyRules: Record<string, number>;
  actions: Record<string, { allowed: number; denied: number }>;
}

interface AnalyticsCache {
  profile: string;
  metric: 'preflight_decisions';
  buckets: AnalyticsBucket[];
  lastUpdated: string;
  warnings?: string[];
}

export async function updatePreflightAnalyticsCache(
  controlPlane: ControlPlane,
  storeDir: string,
  result: PreflightResult,
  tamperMode: TamperMode = 'warn'
): Promise<void> {
  const profile = agentProfiles(controlPlane).find((candidate) => candidate.id === result.decision.profile);
  if (!profile) return;
  const config = profile.analytics ?? { windowHours: 24 };

  const now = new Date();
  const cache = await readAnalyticsCache(storeDir, profile.id, tamperMode);
  const windowStartMs = now.getTime() - config.windowHours * 60 * 60 * 1000;
  const bucketStart = hourBucket(now);
  const buckets = cache.buckets.filter((bucket) => Date.parse(bucket.bucketStart) >= windowStartMs);
  const bucket = buckets.find((candidate) => candidate.bucketStart === bucketStart);
  const nextBucket = bucket ?? {
    bucketStart,
    total: 0,
    allowed: 0,
    denied: 0,
    denyRules: {},
    actions: {}
  };
  nextBucket.total += 1;
  const action = result.decision.action;
  const actionCounts = nextBucket.actions[action] ?? { allowed: 0, denied: 0 };

  if (result.allowed) {
    nextBucket.allowed += 1;
    actionCounts.allowed += 1;
  } else {
    nextBucket.denied += 1;
    actionCounts.denied += 1;
    nextBucket.denyRules[result.decision.ruleId] = (nextBucket.denyRules[result.decision.ruleId] ?? 0) + 1;
  }

  nextBucket.actions[action] = actionCounts;
  if (!bucket) buckets.push(nextBucket);

  await writeAnalyticsCache(storeDir, {
    profile: profile.id,
    metric: 'preflight_decisions',
    buckets: buckets.sort((left, right) => left.bucketStart.localeCompare(right.bucketStart)),
    lastUpdated: now.toISOString()
  });
}

export async function calculatePreflightAnalytics(
  controlPlane: ControlPlane,
  storeDir: string,
  profileId: string,
  tamperMode: TamperMode = 'warn'
): Promise<PreflightAnalytics> {
  const profile = agentProfiles(controlPlane).find((candidate) => candidate.id === profileId);
  if (!profile) {
    throw new Error(`Unknown profile: ${profileId}.`);
  }

  const windowHours = profile.analytics?.windowHours ?? 24;
  const now = new Date();
  const windowStartMs = now.getTime() - windowHours * 60 * 60 * 1000;
  const cache = await readAnalyticsCache(storeDir, profile.id, tamperMode);
  const bucketWarnings = cache.buckets
    .filter((bucket) => bucket.total !== bucket.allowed + bucket.denied)
    .map((bucket) => `Preflight analytics cache bucket ${bucket.bucketStart} has inconsistent totals.`);
  const warnings = [...(cache.warnings ?? []), ...bucketWarnings];

  if (warnings.length > 0) {
    return {
      profile: profile.id,
      windowHours,
      totalDecisions: 0,
      allowedCount: 0,
      deniedCount: 0,
      allowRate: 0,
      denyRate: 0,
      topDenyRules: [],
      byAction: [],
      windowStart: new Date(windowStartMs).toISOString(),
      windowEnd: now.toISOString(),
      warnings
    };
  }

  const buckets = cache.buckets.filter((bucket) => Date.parse(bucket.bucketStart) >= windowStartMs);
  const totalDecisions = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  const allowedCount = buckets.reduce((sum, bucket) => sum + bucket.allowed, 0);
  const deniedCount = buckets.reduce((sum, bucket) => sum + bucket.denied, 0);
  const allowRate = totalDecisions === 0 ? 1 : allowedCount / totalDecisions;
  const denyRate = totalDecisions === 0 ? 0 : deniedCount / totalDecisions;
  const denyRules = new Map<string, number>();
  const actions = new Map<string, { action: string; allowed: number; denied: number }>();

  for (const bucket of buckets) {
    for (const [ruleId, count] of Object.entries(bucket.denyRules)) {
      denyRules.set(ruleId, (denyRules.get(ruleId) ?? 0) + count);
    }
    for (const [action, counts] of Object.entries(bucket.actions)) {
      const existing = actions.get(action) ?? { action, allowed: 0, denied: 0 };
      existing.allowed += counts.allowed;
      existing.denied += counts.denied;
      actions.set(action, existing);
    }
  }

  return {
    profile: profile.id,
    windowHours,
    totalDecisions,
    allowedCount,
    deniedCount,
    allowRate,
    denyRate,
    topDenyRules: [...denyRules.entries()]
      .map(([ruleId, count]) => ({ ruleId, count }))
      .sort((left, right) => right.count - left.count || left.ruleId.localeCompare(right.ruleId)),
    byAction: [...actions.values()]
      .sort((left, right) => (right.allowed + right.denied) - (left.allowed + left.denied) || left.action.localeCompare(right.action)),
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: now.toISOString()
  };
}

async function readAnalyticsCache(storeDir: string, profile: string, tamperMode: TamperMode): Promise<AnalyticsCache> {
  return readJsonState<AnalyticsCache>(
    storeDir,
    cachePath(profile),
    { profile, metric: 'preflight_decisions', buckets: [], lastUpdated: new Date(0).toISOString() },
    parseAnalyticsCache,
    { tamperMode }
  );
}

async function writeAnalyticsCache(storeDir: string, cache: AnalyticsCache): Promise<void> {
  await writeJsonState(storeDir, cachePath(cache.profile), cache, parseAnalyticsCache);
}

function cachePath(profile: string): string {
  return `analytics-cache/${safeSegment(profile)}.json`;
}

function hourBucket(date: Date): string {
  const bucket = new Date(date);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket.toISOString();
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error('Preflight analytics profile must be a safe filename segment.');
  }
  return value;
}

function parseAnalyticsCache(value: unknown): AnalyticsCache {
  const record = requireRecord(value, 'Preflight analytics cache');
  const metric = readString(record, 'metric', 'Preflight analytics metric');
  if (metric !== 'preflight_decisions') {
    throw new Error('Preflight analytics metric must be preflight_decisions.');
  }
  return {
    profile: safeSegment(readString(record, 'profile', 'Preflight analytics profile')),
    metric,
    buckets: Array.isArray(record.buckets) ? record.buckets.map(parseBucket) : [],
    lastUpdated: readString(record, 'lastUpdated', 'Preflight analytics lastUpdated'),
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((warning): warning is string => typeof warning === 'string')
      : undefined
  };
}

function parseBucket(value: unknown): AnalyticsBucket {
  const record = requireRecord(value, 'Preflight analytics bucket');
  return {
    bucketStart: readString(record, 'bucketStart', 'Preflight analytics bucketStart'),
    total: readNumber(record, 'total', 'Preflight analytics bucket total'),
    allowed: readNumber(record, 'allowed', 'Preflight analytics bucket allowed'),
    denied: readNumber(record, 'denied', 'Preflight analytics bucket denied'),
    denyRules: parseStringNumberMap(record.denyRules, 'Preflight analytics bucket denyRules'),
    actions: parseActionMap(record.actions)
  };
}

function parseStringNumberMap(value: unknown, label: string): Record<string, number> {
  if (value === undefined) return {};
  const record = requireRecord(value, label);
  return Object.fromEntries(
    Object.entries(record).map(([key, nestedValue]) => [safeSegment(key), readNumber({ value: nestedValue }, 'value', label)])
  );
}

function parseActionMap(value: unknown): Record<string, { allowed: number; denied: number }> {
  if (value === undefined) return {};
  const record = requireRecord(value, 'Preflight analytics bucket actions');
  return Object.fromEntries(
    Object.entries(record).map(([action, counts]) => {
      const countRecord = requireRecord(counts, 'Preflight analytics action counts');
      return [
        safeSegment(action),
        {
          allowed: readNumber(countRecord, 'allowed', 'Preflight analytics action allowed'),
          denied: readNumber(countRecord, 'denied', 'Preflight analytics action denied')
        }
      ];
    })
  );
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

function readNumber(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}
