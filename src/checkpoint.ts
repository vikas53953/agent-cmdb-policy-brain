import { access, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  deleteJsonState,
  listJsonStateFiles,
  readJsonState,
  sanitizeText,
  writeJsonState
} from './store.js';
import type { AgentCheckpoint } from './types.js';

const checkpointDir = 'checkpoints';

export async function saveCheckpoint(storeDir: string, checkpoint: AgentCheckpoint): Promise<void> {
  const normalized = parseCheckpoint(checkpoint);
  await mkdir(dirname(join(storeDir, checkpointPath(normalized.id))), { recursive: true });
  await writeJsonState(storeDir, checkpointPath(normalized.id), normalized, parseCheckpoint);
}

export async function loadCheckpoint(storeDir: string, id: string): Promise<AgentCheckpoint | null> {
  const safeId = safeCheckpointId(id);
  try {
    await access(join(storeDir, checkpointPath(safeId)));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  try {
    return await readJsonState(storeDir, checkpointPath(safeId), emptyCheckpoint(safeId), parseCheckpoint);
  } catch (error) {
    throw error;
  }
}

export async function listCheckpoints(storeDir: string, profile?: string): Promise<AgentCheckpoint[]> {
  const normalizedProfile = profile ? safeProfile(profile) : undefined;
  const files = (await listJsonStateFiles(storeDir, checkpointDir)).filter((file) => file.endsWith('.json'));
  const checkpoints = (await Promise.all(
    files.map((file) => loadCheckpoint(storeDir, file.replace(/\.json$/, '')))
  )).filter((checkpoint): checkpoint is AgentCheckpoint => Boolean(checkpoint));

  return checkpoints
    .filter((checkpoint) => !normalizedProfile || checkpoint.profile === normalizedProfile)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function deleteCheckpoint(storeDir: string, id: string): Promise<void> {
  await deleteJsonState(storeDir, checkpointPath(safeCheckpointId(id)));
}

function checkpointPath(id: string): string {
  return `${checkpointDir}/${safeCheckpointId(id)}.json`;
}

function emptyCheckpoint(id: string): AgentCheckpoint {
  return {
    id,
    profile: 'unknown',
    taskDescription: 'missing',
    currentStep: 0,
    totalSteps: 0,
    completedSteps: [],
    pendingSteps: [],
    state: {},
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    prevHash: 'genesis'
  };
}

function parseCheckpoint(value: unknown): AgentCheckpoint {
  const record = requireRecord(value, 'Checkpoint');
  return {
    id: safeCheckpointId(readString(record, 'id', 'Checkpoint id')),
    profile: safeProfile(readString(record, 'profile', 'Checkpoint profile')),
    taskDescription: sanitizeText(readString(record, 'taskDescription', 'Checkpoint taskDescription')),
    currentStep: readNumber(record, 'currentStep', 'Checkpoint currentStep'),
    totalSteps: readNumber(record, 'totalSteps', 'Checkpoint totalSteps'),
    completedSteps: readStringArray(record, 'completedSteps', 'Checkpoint completedSteps').map((step) => sanitizeText(step)),
    pendingSteps: readStringArray(record, 'pendingSteps', 'Checkpoint pendingSteps').map((step) => sanitizeText(step)),
    state: sanitizeState(record.state),
    createdAt: readString(record, 'createdAt', 'Checkpoint createdAt'),
    updatedAt: readString(record, 'updatedAt', 'Checkpoint updatedAt'),
    prevHash: typeof record.prevHash === 'string' ? record.prevHash : 'genesis',
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((warning): warning is string => typeof warning === 'string')
      : undefined
  };
}

function sanitizeState(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      sanitizeText(key),
      sanitizeJsonValue(entryValue)
    ])
  );
}

function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (value && typeof value === 'object') return sanitizeState(value);
  return value;
}

function safeCheckpointId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error('Checkpoint id must be a safe identifier.');
  }
  return value;
}

function safeProfile(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error('Checkpoint profile must be a safe identifier.');
  }
  return value;
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

function readStringArray(record: Record<string, unknown>, key: string, label: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error(`${label} must contain non-empty strings.`);
    }
    return entry;
  });
}

function readNumber(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}
