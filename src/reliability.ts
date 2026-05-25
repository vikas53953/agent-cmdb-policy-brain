import { readJsonState, writeJsonState } from './store.js';
import type { ControlPlane, PreflightResult, ReliabilityConfig, ReliabilityResult } from './types.js';

interface ReliabilityBucket {
  bucketStart: string;
  total: number;
  allowed: number;
  denied: number;
}

interface ReliabilityCache {
  profile: string;
  metric: 'allow_rate';
  buckets: ReliabilityBucket[];
  lastUpdated: string;
  warnings?: string[];
}

export async function updateReliabilityCache(
  controlPlane: ControlPlane,
  storeDir: string,
  result: PreflightResult
): Promise<void> {
  const profile = controlPlane.profiles.find((candidate) => candidate.id === result.decision.profile);
  const config = profileReliabilityConfig(profile);
  if (!profile || !config) return;

  const now = new Date();
  const cache = await readReliabilityCache(storeDir, profile.id);
  const windowStartMs = now.getTime() - config.windowHours * 60 * 60 * 1000;
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

  await writeReliabilityCache(storeDir, {
    profile: profile.id,
    metric: config.metric,
    buckets: buckets.sort((left, right) => left.bucketStart.localeCompare(right.bucketStart)),
    lastUpdated: now.toISOString()
  });
}

export async function calculateReliability(
  controlPlane: ControlPlane,
  storeDir: string,
  profileId: string
): Promise<ReliabilityResult> {
  const profile = controlPlane.profiles.find((candidate) => candidate.id === profileId);
  if (!profile) {
    throw new Error(`Unknown profile: ${profileId}.`);
  }

  const config = profileReliabilityConfig(profile) ?? {
    target: 1,
    windowHours: 24,
    metric: 'allow_rate' as const
  };
  const now = new Date();
  const windowStartMs = now.getTime() - config.windowHours * 60 * 60 * 1000;
  const cache = await readReliabilityCache(storeDir, profile.id);
  const bucketWarnings = cache.buckets
    .filter((bucket) => bucket.total !== bucket.allowed + bucket.denied)
    .map((bucket) => `Reliability cache bucket ${bucket.bucketStart} has inconsistent totals.`);
  const warnings = [...(cache.warnings ?? []), ...bucketWarnings];

  if (warnings.length > 0) {
    return {
      profile: profile.id,
      target: config.target,
      actual: 0,
      withinBudget: false,
      failureBudgetRemaining: 0,
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
  const deniedRate = totalDecisions === 0 ? 0 : deniedCount / totalDecisions;
  const failureBudget = 1 - config.target;
  const failureBudgetRemaining = Math.max(0, failureBudget - deniedRate);

  return {
    profile: profile.id,
    target: config.target,
    actual,
    withinBudget: actual >= config.target,
    failureBudgetRemaining,
    totalDecisions,
    allowedCount,
    deniedCount,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: now.toISOString()
  };
}

async function readReliabilityCache(storeDir: string, profile: string): Promise<ReliabilityCache> {
  return readJsonState<ReliabilityCache>(
    storeDir,
    cachePath(profile),
    { profile, metric: 'allow_rate', buckets: [], lastUpdated: new Date(0).toISOString() },
    parseReliabilityCache
  );
}

async function writeReliabilityCache(storeDir: string, cache: ReliabilityCache): Promise<void> {
  await writeJsonState(storeDir, cachePath(cache.profile), cache, parseReliabilityCache);
}

function profileReliabilityConfig(profile: { reliability?: ReliabilityConfig } | undefined): ReliabilityConfig | undefined {
  return profile?.reliability;
}

function cachePath(profile: string): string {
  return `reliability-cache/${safeSegment(profile)}.json`;
}

function hourBucket(date: Date): string {
  const bucket = new Date(date);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket.toISOString();
}

function safeSegment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error('Reliability profile must be a safe filename segment.');
  }
  return value;
}

function parseReliabilityCache(value: unknown): ReliabilityCache {
  const record = requireRecord(value, 'Reliability cache');
  const metric = readString(record, 'metric', 'Reliability metric');
  if (metric !== 'allow_rate') {
    throw new Error('Reliability metric must be allow_rate.');
  }
  return {
    profile: safeSegment(readString(record, 'profile', 'Reliability profile')),
    metric,
    buckets: Array.isArray(record.buckets) ? record.buckets.map(parseBucket) : [],
    lastUpdated: readString(record, 'lastUpdated', 'Reliability lastUpdated'),
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((warning): warning is string => typeof warning === 'string')
      : undefined
  };
}

function parseBucket(value: unknown): ReliabilityBucket {
  const record = requireRecord(value, 'Reliability bucket');
  return {
    bucketStart: readString(record, 'bucketStart', 'Reliability bucketStart'),
    total: readNumber(record, 'total', 'Reliability bucket total'),
    allowed: readNumber(record, 'allowed', 'Reliability bucket allowed'),
    denied: readNumber(record, 'denied', 'Reliability bucket denied')
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
