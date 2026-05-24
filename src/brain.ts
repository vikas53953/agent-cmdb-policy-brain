import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { appendChange, detectInjectionWarnings, sanitizeText } from './store.js';
import type {
  BrainEntity,
  BrainEntityKind,
  BrainIndex,
  BrainReadResult,
  BrainSearchQuery,
  BrainWriteInput,
  TrustLevel
} from './types.js';

const staleThresholdMs = 604_800_000;
const entityIdPattern = /^[a-z0-9][a-z0-9-]*$/;
const brainVersion = '1.0';
const lockStaleMs = 30_000;
const lockWaitMs = 5_000;

const brainDirs = [
  'entities/people',
  'entities/companies',
  'entities/topics',
  'entities/tools',
  'entities/projects',
  'decisions',
  'digest/daily',
  'digest/weekly'
];

export async function initBrainDir(brainDir: string): Promise<void> {
  await Promise.all(brainDirs.map((dir) => mkdir(resolve(brainDir, dir), { recursive: true })));

  try {
    await readFile(indexPath(brainDir), 'utf8');
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      await writeBrainIndex(brainDir, {
        version: brainVersion,
        updatedAt: new Date().toISOString(),
        entities: []
      });
      return;
    }
    throw error;
  }
}

export async function readBrainIndex(brainDir: string): Promise<BrainIndex> {
  return readBrainIndexUnlocked(brainDir);
}

async function readBrainIndexUnlocked(brainDir: string): Promise<BrainIndex> {
  try {
    const content = await readFile(indexPath(brainDir), 'utf8');
    return parseBrainIndex(JSON.parse(content));
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return {
        version: brainVersion,
        updatedAt: new Date().toISOString(),
        entities: []
      };
    }
    throw error;
  }
}

export async function writeBrainIndex(brainDir: string, index: BrainIndex): Promise<void> {
  await withIndexLock(brainDir, () => writeBrainIndexUnlocked(brainDir, index));
}

async function writeBrainIndexUnlocked(brainDir: string, index: BrainIndex): Promise<void> {
  await mkdir(brainDir, { recursive: true });
  const normalizedIndex = parseBrainIndex(index);
  const target = indexPath(brainDir);
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(normalizedIndex, null, 2)}\n`, 'utf8');
  await rename(temp, target);
}

export async function readEntity(brainDir: string, entityId: string): Promise<BrainReadResult> {
  const normalizedId = normalizeEntityId(entityId);
  const index = await readBrainIndex(brainDir);
  const entity = index.entities.find((candidate) => candidate.id === normalizedId);

  if (!entity) {
    throw new Error(`Unknown brain entity: ${normalizedId}.`);
  }

  const content = await readFile(resolveEntityPath(brainDir, entity.filePath), 'utf8');
  const ageMs = Math.max(0, Date.now() - new Date(entity.lastUpdated).getTime());
  const warnings = detectInjectionWarnings(content);

  return {
    entity,
    content,
    ageMs,
    stale: ageMs > staleThresholdMs,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

export async function createEntity(
  brainDir: string,
  storeDir: string,
  entity: Omit<BrainEntity, 'lastUpdated' | 'lastUpdatedBy'>,
  content: string,
  actor: string
): Promise<BrainEntity> {
  await initBrainDir(brainDir);
  const normalizedEntity = normalizeNewEntity(entity, actor);
  await withIndexLock(brainDir, async () => {
    const index = await readBrainIndexUnlocked(brainDir);

    if (index.entities.some((candidate) => candidate.id === normalizedEntity.id)) {
      throw new Error(`Brain entity already exists: ${normalizedEntity.id}.`);
    }
    if (index.entities.some((candidate) => candidate.filePath === normalizedEntity.filePath)) {
      throw new Error(`Brain entity filePath already exists: ${normalizedEntity.filePath}.`);
    }

    const entityPath = resolveEntityPath(brainDir, normalizedEntity.filePath);
    await mkdir(dirname(entityPath), { recursive: true });
    await writeNewEntityFile(entityPath, normalizedEntity.filePath, sanitizeMarkdown(content));

    index.entities.push(normalizedEntity);
    index.updatedAt = normalizedEntity.lastUpdated;
    await writeBrainIndexUnlocked(brainDir, index);
  });
  await appendChange(storeDir, {
    target: `brain.${normalizedEntity.id}`,
    targetType: 'memory',
    action: 'create',
    actor,
    reason: `Created brain entity ${normalizedEntity.id}.`,
    changedAt: normalizedEntity.lastUpdated,
    after: normalizedEntity
  });

  return normalizedEntity;
}

export async function writeEntity(
  brainDir: string,
  storeDir: string,
  input: BrainWriteInput
): Promise<BrainEntity> {
  await initBrainDir(brainDir);
  const normalizedInput = normalizeWriteInput(input);
  let updatedEntity: BrainEntity | undefined;
  await withIndexLock(brainDir, async () => {
    const index = await readBrainIndexUnlocked(brainDir);
    const entityIndex = index.entities.findIndex((candidate) => candidate.id === normalizedInput.entityId);

    if (entityIndex === -1) {
      throw new Error(`Unknown brain entity: ${normalizedInput.entityId}.`);
    }

    const entity = index.entities[entityIndex];
    const entityPath = resolveEntityPath(brainDir, entity.filePath);
    const sanitizedContent = sanitizeMarkdown(normalizedInput.content);
    const nextContent = normalizedInput.appendOnly
      ? `${await readTextIfExists(entityPath)}\n---\n## Update - ${new Date().toISOString()}\n\n${sanitizedContent}`.trim()
      : sanitizedContent;

    await writeFile(entityPath, nextContent, 'utf8');

    updatedEntity = {
      ...entity,
      lastUpdated: new Date().toISOString(),
      lastUpdatedBy: normalizedInput.actor
    };
    index.entities[entityIndex] = updatedEntity;
    index.updatedAt = updatedEntity.lastUpdated;
    await writeBrainIndexUnlocked(brainDir, index);
  });

  if (!updatedEntity) {
    throw new Error(`Unknown brain entity: ${normalizedInput.entityId}.`);
  }

  await appendChange(storeDir, {
    target: `brain.${updatedEntity.id}`,
    targetType: 'memory',
    action: 'update',
    actor: normalizedInput.actor,
    reason: normalizedInput.reason,
    changedAt: updatedEntity.lastUpdated,
    after: {
      appendOnly: Boolean(normalizedInput.appendOnly),
      entity: updatedEntity
    }
  });

  return updatedEntity;
}

export async function deleteEntity(
  brainDir: string,
  storeDir: string,
  entityId: string,
  actor: string,
  reason: string
): Promise<void> {
  await initBrainDir(brainDir);
  const normalizedId = normalizeEntityId(entityId);
  let deletedEntity: BrainEntity | undefined;
  let changedAt = '';
  await withIndexLock(brainDir, async () => {
    const index = await readBrainIndexUnlocked(brainDir);
    const entity = index.entities.find((candidate) => candidate.id === normalizedId);

    if (!entity) {
      throw new Error(`Unknown brain entity: ${normalizedId}.`);
    }

    await rm(resolveEntityPath(brainDir, entity.filePath), { force: true });
    index.entities = index.entities.filter((candidate) => candidate.id !== normalizedId);
    index.updatedAt = new Date().toISOString();
    await writeBrainIndexUnlocked(brainDir, index);
    deletedEntity = entity;
    changedAt = index.updatedAt;
  });

  if (!deletedEntity) {
    throw new Error(`Unknown brain entity: ${normalizedId}.`);
  }

  await appendChange(storeDir, {
    target: `brain.${normalizedId}`,
    targetType: 'memory',
    action: 'delete',
    actor: sanitizeText(actor),
    reason: sanitizeText(reason),
    changedAt,
    before: deletedEntity
  });
}

export async function searchEntities(brainDir: string, query: BrainSearchQuery): Promise<BrainEntity[]> {
  const index = await readBrainIndex(brainDir);
  const normalizedQuery = normalizeSearchQuery(query);
  const keyword = normalizedQuery.keyword?.toLowerCase();

  return index.entities
    .filter((entity) => {
      if (normalizedQuery.kind && entity.kind !== normalizedQuery.kind) return false;
      if (normalizedQuery.tag && !entity.tags.includes(normalizedQuery.tag)) return false;
      if (normalizedQuery.updatedAfter && entity.lastUpdated < normalizedQuery.updatedAfter) return false;
      if (normalizedQuery.updatedBefore && entity.lastUpdated > normalizedQuery.updatedBefore) return false;
      if (keyword) {
        const haystack = `${entity.name} ${entity.summary} ${entity.tags.join(' ')}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    })
    .sort((left, right) => right.lastUpdated.localeCompare(left.lastUpdated));
}

export async function listEntities(brainDir: string, kind?: BrainEntityKind): Promise<BrainEntity[]> {
  const index = await readBrainIndex(brainDir);

  return index.entities
    .filter((entity) => !kind || entity.kind === normalizeEntityKind(kind))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeNewEntity(
  entity: Omit<BrainEntity, 'lastUpdated' | 'lastUpdatedBy'>,
  actor: string
): BrainEntity {
  const record = requireRecord(entity, 'Brain entity');
  const now = new Date().toISOString();
  const normalized: BrainEntity = {
    id: normalizeEntityId(readString(record, 'id', 'Brain entity id')),
    kind: normalizeEntityKind(readString(record, 'kind', 'Brain entity kind')),
    name: sanitizeText(readString(record, 'name', 'Brain entity name')),
    filePath: sanitizeFilePath(readString(record, 'filePath', 'Brain entity filePath')),
    tags: readStringArray(record, 'tags', 'Brain entity tags').map((tag) => sanitizeText(tag)),
    trust: normalizeTrustLevel(readString(record, 'trust', 'Brain entity trust')),
    lastUpdated: now,
    lastUpdatedBy: sanitizeText(actor),
    summary: sanitizeText(readString(record, 'summary', 'Brain entity summary')),
    relatedEntities: optionalStringArray(record, 'relatedEntities', 'Brain related entities')?.map(normalizeEntityId)
  };

  return normalized;
}

function normalizeWriteInput(input: BrainWriteInput): BrainWriteInput {
  const record = requireRecord(input, 'Brain write input');

  return {
    entityId: normalizeEntityId(readString(record, 'entityId', 'Brain write entityId')),
    content: readString(record, 'content', 'Brain write content'),
    actor: sanitizeText(readString(record, 'actor', 'Brain write actor')),
    reason: sanitizeText(readString(record, 'reason', 'Brain write reason')),
    appendOnly: Boolean(record.appendOnly)
  };
}

function normalizeSearchQuery(query: BrainSearchQuery): BrainSearchQuery {
  const record = requireRecord(query ?? {}, 'Brain search query');

  return {
    kind: record.kind === undefined ? undefined : normalizeEntityKind(readString(record, 'kind', 'Brain search kind')),
    tag: record.tag === undefined ? undefined : sanitizeText(readString(record, 'tag', 'Brain search tag')),
    updatedAfter: record.updatedAfter === undefined ? undefined : readString(record, 'updatedAfter', 'Brain search updatedAfter'),
    updatedBefore: record.updatedBefore === undefined ? undefined : readString(record, 'updatedBefore', 'Brain search updatedBefore'),
    keyword: record.keyword === undefined ? undefined : sanitizeText(readString(record, 'keyword', 'Brain search keyword'))
  };
}

function parseBrainIndex(value: unknown): BrainIndex {
  const record = requireRecord(value, 'Brain index');
  const entities = readArray(record, 'entities', 'Brain index entities').map(parseBrainEntity);
  assertUniqueEntityKeys(entities);

  return {
    version: readString(record, 'version', 'Brain index version'),
    updatedAt: readString(record, 'updatedAt', 'Brain index updatedAt'),
    entities
  };
}

function parseBrainEntity(value: unknown): BrainEntity {
  const record = requireRecord(value, 'Brain entity');
  return {
    id: normalizeEntityId(readString(record, 'id', 'Brain entity id')),
    kind: normalizeEntityKind(readString(record, 'kind', 'Brain entity kind')),
    name: sanitizeText(readString(record, 'name', 'Brain entity name')),
    filePath: sanitizeFilePath(readString(record, 'filePath', 'Brain entity filePath')),
    tags: readStringArray(record, 'tags', 'Brain entity tags').map((tag) => sanitizeText(tag)),
    trust: normalizeTrustLevel(readString(record, 'trust', 'Brain entity trust')),
    lastUpdated: readString(record, 'lastUpdated', 'Brain entity lastUpdated'),
    lastUpdatedBy: sanitizeText(readString(record, 'lastUpdatedBy', 'Brain entity lastUpdatedBy')),
    summary: sanitizeText(readString(record, 'summary', 'Brain entity summary')),
    relatedEntities: optionalStringArray(record, 'relatedEntities', 'Brain related entities')?.map(normalizeEntityId)
  };
}

function resolveEntityPath(brainDir: string, filePath: string): string {
  const brainRoot = resolve(brainDir);
  const target = resolve(brainRoot, sanitizeFilePath(filePath));
  if (target !== brainRoot && !target.startsWith(`${brainRoot}${sep}`)) {
    throw new Error('Brain entity filePath must stay within brainDir.');
  }
  return target;
}

function sanitizeFilePath(filePath: string): string {
  const normalized = sanitizeText(filePath).replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
    throw new Error('Brain entity filePath must be relative and stay within brainDir.');
  }
  return normalized;
}

function sanitizeMarkdown(value: string): string {
  return sanitizeText(value, { preserveLineBreaks: true });
}

function assertUniqueEntityKeys(entities: BrainEntity[]): void {
  const ids = new Set<string>();
  const filePaths = new Set<string>();

  for (const entity of entities) {
    if (ids.has(entity.id)) {
      throw new Error(`Brain index contains duplicate id: ${entity.id}.`);
    }
    if (filePaths.has(entity.filePath)) {
      throw new Error(`Brain index contains duplicate filePath: ${entity.filePath}.`);
    }
    ids.add(entity.id);
    filePaths.add(entity.filePath);
  }
}

function normalizeEntityId(entityId: string): string {
  const normalized = sanitizeText(entityId);
  if (!entityIdPattern.test(normalized)) {
    throw new Error('Brain entity id must be lowercase kebab-case.');
  }
  return normalized;
}

function normalizeEntityKind(kind: string): BrainEntityKind {
  const aliases: Record<string, BrainEntityKind> = {
    people: 'person',
    companies: 'company',
    topics: 'topic',
    tools: 'tool',
    projects: 'project'
  };
  const normalized = aliases[kind] ?? kind;
  if (!['person', 'company', 'topic', 'tool', 'project'].includes(normalized)) {
    throw new Error('Brain entity kind must be one of: person, company, topic, tool, project.');
  }
  return normalized as BrainEntityKind;
}

function normalizeTrustLevel(trust: string): TrustLevel {
  if (!['high', 'medium', 'low'].includes(trust)) {
    throw new Error('Brain entity trust must be one of: high, medium, low.');
  }
  return trust as TrustLevel;
}

function indexPath(brainDir: string): string {
  return resolve(brainDir, 'index.json');
}

async function withIndexLock<T>(brainDir: string, operation: () => Promise<T>): Promise<T> {
  await acquireIndexLock(brainDir);
  try {
    return await operation();
  } finally {
    await rm(lockPath(brainDir), { force: true });
  }
}

async function acquireIndexLock(brainDir: string): Promise<void> {
  await mkdir(brainDir, { recursive: true });
  const lock = lockPath(brainDir);
  const startedAt = Date.now();

  for (;;) {
    try {
      await writeFile(lock, `${process.pid}:${new Date().toISOString()}\n`, { encoding: 'utf8', flag: 'wx' });
      return;
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) {
        throw error;
      }

      const stale = await isStaleLock(lock);
      if (stale) {
        await rm(lock, { force: true });
        continue;
      }

      if (Date.now() - startedAt > lockWaitMs) {
        throw new Error('Timed out waiting for brain index lock.');
      }

      await delay(100);
    }
  }
}

async function isStaleLock(lock: string): Promise<boolean> {
  try {
    const metadata = await stat(lock);
    return Date.now() - metadata.mtimeMs > lockStaleMs;
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return true;
    throw error;
  }
}

function lockPath(brainDir: string): string {
  return resolve(brainDir, '.index.lock');
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return '';
    throw error;
  }
}

async function writeNewEntityFile(filePath: string, relativePath: string, content: string): Promise<void> {
  try {
    await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (isNodeError(error, 'EEXIST')) {
      throw new Error(`Brain entity file already exists: ${relativePath}.`);
    }
    throw error;
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readArray(record: Record<string, unknown>, key: string, label: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function readStringArray(record: Record<string, unknown>, key: string, label: string): string[] {
  return readArray(record, key, label).map((value) => requireString(value, label));
}

function optionalStringArray(record: Record<string, unknown>, key: string, label: string): string[] | undefined {
  if (record[key] === undefined) return undefined;
  return readStringArray(record, key, label);
}

function readString(record: Record<string, unknown>, key: string, label: string): string {
  return requireString(record[key], label);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

export function entityRelativePath(brainDir: string, absolutePath: string): string {
  return relative(resolve(brainDir), absolutePath).replaceAll('\\', '/');
}
