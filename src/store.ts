import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
  ChangeInput,
  ChangeQuery,
  ChangeRecord,
  EvidenceInput,
  EvidenceQuery,
  EvidenceRecord
} from './types.js';

const evidenceFile = 'evidence.jsonl';
const changesFile = 'changes.jsonl';
const maxScalarLength = 2048;
const maxTextLength = 16000;

export class CorruptStoreError extends Error {
  constructor(fileName: string, lineNumber: number, detail: string) {
    super(`Corrupt JSONL store ${fileName}:${lineNumber}: ${detail}`);
    this.name = 'CorruptStoreError';
  }
}

export async function appendEvidence(storeDir: string, input: EvidenceInput): Promise<EvidenceRecord> {
  const record: EvidenceRecord = {
    profile: sanitizeScalar(input.profile),
    source: sanitizeScalar(input.source),
    intent: sanitizeScalar(input.intent),
    summary: sanitizeText(input.summary),
    trust: input.trust,
    capturedAt: sanitizeScalar(input.capturedAt),
    links: input.links?.map(sanitizeScalar),
    tags: input.tags?.map(sanitizeScalar),
    id: `ev_${randomUUID()}`
  };

  await appendJsonLine(storeDir, evidenceFile, record);
  return record;
}

export async function listEvidence(storeDir: string, query: EvidenceQuery = {}): Promise<EvidenceRecord[]> {
  const records = await readJsonLines<EvidenceRecord>(storeDir, evidenceFile);

  return records.filter((record) => {
    if (definedFilter(query.profile) && record.profile !== sanitizeScalar(query.profile)) return false;
    if (definedFilter(query.source) && record.source !== sanitizeScalar(query.source)) return false;
    if (definedFilter(query.intent) && record.intent !== sanitizeScalar(query.intent)) return false;
    if (query.trust && record.trust !== query.trust) return false;
    if (definedFilter(query.tag) && !record.tags?.includes(sanitizeScalar(query.tag))) return false;
    return true;
  });
}

export async function appendChange(storeDir: string, input: ChangeInput): Promise<ChangeRecord> {
  const record: ChangeRecord = {
    target: sanitizeScalar(input.target),
    targetType: input.targetType,
    action: input.action,
    actor: sanitizeScalar(input.actor),
    reason: sanitizeText(input.reason),
    changedAt: sanitizeScalar(input.changedAt),
    before: sanitizeJsonValue(input.before),
    after: sanitizeJsonValue(input.after),
    id: `chg_${randomUUID()}`
  };

  await appendJsonLine(storeDir, changesFile, record);
  return record;
}

export async function listChanges(storeDir: string, query: ChangeQuery = {}): Promise<ChangeRecord[]> {
  const records = await readJsonLines<ChangeRecord>(storeDir, changesFile);

  return records.filter((record) => {
    if (definedFilter(query.target) && record.target !== sanitizeScalar(query.target)) return false;
    if (query.targetType && record.targetType !== query.targetType) return false;
    if (definedFilter(query.actor) && record.actor !== sanitizeScalar(query.actor)) return false;
    if (query.action && record.action !== query.action) return false;
    return true;
  });
}

async function appendJsonLine<T>(storeDir: string, fileName: string, record: T): Promise<void> {
  await mkdir(storeDir, { recursive: true });
  await appendFile(join(storeDir, fileName), `${JSON.stringify(record)}\n`, 'utf8');
}

async function readJsonLines<T>(storeDir: string, fileName: string): Promise<T[]> {
  const content = await readFileIfExists(join(storeDir, fileName));
  if (!content.trim()) return [];

  const records: T[] = [];
  const lines = content.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) continue;

    try {
      const parsed = JSON.parse(line);
      assertObjectRecord(parsed, fileName, index + 1);
      records.push(parsed as T);
    } catch (error) {
      if (error instanceof CorruptStoreError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new CorruptStoreError(fileName, index + 1, detail);
    }
  }

  return records;
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

function sanitizeScalar(value: string): string {
  return sanitizeText(value).slice(0, maxScalarLength);
}

function sanitizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, '')
    .replace(/\b(SYSTEM|DEVELOPER|USER|ASSISTANT|TOOL)\s*:/gi, '[SANITIZED_INSTRUCTION]:')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxTextLength);
}

function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [sanitizeScalar(key), sanitizeJsonValue(nestedValue)])
    );
  }
  return value;
}

function assertObjectRecord(value: unknown, fileName: string, lineNumber: number): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CorruptStoreError(fileName, lineNumber, 'expected JSON object record');
  }
}

function definedFilter(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}
