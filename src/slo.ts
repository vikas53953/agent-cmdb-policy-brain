import { readJsonState, writeJsonState } from './store.js';
import type { ControlPlane, PreflightResult, SloConfig, SloResult } from './types.js';

interface SloBucket {
  bucketStart: string;
  total: number;
  allowed: number;
  denied: number;
}

interface SloCache {
  profile: string;
  metric: 'allow_rate';
  buckets: SloBucket[];
  lastUpdated: string;
  warnings?: string[];
}

export async function updateSloCache(
  controlPlane: ControlPlane,
  storeDir: string,
  result: PreflightResult
): Promise<void> {
  const profile = controlPlane.profiles.find((candidate) => candidate.id === result.decision.profile);
  if (!profile?.slo) return;

  const now = new Date();
  const cache = await readSloCache(storeDir, profile.id);
  const windowStartMs = now.getTime() - profile.slo.windowHours * 60 * 60 * 1000;
  const bucketStart = hourBucket(now);
  const buckets = cache.buckets.filter((bucket) => Date.parse(bucket.bucketStart) >= windowStartMs);
  const bucket = buckets.find((candidate) => candidate.bucketStart === bucketStart);
  const nextBucket = bucket ?? { bucketStart, total: 0, allowed: 0, denied: 0 };
  nextBucket.total += 1;
  if (result.allowed) {
    nextBucket.allowed += 1;
  } else {
    nextBucket.denied += 1;
  }
  if (!bucket) buckets.push(nextBucket);

  await writeSloCache(storeDir, {
    profile: profile.id,
    metric: profile.slo.metric,
    buckets: buckets.sort((left, right) => left.bucketStart.localeCompare(right.bucketStart)),
    lastUpdated: now.toISOString()
  });
}

export async function calculateSlo(
  controlPlane: ControlPlane,
  storeDir: string,
  profileId: string
): Promise<SloResult> {
  const profile = controlPlane.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) {
    throw new Error(`Unknown profile: ${profileId}.`);
  }

  const config = profile.slo ?? {
    target: 1,
    windowHours: 24,
    metric: 'allow_rate' as const
  };
  const now = new Date();
  const windowStartMs = now.getTime() - config.windowHours * 60 * 60 * 1000;
  const cache = await readSloCache(storeDir, profile.id);
  const bucketWarnings = cache.buckets
    .filter((bucket) => bucket.total !== bucket.allowed + bucket.denied)
    .map((bucket) => `SLO cache bucket ${bucket.bucketStart} has inconsistent totals.`);
  const warnings = [...(cache.warnings ?? []), ...bucketWarnings];

  if (warnings.length > 0) {
    return {
      profile: profile.id,
      target: config.target,
      actual: 0,
      withinBudget: false,
      errorBudgetRemaining: 0,
      totalDecisions: 0,
      allowedCount: 0,
      deniedCount: 0,
      windowStart: new Date(windowStartMs).toISOString(),
      windowEnd: now.toISOString(),
      warnings
    };
  }

  const buckets = cache.buckets.filter((bucket) => Date.parse(bucket.bucketStart) >= windowStartMs);
  const totalDecisions = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  const allowedCount = buckets.reduce((sum, bucket) => sum + bucket.allowed, 0);
  const deniedCount = buckets.reduce((sum, bucket) => sum + bucket.denied, 0);
  const actual = totalDecisions === 0 ? 1 : allowedCount / totalDecisions;
  const allowedErrorRate = totalDecisions === 0 ? 0 : deniedCount / totalDecisions;
  const errorBudget = 1 - config.target;
  const errorBudgetRemaining = Math.max(0, errorBudget - allowedErrorRate);

  return {
    profile: profile.id,
    target: config.target,
    actual,
    withinBudget: actual >= config.target,
    errorBudgetRemaining,
    totalDecisions,
    allowedCount,
    deniedCount,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: now.toISOString()
  };
}

async function readSloCache(storeDir: string, profile: string): Promise<SloCache> {
  return readJsonState<SloCache>(
    storeDir,
    cachePath(profile),
    { profile, metric: 'allow_rate', buckets: [], lastUpdated: new Date(0).toISOString() },
    parseSloCache
  );
}

async function writeSloCache(storeDir: string, cache: SloCache): Promise<void> {
  await writeJsonState(storeDir, cachePath(cache.profile), cache, parseSloCache);
}

function cachePath(profile: string): string {
  return `slo-cache/${safeSegment(profile)}.json`;
}

function hourBucket(date: Date): string {
  const bucket = new Date(date);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket.toISOString();
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error('SLO profile must be a safe filename segment.');
  }
  return value;
}

function parseSloCache(value: unknown): SloCache {
  const record = requireRecord(value, 'SLO cache');
  const metric = readString(record, 'metric', 'SLO metric');
  if (metric !== 'allow_rate') {
    throw new Error('SLO metric must be allow_rate.');
  }
  return {
    profile: safeSegment(readString(record, 'profile', 'SLO profile')),
    metric,
    buckets: Array.isArray(record.buckets) ? record.buckets.map(parseBucket) : [],
    lastUpdated: readString(record, 'lastUpdated', 'SLO lastUpdated'),
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((warning): warning is string => typeof warning === 'string')
      : undefined
  };
}

function parseBucket(value: unknown): SloBucket {
  const record = requireRecord(value, 'SLO bucket');
  return {
    bucketStart: readString(record, 'bucketStart', 'SLO bucketStart'),
    total: readNumber(record, 'total', 'SLO bucket total'),
    allowed: readNumber(record, 'allowed', 'SLO bucket allowed'),
    denied: readNumber(record, 'denied', 'SLO bucket denied')
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

function readNumber(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}
