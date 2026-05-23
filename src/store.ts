import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
  ChangeInput,
  ChangeQuery,
  ChangeRecord,
  EvidenceInput,
  EvidenceQuery,
  EvidenceRecord
} from './types';

const evidenceFile = 'evidence.jsonl';
const changesFile = 'changes.jsonl';

export async function appendEvidence(storeDir: string, input: EvidenceInput): Promise<EvidenceRecord> {
  const record: EvidenceRecord = {
    id: `ev_${randomUUID()}`,
    ...input
  };

  await appendJsonLine(storeDir, evidenceFile, record);
  return record;
}

export async function listEvidence(storeDir: string, query: EvidenceQuery = {}): Promise<EvidenceRecord[]> {
  const records = await readJsonLines<EvidenceRecord>(storeDir, evidenceFile);

  return records.filter((record) => {
    if (query.profile && record.profile !== query.profile) return false;
    if (query.source && record.source !== query.source) return false;
    if (query.intent && record.intent !== query.intent) return false;
    if (query.trust && record.trust !== query.trust) return false;
    return true;
  });
}

export async function appendChange(storeDir: string, input: ChangeInput): Promise<ChangeRecord> {
  const record: ChangeRecord = {
    id: `chg_${randomUUID()}`,
    ...input
  };

  await appendJsonLine(storeDir, changesFile, record);
  return record;
}

export async function listChanges(storeDir: string, query: ChangeQuery = {}): Promise<ChangeRecord[]> {
  const records = await readJsonLines<ChangeRecord>(storeDir, changesFile);

  return records.filter((record) => {
    if (query.target && record.target !== query.target) return false;
    if (query.targetType && record.targetType !== query.targetType) return false;
    if (query.actor && record.actor !== query.actor) return false;
    return true;
  });
}

async function appendJsonLine<T>(storeDir: string, fileName: string, record: T): Promise<void> {
  await mkdir(storeDir, { recursive: true });
  const filePath = join(storeDir, fileName);
  const existing = await readFileIfExists(filePath);
  const nextContent = `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${JSON.stringify(record)}\n`;
  await writeFile(filePath, nextContent, 'utf8');
}

async function readJsonLines<T>(storeDir: string, fileName: string): Promise<T[]> {
  const content = await readFileIfExists(join(storeDir, fileName));
  if (!content.trim()) return [];

  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function readFileIfExists(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}
