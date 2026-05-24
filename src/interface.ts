import {
  createEntity,
  deleteEntity,
  initBrainDir,
  listEntities,
  readEntity,
  searchEntities,
  writeEntity
} from './brain.js';
import {
  generateDailyDigest,
  generateWeeklyDigest
} from './digest.js';
import {
  generateReadinessReport,
  validateControlPlane
} from './validator.js';
import {
  loadDefaultControlPlane,
  loadControlPlane
} from './loader.js';
import { preflight } from './preflight.js';
import { resolveSourceRoute } from './route-resolver.js';
import { appendChange, appendEvidence, listChanges, listEvidence } from './store.js';
import type {
  AgentCmdbReport,
  BrainEntity,
  BrainEntityKind,
  BrainReadResult,
  BrainSearchQuery,
  BrainWriteInput,
  ChangeInput,
  ChangeQuery,
  ChangeRecord,
  ControlPlane,
  DigestResult,
  EvidenceInput,
  EvidenceQuery,
  EvidenceRecord,
  PreflightRequest,
  PreflightResult,
  ResolvedSourceRoute,
  SourceRouteRequest,
  ValidationIssue
} from './types.js';

export interface AgentCmdbHealth {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
}

export interface IAgentCMDB {
  preflight(request: PreflightRequest): Promise<PreflightResult>;
  resolveRoute(request: SourceRouteRequest): ResolvedSourceRoute;
  logEvidence(input: EvidenceInput): Promise<EvidenceRecord>;
  listEvidence(query?: EvidenceQuery): Promise<EvidenceRecord[]>;
  logChange(input: ChangeInput): Promise<ChangeRecord>;
  listChanges(query?: ChangeQuery): Promise<ChangeRecord[]>;
  validate(): ValidationIssue[];
  report(): AgentCmdbReport;
  health(): AgentCmdbHealth;
  readEntity(entityId: string): Promise<BrainReadResult>;
  writeEntity(input: BrainWriteInput): Promise<BrainEntity>;
  createEntity(
    entity: Omit<BrainEntity, 'lastUpdated' | 'lastUpdatedBy'>,
    content: string,
    actor: string
  ): Promise<BrainEntity>;
  deleteEntity(entityId: string, actor: string, reason: string): Promise<void>;
  searchEntities(query: BrainSearchQuery): Promise<BrainEntity[]>;
  listEntities(kind?: BrainEntityKind): Promise<BrainEntity[]>;
  generateDailyDigest(profile: string, date?: string): Promise<DigestResult>;
  generateWeeklyDigest(profile: string, weekStart?: string): Promise<DigestResult>;
}

export interface AgentCmdbOptions {
  configPath?: string;
  controlPlane?: ControlPlane;
  storeDir?: string;
  brainDir?: string;
}

export function createAgentCmdb(options: AgentCmdbOptions = {}): IAgentCMDB {
  const controlPlane = options.controlPlane ?? (options.configPath ? loadControlPlane(options.configPath) : loadDefaultControlPlane());
  const storeDir = options.storeDir ?? process.env.AGENT_CMDB_STORE_DIR ?? 'agent-cmdb/state';
  const brainDir = options.brainDir;

  return {
    preflight(request: PreflightRequest): Promise<PreflightResult> {
      return preflight(controlPlane, storeDir, request);
    },
    resolveRoute(request: SourceRouteRequest): ResolvedSourceRoute {
      return resolveSourceRoute(controlPlane, request);
    },
    logEvidence(input: EvidenceInput): Promise<EvidenceRecord> {
      return appendEvidence(storeDir, input);
    },
    listEvidence(query: EvidenceQuery = {}): Promise<EvidenceRecord[]> {
      return listEvidence(storeDir, query);
    },
    logChange(input: ChangeInput): Promise<ChangeRecord> {
      return appendChange(storeDir, input);
    },
    listChanges(query: ChangeQuery = {}): Promise<ChangeRecord[]> {
      return listChanges(storeDir, query);
    },
    validate(): ValidationIssue[] {
      return validateControlPlane(controlPlane);
    },
    report(): AgentCmdbReport {
      return generateReadinessReport(controlPlane);
    },
    health(): AgentCmdbHealth {
      const issues = validateControlPlane(controlPlane);
      const errors = issues.filter((issue) => issue.severity === 'error').length;
      const warnings = issues.filter((issue) => issue.severity === 'warning').length;

      return {
        ok: errors === 0,
        errors,
        warnings,
        issues
      };
    },
    async readEntity(entityId: string): Promise<BrainReadResult> {
      return readEntity(await requireBrainDir(brainDir), entityId);
    },
    async writeEntity(input: BrainWriteInput): Promise<BrainEntity> {
      return writeEntity(await requireBrainDir(brainDir), storeDir, input);
    },
    async createEntity(
      entity: Omit<BrainEntity, 'lastUpdated' | 'lastUpdatedBy'>,
      content: string,
      actor: string
    ): Promise<BrainEntity> {
      return createEntity(await requireBrainDir(brainDir), storeDir, entity, content, actor);
    },
    async deleteEntity(entityId: string, actor: string, reason: string): Promise<void> {
      return deleteEntity(await requireBrainDir(brainDir), storeDir, entityId, actor, reason);
    },
    async searchEntities(query: BrainSearchQuery): Promise<BrainEntity[]> {
      return searchEntities(await requireBrainDir(brainDir), query);
    },
    async listEntities(kind?: BrainEntityKind): Promise<BrainEntity[]> {
      return listEntities(await requireBrainDir(brainDir), kind);
    },
    async generateDailyDigest(profile: string, date?: string): Promise<DigestResult> {
      return generateDailyDigest({
        profile,
        date,
        storeDir,
        brainDir: await requireBrainDir(brainDir)
      });
    },
    async generateWeeklyDigest(profile: string, weekStart?: string): Promise<DigestResult> {
      return generateWeeklyDigest({
        profile,
        weekStart,
        storeDir,
        brainDir: await requireBrainDir(brainDir)
      });
    }
  };
}

async function requireBrainDir(brainDir: string | undefined): Promise<string> {
  if (!brainDir) {
    throw new Error('Brain not configured. Pass brainDir to createAgentCmdb.');
  }
  await initBrainDir(brainDir);
  return brainDir;
}
