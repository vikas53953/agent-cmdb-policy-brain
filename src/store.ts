import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type {
  ChangeInput,
  ChangeAction,
  ChangeQuery,
  ChangeRecord,
  EvidenceInput,
  EvidenceQuery,
  EvidenceRecord,
  ObjectKind,
  TrustLevel
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

export class StoreWriteError extends Error {
  constructor(storeDir: string, fileName: string, detail: string) {
    super(`Failed to write JSONL store ${join(storeDir, fileName)}: ${detail}`);
    this.name = 'StoreWriteError';
  }
}

export async function appendEvidence(storeDir: string, input: EvidenceInput): Promise<EvidenceRecord> {
  const recordInput = requireRecord(input, 'Evidence input');

  const record: EvidenceRecord = {
    profile: sanitizeScalar(requireString(recordInput.profile, 'Evidence profile')),
    source: sanitizeScalar(requireString(recordInput.source, 'Evidence source')),
    intent: sanitizeScalar(requireString(recordInput.intent, 'Evidence intent')),
    summary: sanitizeText(requireString(recordInput.summary, 'Evidence summary')),
    trust: parseTrustLevel(recordInput.trust),
    capturedAt: sanitizeScalar(requireString(recordInput.capturedAt, 'Evidence capturedAt')),
    links: optionalStringArray(recordInput.links, 'Evidence links')?.map(sanitizeScalar),
    tags: optionalStringArray(recordInput.tags, 'Evidence tags')?.map(sanitizeScalar),
    id: `ev_${randomUUID()}`
  };

  await appendJsonLine(storeDir, evidenceFile, record);
  return record;
}

export async function listEvidence(storeDir: string, query: EvidenceQuery = {}): Promise<EvidenceRecord[]> {
  const normalizedQuery = normalizeEvidenceQuery(query);
  const records = await readJsonLines<EvidenceRecord>(storeDir, evidenceFile);

  return records.filter((record) => {
    if (definedFilter(normalizedQuery.profile) && record.profile !== sanitizeScalar(normalizedQuery.profile)) return false;
    if (definedFilter(normalizedQuery.source) && record.source !== sanitizeScalar(normalizedQuery.source)) return false;
    if (definedFilter(normalizedQuery.intent) && record.intent !== sanitizeScalar(normalizedQuery.intent)) return false;
    if (normalizedQuery.trust && record.trust !== normalizedQuery.trust) return false;
    if (definedFilter(normalizedQuery.tag) && !record.tags?.includes(sanitizeScalar(normalizedQuery.tag))) return false;
    return true;
  });
}

export async function appendChange(storeDir: string, input: ChangeInput): Promise<ChangeRecord> {
  const recordInput = requireRecord(input, 'Change input');

  const record: ChangeRecord = {
    target: sanitizeScalar(requireString(recordInput.target, 'Change target')),
    targetType: parseObjectKind(recordInput.targetType),
    action: parseChangeAction(recordInput.action),
    actor: sanitizeScalar(requireString(recordInput.actor, 'Change actor')),
    reason: sanitizeText(requireString(recordInput.reason, 'Change reason')),
    changedAt: sanitizeScalar(requireString(recordInput.changedAt, 'Change changedAt')),
    before: sanitizeJsonValue(recordInput.before),
    after: sanitizeJsonValue(recordInput.after),
    id: `chg_${randomUUID()}`
  };

  await appendJsonLine(storeDir, changesFile, record);
  return record;
}

export async function listChanges(storeDir: string, query: ChangeQuery = {}): Promise<ChangeRecord[]> {
  const normalizedQuery = normalizeChangeQuery(query);
  const records = await readJsonLines<ChangeRecord>(storeDir, changesFile);

  return records.filter((record) => {
    if (definedFilter(normalizedQuery.target) && record.target !== sanitizeScalar(normalizedQuery.target)) return false;
    if (normalizedQuery.targetType && record.targetType !== normalizedQuery.targetType) return false;
    if (definedFilter(normalizedQuery.actor) && record.actor !== sanitizeScalar(normalizedQuery.actor)) return false;
    if (normalizedQuery.action && record.action !== normalizedQuery.action) return false;
    return true;
  });
}

async function appendJsonLine<T>(storeDir: string, fileName: string, record: T): Promise<void> {
  try {
    await mkdir(storeDir, { recursive: true });
    await appendFile(join(storeDir, fileName), `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new StoreWriteError(storeDir, fileName, detail);
  }
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

function normalizeEvidenceQuery(query: EvidenceQuery): EvidenceQuery {
  const record = requireRecord(query, 'Evidence query');

  return {
    profile: optionalString(record.profile, 'Evidence query profile'),
    source: optionalString(record.source, 'Evidence query source'),
    intent: optionalString(record.intent, 'Evidence query intent'),
    trust: record.trust === undefined ? undefined : parseTrustLevel(record.trust),
    tag: optionalString(record.tag, 'Evidence query tag')
  };
}

function normalizeChangeQuery(query: ChangeQuery): ChangeQuery {
  const record = requireRecord(query, 'Change query');

  return {
    target: optionalString(record.target, 'Change query target'),
    targetType: record.targetType === undefined ? undefined : parseObjectKind(record.targetType),
    actor: optionalString(record.actor, 'Change query actor'),
    action: record.action === undefined ? undefined : parseChangeAction(record.action)
  };
}

function parseTrustLevel(value: unknown): TrustLevel {
  const values: TrustLevel[] = ['high', 'medium', 'low'];
  const trust = requireString(value, 'Evidence trust');
  if (!values.includes(trust as TrustLevel)) {
    throw new Error(`Invalid trust level: ${trust}. Valid values: ${values.join(', ')}.`);
  }
  return trust as TrustLevel;
}

function parseObjectKind(value: unknown): ObjectKind {
  const values: ObjectKind[] = ['profile', 'source', 'tool', 'job', 'memory', 'policy', 'workspace'];
  const kind = requireString(value, 'Change targetType');
  if (!values.includes(kind as ObjectKind)) {
    throw new Error(`Invalid object kind: ${kind}. Valid values: ${values.join(', ')}.`);
  }
  return kind as ObjectKind;
}

function parseChangeAction(value: unknown): ChangeAction {
  const values: ChangeAction[] = ['create', 'update', 'pause', 'resume', 'delete', 'verify'];
  const action = requireString(value, 'Change action');
  if (!values.includes(action as ChangeAction)) {
    throw new Error(`Invalid change action: ${action}. Valid values: ${values.join(', ')}.`);
  }
  return action as ChangeAction;
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value.map((item) => requireString(item, label));
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, label);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertObjectRecord(value: unknown, fileName: string, lineNumber: number): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CorruptStoreError(fileName, lineNumber, 'expected JSON object record');
  }
}

function definedFilter(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}
