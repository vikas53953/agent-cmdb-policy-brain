import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { readBrainIndex } from './brain.js';
import { listChanges, listEvidence } from './store.js';
import { validateControlPlane } from './validator.js';
import type { ControlPlane, DoctorReport } from './types.js';

const staleThresholdMs = 604_800_000;

export async function runDoctor(options: {
  controlPlane: ControlPlane;
  storeDir: string;
  brainDir?: string;
  now?: string;
}): Promise<DoctorReport> {
  const checkedAt = options.now ?? new Date().toISOString();
  const nowMs = parseTimestamp(checkedAt);
  const issues = validateControlPlane(options.controlPlane);
  const errors: string[] = [];
  const warnings: string[] = [];
  const store = await inspectStore(options.storeDir, errors);
  const brain = options.brainDir
    ? await inspectBrain(options.brainDir, nowMs, errors, warnings)
    : {
        configured: false,
        indexReadable: false,
        entityCount: 0,
        staleEntityCount: 0,
        orphanedFiles: []
      };

  const controlPlaneErrors = issues.filter((issue) => issue.severity === 'error').length;
  const controlPlaneWarnings = issues.filter((issue) => issue.severity === 'warning').length;
  if (controlPlaneErrors > 0) {
    errors.push(`Control plane has ${controlPlaneErrors} validation error${controlPlaneErrors === 1 ? '' : 's'}.`);
  }
  if (controlPlaneWarnings > 0) {
    warnings.push(`Control plane has ${controlPlaneWarnings} validation warning${controlPlaneWarnings === 1 ? '' : 's'}.`);
  }

  return {
    ok: errors.length === 0 && warnings.length === 0,
    checkedAt,
    errors,
    warnings,
    controlPlane: {
      errors: controlPlaneErrors,
      warnings: controlPlaneWarnings
    },
    store,
    brain
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const status = report.ok ? 'PASS' : 'ATTENTION';
  return [
    `Agent CMDB Doctor - ${status}`,
    `Checked: ${report.checkedAt}`,
    '',
    `Control plane: ${report.controlPlane.errors} errors, ${report.controlPlane.warnings} warnings`,
    `Store: writable=${report.store.writable}, evidence=${report.store.evidenceCount}, changes=${report.store.changesCount}`,
    `Brain: configured=${report.brain.configured}, entities=${report.brain.entityCount}, stale=${report.brain.staleEntityCount}, orphaned=${report.brain.orphanedFiles.length}`,
    '',
    'Warnings:',
    ...(report.warnings.length > 0 ? report.warnings.map((warning) => `- ${warning}`) : ['- None']),
    '',
    'Errors:',
    ...(report.errors.length > 0 ? report.errors.map((error) => `- ${error}`) : ['- None'])
  ].join('\n');
}

async function inspectStore(storeDir: string, errors: string[]): Promise<DoctorReport['store']> {
  const writable = await checkWritableDirectory(storeDir);
  if (!writable) {
    errors.push(`Store directory is not writable: ${storeDir}.`);
  }

  try {
    const evidence = await listEvidence(storeDir);
    const changes = await listChanges(storeDir);
    return {
      writable,
      evidenceCount: evidence.length,
      changesCount: changes.length,
      lastWriteAt: latestTimestamp([
        ...evidence.map((record) => record.capturedAt),
        ...changes.map((record) => record.changedAt)
      ])
    };
  } catch (error) {
    errors.push(`Store health check failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      writable,
      evidenceCount: 0,
      changesCount: 0
    };
  }
}

async function inspectBrain(
  brainDir: string,
  nowMs: number,
  errors: string[],
  warnings: string[]
): Promise<DoctorReport['brain']> {
  try {
    const index = await readBrainIndex(brainDir);
    const staleEntityCount = index.entities.filter((entity) => {
      const lastUpdated = Date.parse(entity.lastUpdated);
      return Number.isNaN(lastUpdated) || nowMs - lastUpdated > staleThresholdMs;
    }).length;
    const indexedFiles = new Set(index.entities.map((entity) => entity.filePath));
    const orphanedFiles = (await listMarkdownFiles(join(brainDir, 'entities')))
      .filter((filePath) => !indexedFiles.has(filePath))
      .sort();

    if (staleEntityCount > 0) {
      warnings.push(`Brain has ${staleEntityCount} stale ${staleEntityCount === 1 ? 'entity' : 'entities'}.`);
    }
    if (orphanedFiles.length > 0) {
      warnings.push(`Brain has ${orphanedFiles.length} orphaned markdown ${orphanedFiles.length === 1 ? 'file' : 'files'}.`);
    }

    return {
      configured: true,
      indexReadable: true,
      entityCount: index.entities.length,
      staleEntityCount,
      orphanedFiles
    };
  } catch (error) {
    errors.push(`Brain health check failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      configured: true,
      indexReadable: false,
      entityCount: 0,
      staleEntityCount: 0,
      orphanedFiles: []
    };
  }
}

async function checkWritableDirectory(dir: string): Promise<boolean> {
  const probePath = join(dir, `.doctor-${process.pid}-${randomUUID()}.tmp`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probePath, 'ok', { encoding: 'utf8', flag: 'wx' });
    await rm(probePath, { force: true });
    return true;
  } catch {
    await rm(probePath, { force: true }).catch(() => undefined);
    return false;
  }
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = join(root, entry.name);
        if (entry.isDirectory()) {
          return listMarkdownFiles(absolutePath);
        }
        if (entry.isFile() && entry.name.endsWith('.md')) {
          return [relative(resolve(root, '..', '..'), absolutePath).replaceAll('\\', '/')];
        }
        return [];
      })
    );
    return nested.flat();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function latestTimestamp(values: string[]): string | undefined {
  return values.sort().at(-1);
}

function parseTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error('Doctor now must be an ISO timestamp.');
  }
  return timestamp;
}
