import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { initBrainDir, readBrainIndex } from './brain.js';
import { listChanges, listEvidence, sanitizeText } from './store.js';
import type { ChangeRecord, DigestResult, EvidenceRecord } from './types.js';

export async function generateDailyDigest(options: {
  profile: string;
  date?: string;
  storeDir: string;
  brainDir: string;
}): Promise<DigestResult> {
  const date = options.date ?? todayString();
  await initBrainDir(options.brainDir);
  const evidence = (await listEvidence(options.storeDir, { profile: options.profile }))
    .filter((record) => record.capturedAt.startsWith(date));
  const changes = (await listChanges(options.storeDir))
    .filter((record) => record.changedAt.startsWith(date));
  const index = await readBrainIndex(options.brainDir);
  const updatedEntities = index.entities.filter((entity) => entity.lastUpdated.startsWith(date));
  const digestPath = join(options.brainDir, 'digest', 'daily', `${date}-${options.profile}.md`);
  const summary = `${evidence.length} evidence, ${changes.length} changes, ${updatedEntities.length} brain updates.`;
  const markdown = renderDailyDigest(options.profile, date, evidence, changes, updatedEntities, summary);

  await mkdir(join(options.brainDir, 'digest', 'daily'), { recursive: true });
  await writeFile(digestPath, markdown, 'utf8');

  return {
    profile: options.profile,
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
  const weekStart = options.weekStart ?? todayString();
  await initBrainDir(options.brainDir);
  const dailyDir = join(options.brainDir, 'digest', 'daily');
  const weeklyDir = join(options.brainDir, 'digest', 'weekly');
  await mkdir(weeklyDir, { recursive: true });
  const dates = sevenDayWindow(weekStart);
  const dateSet = new Set(dates);
  const evidence = (await listEvidence(options.storeDir, { profile: options.profile }))
    .filter((record) => dateSet.has(record.capturedAt.slice(0, 10)));
  const changes = (await listChanges(options.storeDir))
    .filter((record) => dateSet.has(record.changedAt.slice(0, 10)));
  const index = await readBrainIndex(options.brainDir);
  const updatedEntities = index.entities.filter((entity) => dateSet.has(entity.lastUpdated.slice(0, 10)));
  const dailyFiles = await listFilesIfExists(dailyDir);
  const matchingFiles = dailyFiles
    .filter((fileName) => dates.some((date) => fileName === `${date}-${options.profile}.md`))
    .sort();
  const sections = await Promise.all(
    matchingFiles.map(async (fileName) => `## ${fileName.replace(`-${options.profile}.md`, '')}\n\n${await readFile(join(dailyDir, fileName), 'utf8')}`)
  );
  const digestPath = join(weeklyDir, `${weekStart}-${options.profile}.md`);
  const summary = `${evidence.length} evidence, ${changes.length} changes, ${updatedEntities.length} brain updates, ${matchingFiles.length} daily digests rolled up.`;
  const markdown = `# Weekly digest: ${options.profile} - ${weekStart}\n\n${sections.join('\n\n') || 'No daily digests found.'}\n\n## Summary\n\n${summary}\n`;

  await writeFile(digestPath, markdown, 'utf8');

  return {
    profile: options.profile,
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
  summary: string
): string {
  return `# Daily digest: ${profile} - ${date}

## Evidence collected

${evidence.map((record) => `- [${record.trust}] ${sanitizeText(record.summary)} (source: ${record.source})`).join('\n') || '- None'}

## Changes recorded

${changes.map((record) => `- ${record.action} ${record.target}: ${sanitizeText(record.reason)} (by ${record.actor})`).join('\n') || '- None'}

## Brain entities updated

${entities.map((entity) => `- ${entity.name} - updated by ${entity.lastUpdatedBy}`).join('\n') || '- None'}

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
