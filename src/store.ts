import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type {
  ChangeInput,
  ChangeAction,
  ChangeQuery,
  ChangeRecord,
  EvidenceInput,
  EvidenceQuery,
  EvidenceRecord,
  ObjectKind,
  TamperMode,
  TrustLevel
} from './types.js';

const evidenceFile = 'evidence.jsonl';
const changesFile = 'changes.jsonl';
const evidenceFilePattern = /^evidence-\d{4}-\d{2}-\d{2}\.jsonl$/;
const changeFilePattern = /^changes-\d{4}-\d{2}-\d{2}\.jsonl$/;
const maxScalarLength = 2048;
const maxTextLength = 16000;
const injectionReplacement = '[CONTENT REMOVED - injection pattern detected]';
const injectionPattern = /\b(SYSTEM|DEVELOPER|USER|ASSISTANT|TOOL)\s*:/i;
const lastHashByFile = new Map<string, string>();
const appendQueues = new Map<string, Promise<unknown>>();
const stateQueues = new Map<string, Promise<unknown>>();
const migratedLegacyStores = new Set<string>();

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

  const record: Omit<EvidenceRecord, 'prevHash'> = {
    profile: sanitizeScalar(requireString(recordInput.profile, 'Evidence profile')),
    source: sanitizeScalar(requireString(recordInput.source, 'Evidence source')),
    intent: sanitizeScalar(requireString(recordInput.intent, 'Evidence intent')),
    summary: sanitizeText(requireString(recordInput.summary, 'Evidence summary')),
    trust: parseTrustLevel(recordInput.trust),
    capturedAt: sanitizeTimestamp(requireString(recordInput.capturedAt, 'Evidence capturedAt')),
    tokenCount: optionalNonNegativeNumber(recordInput.tokenCount, 'Evidence tokenCount'),
    estimatedCost: optionalNonNegativeNumber(recordInput.estimatedCost, 'Evidence estimatedCost'),
    links: optionalStringArray(recordInput.links, 'Evidence links')?.map(sanitizeScalar),
    tags: optionalStringArray(recordInput.tags, 'Evidence tags')?.map(sanitizeScalar),
    id: `ev_${randomUUID()}`
  };

  await migrateLegacyStore(storeDir, evidenceFile, 'evidence', evidenceFilePattern);
  return appendRotatedJsonLine(storeDir, evidenceFileForTimestamp(record.capturedAt), record, {
    pattern: evidenceFilePattern,
    legacyFile: evidenceFile
  });
}

export async function listEvidence(
  storeDir: string,
  query: EvidenceQuery = {},
  options: { tamperMode?: TamperMode } = {}
): Promise<EvidenceRecord[]> {
  await migrateLegacyStore(storeDir, evidenceFile, 'evidence', evidenceFilePattern);
  const normalizedQuery = normalizeEvidenceQuery(query);
  const effectiveDateRange = normalizedQuery.dateRange ?? defaultEvidenceDateRange();
  const records = await readEvidenceJsonLines(storeDir, { ...normalizedQuery, dateRange: effectiveDateRange }, options.tamperMode ?? 'fail');

  return records.filter((record) => {
    if (definedFilter(normalizedQuery.profile) && record.profile !== sanitizeScalar(normalizedQuery.profile)) return false;
    if (definedFilter(normalizedQuery.source) && record.source !== sanitizeScalar(normalizedQuery.source)) return false;
    if (definedFilter(normalizedQuery.intent) && record.intent !== sanitizeScalar(normalizedQuery.intent)) return false;
    if (normalizedQuery.trust && record.trust !== normalizedQuery.trust) return false;
    if (definedFilter(normalizedQuery.tag) && !record.tags?.includes(sanitizeScalar(normalizedQuery.tag))) return false;
    if (!dateInRange(record.capturedAt, effectiveDateRange)) return false;
    return true;
  });
}

export async function appendChange(storeDir: string, input: ChangeInput): Promise<ChangeRecord> {
  const recordInput = requireRecord(input, 'Change input');

  const record: Omit<ChangeRecord, 'prevHash'> = {
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

  await migrateLegacyStore(storeDir, changesFile, 'changes', changeFilePattern);
  return appendRotatedJsonLine(storeDir, changeFileForTimestamp(record.changedAt), record, {
    pattern: changeFilePattern,
    legacyFile: changesFile
  });
}

export async function listChanges(
  storeDir: string,
  query: ChangeQuery = {},
  options: { tamperMode?: TamperMode } = {}
): Promise<ChangeRecord[]> {
  await migrateLegacyStore(storeDir, changesFile, 'changes', changeFilePattern);
  const normalizedQuery = normalizeChangeQuery(query);
  const effectiveDateRange = normalizedQuery.dateRange ?? defaultEvidenceDateRange();
  const records = await readRotatedJsonLines<ChangeRecord>(
    storeDir,
    { pattern: changeFilePattern, legacyFile: changesFile, dateRange: effectiveDateRange },
    options.tamperMode ?? 'fail'
  );

  return records.filter((record) => {
    if (definedFilter(normalizedQuery.target) && record.target !== sanitizeScalar(normalizedQuery.target)) return false;
    if (normalizedQuery.targetType && record.targetType !== normalizedQuery.targetType) return false;
    if (definedFilter(normalizedQuery.actor) && record.actor !== sanitizeScalar(normalizedQuery.actor)) return false;
    if (normalizedQuery.action && record.action !== normalizedQuery.action) return false;
    if (!dateInRange(record.changedAt, effectiveDateRange)) return false;
    return true;
  });
}

export async function readJsonState<T extends object>(
  storeDir: string,
  relativePath: string,
  fallback: T,
  parse: (value: unknown) => T,
  options: { tamperMode?: TamperMode } = {}
): Promise<T & { prevHash: string; warnings?: string[] }> {
  const filePath = join(storeDir, relativePath);
  const content = await readFileIfExists(filePath);
  if (!content.trim()) {
    const normalizedFallback = parse(fallback);
    return {
      ...normalizedFallback,
      prevHash: hashStatePayload(normalizedFallback as Record<string, unknown>)
    };
  }

  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(content);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('expected JSON object state');
    }
    parsed = value as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CorruptStoreError(relativePath, 1, detail);
  }

  const normalized = parse(parsed);
  const storedHash = typeof parsed.prevHash === 'string' ? parsed.prevHash : '';
  const expectedHash = hashStatePayload(normalized as Record<string, unknown>);
  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.filter((warning): warning is string => typeof warning === 'string')
    : [];

  if (storedHash !== expectedHash) {
    if ((options.tamperMode ?? 'fail') === 'fail') {
      throw new CorruptStoreError(relativePath, 1, `expected prevHash ${expectedHash}`);
    }
    warnings.push(`JSON state hash warning in ${relativePath}: expected prevHash ${expectedHash}.`);
  }

  return {
    ...normalized,
    prevHash: storedHash || expectedHash,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

export async function writeJsonState<T extends object>(
  storeDir: string,
  relativePath: string,
  payload: T,
  parse: (value: unknown) => T = (value) => value as T
): Promise<T & { prevHash: string }> {
  const filePath = join(storeDir, relativePath);
  const previous = stateQueues.get(filePath) ?? Promise.resolve();
  const next = previous.then(() => writeJsonStateUnlocked(storeDir, relativePath, payload, parse));
  stateQueues.set(filePath, next.catch(() => undefined));
  return next;
}

export async function deleteJsonState(storeDir: string, relativePath: string): Promise<void> {
  await rm(join(storeDir, relativePath), { force: true });
}

export async function listJsonStateFiles(storeDir: string, relativeDir: string): Promise<string[]> {
  try {
    return await readdir(join(storeDir, relativeDir));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeJsonStateUnlocked<T extends object>(
  storeDir: string,
  relativePath: string,
  payload: T,
  parse: (value: unknown) => T
): Promise<T & { prevHash: string }> {
  await mkdir(dirname(join(storeDir, relativePath)), { recursive: true });
  const normalized = parse(payload);
  const recordWithHash = {
    ...normalized,
      prevHash: hashStatePayload(normalized as Record<string, unknown>)
  };
  const target = join(storeDir, relativePath);
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(recordWithHash, null, 2)}\n`, 'utf8');
  await rename(temp, target);
  return recordWithHash;
}

async function appendJsonLine<T extends Record<string, unknown>>(
  storeDir: string,
  fileName: string,
  record: T
): Promise<T & { prevHash: string }> {
  const filePath = join(storeDir, fileName);
  const previous = appendQueues.get(filePath) ?? Promise.resolve();
  const next = previous.then(() => appendJsonLineUnlocked(storeDir, fileName, record));
  appendQueues.set(filePath, next.catch(() => undefined));
  return next;
}

async function appendRotatedJsonLine<T extends Record<string, unknown>>(
  storeDir: string,
  fileName: string,
  record: T,
  options: { pattern: RegExp; legacyFile: string }
): Promise<T & { prevHash: string }> {
  const queueKey = join(storeDir, `${options.legacyFile}-rotation`);
  const previous = appendQueues.get(queueKey) ?? Promise.resolve();
  const next = previous.then(() => appendRotatedJsonLineUnlocked(storeDir, fileName, record, options));
  appendQueues.set(queueKey, next.catch(() => undefined));
  return next;
}

async function appendRotatedJsonLineUnlocked<T extends Record<string, unknown>>(
  storeDir: string,
  fileName: string,
  record: T,
  options: { pattern: RegExp; legacyFile: string }
): Promise<T & { prevHash: string }> {
  try {
    await mkdir(storeDir, { recursive: true });
    const filePath = join(storeDir, fileName);
    const prevHash = await latestRotatedRecordHash(storeDir, fileName, options);
    const recordWithHash = { ...record, prevHash };
    const line = JSON.stringify(recordWithHash);
    await appendFile(filePath, `${line}\n`, 'utf8');
    lastHashByFile.set(filePath, sha256(line));
    return recordWithHash;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new StoreWriteError(storeDir, fileName, detail);
  }
}

async function appendJsonLineUnlocked<T extends Record<string, unknown>>(
  storeDir: string,
  fileName: string,
  record: T
): Promise<T & { prevHash: string }> {
  try {
    await mkdir(storeDir, { recursive: true });
    const filePath = join(storeDir, fileName);
    const prevHash = await latestRecordHash(filePath);
    const recordWithHash = { ...record, prevHash };
    const line = JSON.stringify(recordWithHash);
    await appendFile(filePath, `${line}\n`, 'utf8');
    lastHashByFile.set(filePath, sha256(line));
    return recordWithHash;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new StoreWriteError(storeDir, fileName, detail);
  }
}

async function readJsonLines<T extends { prevHash?: string; warnings?: string[] }>(
  storeDir: string,
  fileName: string,
  tamperMode: TamperMode = 'fail'
): Promise<T[]> {
  const filePath = join(storeDir, fileName);
  const content = await readFileIfExists(filePath);
  if (!content.trim()) return [];

  const records: T[] = [];
  const lines = content.split(/\r?\n/);
  let previousLine: string | undefined;

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) continue;

    try {
      const parsed = JSON.parse(line);
      assertObjectRecord(parsed, fileName, index + 1);
      const expectedPrevHash = previousLine ? sha256(previousLine) : 'genesis';
      if (parsed.prevHash !== expectedPrevHash) {
        if (tamperMode === 'fail') {
          throw new CorruptStoreError(fileName, index + 1, `expected prevHash ${expectedPrevHash}`);
        }
        const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
        warnings.push(
          `JSONL hash chain warning in ${fileName}:${index + 1}: expected prevHash ${expectedPrevHash}.`
        );
        parsed.warnings = warnings;
      }
      records.push(parsed as T);
      previousLine = line;
    } catch (error) {
      if (error instanceof CorruptStoreError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new CorruptStoreError(fileName, index + 1, detail);
    }
  }

  lastHashByFile.set(filePath, previousLine ? sha256(previousLine) : 'genesis');
  return records;
}

async function readEvidenceJsonLines(
  storeDir: string,
  query: EvidenceQuery,
  tamperMode: TamperMode
): Promise<EvidenceRecord[]> {
  const files = await evidenceFilesForQuery(storeDir, query);
  return readJsonLineFiles<EvidenceRecord>(storeDir, files, tamperMode);
}

async function readRotatedJsonLines<T extends { prevHash?: string; warnings?: string[] }>(
  storeDir: string,
  options: { pattern: RegExp; legacyFile: string; dateRange: NonNullable<EvidenceQuery['dateRange']> },
  tamperMode: TamperMode
): Promise<T[]> {
  const files = await listStoreFiles(storeDir);
  const rotated = files
    .filter((file) => options.pattern.test(file))
    .filter((file) => rotatedFileNeededForRangeValidation(file, options.dateRange))
    .sort();
  const legacy = files.includes(options.legacyFile) ? [options.legacyFile] : [];
  return readJsonLineFiles<T>(storeDir, [...legacy, ...rotated], tamperMode);
}

async function readJsonLineFiles<T extends { prevHash?: string; warnings?: string[] }>(
  storeDir: string,
  files: string[],
  tamperMode: TamperMode
): Promise<T[]> {
  const records: T[] = [];
  let previousLine: string | undefined;

  for (const fileName of files) {
    const content = await readFileIfExists(join(storeDir, fileName));
    if (!content.trim()) continue;
    const lines = content.split(/\r?\n/);
    for (const [index, rawLine] of lines.entries()) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        assertObjectRecord(parsed, fileName, index + 1);
        const expectedPrevHash = previousLine ? sha256(previousLine) : 'genesis';
        if (parsed.prevHash !== expectedPrevHash) {
          if (tamperMode === 'fail') {
            throw new CorruptStoreError(fileName, index + 1, `expected prevHash ${expectedPrevHash}`);
          }
          const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
          warnings.push(
            `JSONL hash chain warning in ${fileName}:${index + 1}: expected prevHash ${expectedPrevHash}.`
          );
          parsed.warnings = warnings;
        }
        records.push(parsed as unknown as T);
        previousLine = line;
      } catch (error) {
        if (error instanceof CorruptStoreError) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        throw new CorruptStoreError(fileName, index + 1, detail);
      }
    }
  }

  return records;
}

async function evidenceFilesForQuery(storeDir: string, query: EvidenceQuery): Promise<string[]> {
  const files = await listStoreFiles(storeDir);
  const rotated = files.filter((file) => evidenceFilePattern.test(file)).sort();
  const range = query.dateRange;
  const selected = range
    ? rotated.filter((file) => evidenceFileNeededForRangeValidation(file, range))
    : rotated.filter((file) => evidenceFileInRange(file, defaultEvidenceDateRange()));
  const legacy = files.includes(evidenceFile) ? [evidenceFile] : [];
  return [...legacy, ...selected];
}

async function migrateLegacyStore(storeDir: string, legacyFile: string, prefix: 'evidence' | 'changes', pattern: RegExp): Promise<void> {
  const migrationKey = join(storeDir, legacyFile);
  if (migratedLegacyStores.has(migrationKey)) return;

  const legacyPath = join(storeDir, legacyFile);
  const content = await readFileIfExists(legacyPath);
  if (!content.trim()) {
    migratedLegacyStores.add(migrationKey);
    return;
  }

  const firstDate = firstRecordDate(content) ?? new Date().toISOString().slice(0, 10);
  const targetFile = `${prefix}-${firstDate}.jsonl`;
  const targetPath = join(storeDir, targetFile);
  const existingTarget = await readFileIfExists(targetPath);

  if (!existingTarget.trim()) {
    await rename(legacyPath, targetPath);
    lastHashByFile.delete(legacyPath);
    migratedLegacyStores.add(migrationKey);
    return;
  }

  for (const record of parseLegacyRecords(content)) {
    await appendRotatedJsonLine(storeDir, targetFile, record, { pattern, legacyFile });
  }
  await rm(legacyPath, { force: true });
  lastHashByFile.delete(legacyPath);
  lastHashByFile.delete(targetPath);
  migratedLegacyStores.add(migrationKey);
}

function parseLegacyRecords(content: string): Record<string, unknown>[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Legacy JSONL record must be an object.');
      }
      const record = parsed as Record<string, unknown>;
      delete record.prevHash;
      delete record.warnings;
      return record;
    });
}

function firstRecordDate(content: string): string | undefined {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as { capturedAt?: unknown; changedAt?: unknown };
      const timestamp = typeof parsed.capturedAt === 'string'
        ? parsed.capturedAt
        : typeof parsed.changedAt === 'string'
          ? parsed.changedAt
          : undefined;
      const date = timestamp?.slice(0, 10);
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function listStoreFiles(storeDir: string): Promise<string[]> {
  try {
    return await readdir(storeDir);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
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

function sanitizeTimestamp(value: string): string {
  const cleaned = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, ' ')
    .trim();
  const isoPrefix = cleaned.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/);
  return isoPrefix ? isoPrefix[0] : sanitizeScalar(value);
}

export function sanitizeText(value: string, options: { preserveLineBreaks?: boolean } = {}): string {
  const controlCharacters = options.preserveLineBreaks
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g
    : /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g;
  const cleaned = value
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(controlCharacters, ' ')
    .split('\n')
    .map((line) => injectionPattern.test(line) ? injectionReplacement : line)
    .join('\n')
    .trim();

  return (options.preserveLineBreaks ? cleaned : cleaned.replace(/\s+/g, ' ')).slice(0, maxTextLength);
}

export function detectInjectionWarnings(value: string): string[] {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap((line, index) => (
      injectionPattern.test(line)
        ? [`Potential instruction injection pattern detected on line ${index + 1}.`]
        : []
    ));
}

export function stripInjectionLines(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !injectionPattern.test(line))
    .join('\n');
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
    tag: optionalString(record.tag, 'Evidence query tag'),
    dateRange: normalizeDateRange(record.dateRange, 'Evidence query dateRange')
  };
}

function normalizeChangeQuery(query: ChangeQuery): ChangeQuery {
  const record = requireRecord(query, 'Change query');

  return {
    target: optionalString(record.target, 'Change query target'),
    targetType: record.targetType === undefined ? undefined : parseObjectKind(record.targetType),
    actor: optionalString(record.actor, 'Change query actor'),
    action: record.action === undefined ? undefined : parseChangeAction(record.action),
    dateRange: normalizeDateRange(record.dateRange, 'Change query dateRange')
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

function optionalNonNegativeNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
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

async function latestRecordHash(filePath: string): Promise<string> {
  const cached = lastHashByFile.get(filePath);
  if (cached) return cached;

  const content = await readFileIfExists(filePath);
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return 'genesis';
  const hash = sha256(lines[lines.length - 1]);
  lastHashByFile.set(filePath, hash);
  return hash;
}

async function latestRotatedRecordHash(
  storeDir: string,
  fileName: string,
  options: { pattern: RegExp; legacyFile: string }
): Promise<string> {
  const filePath = join(storeDir, fileName);
  const cached = lastHashByFile.get(filePath);
  if (cached) return cached;

  const currentHash = await latestRecordHash(filePath);
  if (currentHash !== 'genesis') return currentHash;

  const files = (await listStoreFiles(storeDir))
    .filter((file) => file === options.legacyFile || options.pattern.test(file))
    .filter((file) => file < fileName)
    .sort();
  for (const previousFile of files.reverse()) {
    const hash = await latestRecordHash(join(storeDir, previousFile));
    if (hash !== 'genesis') return hash;
  }
  return 'genesis';
}

function evidenceFileForTimestamp(value: string): string {
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) {
    throw new Error('Evidence capturedAt must start with an ISO date.');
  }
  return `evidence-${date}.jsonl`;
}

function changeFileForTimestamp(value: string): string {
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) {
    throw new Error('Change changedAt must start with an ISO date.');
  }
  return `changes-${date}.jsonl`;
}

function normalizeDateRange(value: unknown, label: string): EvidenceQuery['dateRange'] {
  if (value === undefined) return undefined;
  const record = requireRecord(value, label);
  return {
    from: optionalDate(record.from, `${label} from`),
    to: optionalDate(record.to, `${label} to`)
  };
}

function optionalDate(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const text = requireString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00.000Z`))) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
  return text;
}

function dateInRange(timestamp: string, range: EvidenceQuery['dateRange']): boolean {
  if (!range) return true;
  const date = timestamp.slice(0, 10);
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

function evidenceFileInRange(fileName: string, range: Required<NonNullable<EvidenceQuery['dateRange']>> | NonNullable<EvidenceQuery['dateRange']>): boolean {
  const date = fileName.slice('evidence-'.length, 'evidence-YYYY-MM-DD'.length);
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

function evidenceFileNeededForRangeValidation(fileName: string, range: NonNullable<EvidenceQuery['dateRange']>): boolean {
  const date = rotatedDate(fileName);
  if (range.to && date > range.to) return false;
  return true;
}

function rotatedFileNeededForRangeValidation(fileName: string, range: NonNullable<EvidenceQuery['dateRange']>): boolean {
  const date = rotatedDate(fileName);
  if (range.to && date > range.to) return false;
  return true;
}

function rotatedDate(fileName: string): string {
  const match = fileName.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? '0000-00-00';
}

function defaultEvidenceDateRange(): Required<NonNullable<EvidenceQuery['dateRange']>> {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  const from = fromDate.toISOString().slice(0, 10);
  return { from, to };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashStatePayload(value: Record<string, unknown>): string {
  return sha256(stableStringify(stripHashFields(value)));
}

function stripHashFields(value: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...value };
  delete clone.prevHash;
  delete clone.warnings;
  return clone;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
