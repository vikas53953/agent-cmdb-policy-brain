import { listEvidence } from './store.js';
import { sourceRefs } from './config-access.js';
import type { ControlPlane, CostSummary } from './types.js';

export async function getCostSummary(
  controlPlane: ControlPlane,
  storeDir: string,
  profile: string,
  date = new Date().toISOString().slice(0, 10)
): Promise<CostSummary> {
  const normalizedProfile = safeSegment(profile, 'Cost profile');
  const normalizedDate = safeDate(date);
  const records = (await listEvidence(storeDir, { profile: normalizedProfile }))
    .filter((record) => record.capturedAt.startsWith(normalizedDate));
  const bySource = new Map<string, { sourceId: string; calls: number; tokens: number; cost: number }>();

  for (const record of records) {
    const source = bySource.get(record.source) ?? {
      sourceId: record.source,
      calls: 0,
      tokens: 0,
      cost: 0
    };
    source.calls += 1;
    source.tokens += record.tokenCount ?? 0;
    source.cost += record.estimatedCost ?? sourceCost(controlPlane, record.source);
    bySource.set(record.source, source);
  }

  const sources = [...bySource.values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  return {
    profile: normalizedProfile,
    date: normalizedDate,
    totalCalls: sources.reduce((sum, source) => sum + source.calls, 0),
    totalTokens: sources.reduce((sum, source) => sum + source.tokens, 0),
    totalCost: sources.reduce((sum, source) => sum + source.cost, 0),
    bySource: sources
  };
}

function sourceCost(controlPlane: ControlPlane, sourceId: string): number {
  return sourceRefs(controlPlane).find((source) => source.id === sourceId)?.costPerCall ?? 0;
}

function safeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error(`${label} must be a safe identifier.`);
  }
  return value;
}

function safeDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Cost date must be YYYY-MM-DD.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Cost date must be YYYY-MM-DD.');
  }
  return value;
}
