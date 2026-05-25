import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initBrainDir, readBrainIndex } from './brain.js';
import { getCostSummary } from './cost.js';
import { calculateReliability } from './reliability.js';
import { listChanges, listEvidence, sanitizeText } from './store.js';
import type { ChangeRecord, ControlPlane, CostSummary, DigestResult, EvidenceRecord, ReliabilityResult } from './types.js';

export async function generateDailyDigest(options: {
  profile: string;
  date?: string;
  storeDir: string;
  brainDir: string;
  controlPlane?: ControlPlane;
}): Promise<DigestResult> {
  const date = normalizeDigestDate(options.date ?? todayString(), 'date');
  const profile = normalizeDigestProfile(options.profile);
  await initBrainDir(options.brainDir);
  const evidence = await listEvidence(options.storeDir, { profile, dateRange: { from: date, to: date } });
  const changes = (await listChanges(options.storeDir))
    .filter((record) => record.changedAt.startsWith(date));
  const index = await readBrainIndex(options.brainDir);
  const updatedEntities = index.entities.filter((entity) => entity.lastUpdated.startsWith(date));
  const digestPath = join(options.brainDir, 'digest', 'daily', `${date}-${profile}.md`);
  const summary = `${evidence.length} evidence, ${changes.length} changes, ${updatedEntities.length} brain updates.`;
  const reliability = options.controlPlane ? await calculateReliability(options.controlPlane, options.storeDir, profile) : undefined;
  const cost = options.controlPlane ? await getCostSummary(options.controlPlane, options.storeDir, profile, date) : undefined;
  const markdown = renderDailyDigest(profile, date, evidence, changes, updatedEntities, summary, reliability, cost);

  await mkdir(join(options.brainDir, 'digest', 'daily'), { recursive: true });
  await writeFile(digestPath, markdown, 'utf8');

  return {
    profile,
    date,
    evidenceCount: evidence.length,
    changesCount: changes.length,
    entitiesUpdated: updatedEntities.map((entity) => entity.id),
    digestPath,
    summary
  };
}

export async function generateWeeklyDigest(options: {
  profile: string;
  weekStart?: string;
  storeDir: string;
  brainDir: string;
}): Promise<DigestResult> {
  const weekStart = normalizeDigestDate(options.weekStart ?? todayString(), 'weekStart');
  const profile = normalizeDigestProfile(options.profile);
  await initBrainDir(options.brainDir);
  const dailyDir = join(options.brainDir, 'digest', 'daily');
  const weeklyDir = join(options.brainDir, 'digest', 'weekly');
  await mkdir(weeklyDir, { recursive: true });
  const dates = sevenDayWindow(weekStart);
  const dateSet = new Set(dates);
  const evidence = (await listEvidence(options.storeDir, { profile, dateRange: { from: dates[0], to: dates[dates.length - 1] } }))
    .filter((record) => dateSet.has(record.capturedAt.slice(0, 10)));
  const changes = (await listChanges(options.storeDir))
    .filter((record) => dateSet.has(record.changedAt.slice(0, 10)));
  const index = await readBrainIndex(options.brainDir);
  const updatedEntities = index.entities.filter((entity) => dateSet.has(entity.lastUpdated.slice(0, 10)));
  const dailyFiles = await listFilesIfExists(dailyDir);
  const matchingFiles = dailyFiles
    .filter((fileName) => dates.some((date) => fileName === `${date}-${profile}.md`))
    .sort();
  const sections = await Promise.all(
    matchingFiles.map(async (fileName) => `## ${fileName.replace(`-${profile}.md`, '')}\n\n${await readFile(join(dailyDir, fileName), 'utf8')}`)
  );
  const digestPath = join(weeklyDir, `${weekStart}-${profile}.md`);
  const summary = `${evidence.length} evidence, ${changes.length} changes, ${updatedEntities.length} brain updates, ${matchingFiles.length} daily digests rolled up.`;
  const markdown = `# Weekly digest: ${profile} - ${weekStart}\n\n${sections.join('\n\n') || 'No daily digests found.'}\n\n## Summary\n\n${summary}\n`;

  await writeFile(digestPath, markdown, 'utf8');

  return {
    profile,
    date: weekStart,
    evidenceCount: evidence.length,
    changesCount: changes.length,
    entitiesUpdated: updatedEntities.map((entity) => entity.id),
    digestPath,
    summary
  };
}

function renderDailyDigest(
  profile: string,
  date: string,
  evidence: EvidenceRecord[],
  changes: ChangeRecord[],
  entities: Array<{ id: string; name: string; lastUpdatedBy: string }>,
  summary: string,
  reliability?: ReliabilityResult,
  cost?: CostSummary
): string {
  return `# Daily digest: ${profile} - ${date}

## Evidence collected

${evidence.map((record) => `- [${record.trust}] ${sanitizeText(record.summary)} (source: ${record.source})`).join('\n') || '- None'}

## Changes recorded

${changes.map((record) => `- ${record.action} ${record.target}: ${sanitizeText(record.reason)} (by ${record.actor})`).join('\n') || '- None'}

## Brain entities updated

${entities.map((entity) => `- ${entity.name} - updated by ${entity.lastUpdatedBy}`).join('\n') || '- None'}

## Reliability

${reliability ? `- Preflight allow rate: ${(reliability.actual * 100).toFixed(2)}% (target ${(reliability.target * 100).toFixed(2)}%)
- Within budget: ${reliability.withinBudget ? 'yes' : 'no'}
- Decisions: ${reliability.totalDecisions}` : '- Not configured'}

## Cost

${cost ? `- Calls: ${cost.totalCalls}
- Tokens: ${cost.totalTokens}
- Estimated cost: $${cost.totalCost.toFixed(4)}` : '- Not configured'}

## Summary

${summary}
`;
}

function sevenDayWindow(start: string): string[] {
  const startDate = new Date(`${start}T00:00:00.000Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(startDate);
    date.setUTCDate(startDate.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function normalizeDigestDate(value: string, label: 'date' | 'weekStart'): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Digest ${label} must be YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Digest ${label} must be YYYY-MM-DD.`);
  }
  return value;
}

function normalizeDigestProfile(value: string): string {
  const profile = sanitizeText(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(profile)) {
    throw new Error('Digest profile must be a safe filename segment.');
  }
  return profile;
}

async function listFilesIfExists(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}
