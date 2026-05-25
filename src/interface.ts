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
  getHealthState,
  getSourceHealth,
  isSourceAvailable,
  listSourceHealth,
  readHealthWarningsSync,
  recordSourceFailure,
  recordSourceSuccess,
  resetSourceHealth
} from './health.js';
import { calculateReliability } from './reliability.js';
import { getCostSummary } from './cost.js';
import {
  deleteCheckpoint,
  listCheckpoints,
  loadCheckpoint,
  saveCheckpoint
} from './checkpoint.js';
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
  AgentCheckpoint,
  BrainEntity,
  BrainEntityKind,
  BrainReadResult,
  BrainSearchQuery,
  BrainWriteInput,
  ChangeInput,
  ChangeQuery,
  ChangeRecord,
  ControlPlane,
  CostSummary,
  DigestResult,
  EvidenceInput,
  EvidenceQuery,
  EvidenceRecord,
  HealthGateState,
  PreflightRequest,
  PreflightResult,
  ReliabilityResult,
  ResolvedSourceRoute,
  SourceHealth,
  SourceRouteRequest,
  TamperMode,
  ValidationIssue
} from './types.js';

export interface AgentCmdbHealth {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
}

export interface IPolicyClient {
  preflight(request: PreflightRequest): Promise<PreflightResult>;
  resolveRoute(request: SourceRouteRequest): Promise<ResolvedSourceRoute>;
  validate(): ValidationIssue[];
  report(): AgentCmdbReport;
  health(): AgentCmdbHealth;
}

export interface IMemoryClient {
  logEvidence(input: EvidenceInput): Promise<EvidenceRecord>;
  listEvidence(query?: EvidenceQuery): Promise<EvidenceRecord[]>;
  logChange(input: ChangeInput): Promise<ChangeRecord>;
  listChanges(query?: ChangeQuery): Promise<ChangeRecord[]>;
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

export interface IOpsClient {
  recordSourceSuccess(sourceId: string): Promise<SourceHealth>;
  recordSourceFailure(sourceId: string): Promise<SourceHealth>;
  getSourceHealth(sourceId: string): Promise<SourceHealth>;
  listSourceHealth(): Promise<SourceHealth[]>;
  isSourceAvailable(sourceId: string): Promise<boolean>;
  getHealthState(sourceId: string): Promise<HealthGateState>;
  resetSourceHealth(sourceId: string): Promise<SourceHealth>;
  calculateReliability(profile: string): Promise<ReliabilityResult>;
  getCostSummary(profile: string, date?: string): Promise<CostSummary>;
  saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void>;
  loadCheckpoint(id: string): Promise<AgentCheckpoint | null>;
  listCheckpoints(profile?: string): Promise<AgentCheckpoint[]>;
  deleteCheckpoint(id: string): Promise<void>;
}

export interface IAgentCMDB extends IPolicyClient, IMemoryClient, IOpsClient {
  policy: IPolicyClient;
  memory: IMemoryClient;
  ops: IOpsClient;
}

export interface AgentCmdbOptions {
  configPath?: string;
  controlPlane?: ControlPlane;
  storeDir?: string;
  brainDir?: string;
  tamperMode?: TamperMode;
}

export function createAgentCmdb(options: AgentCmdbOptions = {}): IAgentCMDB {
  const controlPlane = options.controlPlane ?? (options.configPath ? loadControlPlane(options.configPath) : loadDefaultControlPlane());
  const storeDir = options.storeDir ?? process.env.AGENT_CMDB_STORE_DIR ?? 'agent-cmdb/state';
  const brainDir = options.brainDir;
  const tamperMode = options.tamperMode ?? 'warn';

  const policy: IPolicyClient = {
    preflight(request: PreflightRequest): Promise<PreflightResult> {
      return preflight(controlPlane, storeDir, request);
    },
    async resolveRoute(request: SourceRouteRequest): Promise<ResolvedSourceRoute> {
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new Error('Source route request must be an object.');
      }
      const health = await listSourceHealth(controlPlane, storeDir);
      return resolveSourceRoute(controlPlane, { ...request, health });
    },
    validate(): ValidationIssue[] {
      return validateControlPlane(controlPlane);
    },
    report(): AgentCmdbReport {
      return generateReadinessReport(controlPlane);
    },
    health(): AgentCmdbHealth {
      const issues = [
        ...validateControlPlane(controlPlane),
        ...readHealthWarningsSync(storeDir).map((message): ValidationIssue => ({
          severity: 'warning',
          code: 'health_state_tampered',
          message
        }))
      ];
      const errors = issues.filter((issue) => issue.severity === 'error').length;
      const warnings = issues.filter((issue) => issue.severity === 'warning').length;

      return {
        ok: errors === 0,
        errors,
        warnings,
        issues
      };
    }
  };

  const memory: IMemoryClient = {
    logEvidence(input: EvidenceInput): Promise<EvidenceRecord> {
      return appendEvidence(storeDir, input);
    },
    listEvidence(query: EvidenceQuery = {}): Promise<EvidenceRecord[]> {
      return listEvidence(storeDir, query, { tamperMode });
    },
    logChange(input: ChangeInput): Promise<ChangeRecord> {
      return appendChange(storeDir, input);
    },
    listChanges(query: ChangeQuery = {}): Promise<ChangeRecord[]> {
      return listChanges(storeDir, query, { tamperMode });
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
        brainDir: await requireBrainDir(brainDir),
        controlPlane
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

  const ops: IOpsClient = {
    recordSourceSuccess(sourceId: string): Promise<SourceHealth> {
      return recordSourceSuccess(controlPlane, storeDir, sourceId);
    },
    recordSourceFailure(sourceId: string): Promise<SourceHealth> {
      return recordSourceFailure(controlPlane, storeDir, sourceId);
    },
    getSourceHealth(sourceId: string): Promise<SourceHealth> {
      return getSourceHealth(controlPlane, storeDir, sourceId);
    },
    listSourceHealth(): Promise<SourceHealth[]> {
      return listSourceHealth(controlPlane, storeDir);
    },
    isSourceAvailable(sourceId: string): Promise<boolean> {
      return isSourceAvailable(controlPlane, storeDir, sourceId);
    },
    getHealthState(sourceId: string): Promise<HealthGateState> {
      return getHealthState(controlPlane, storeDir, sourceId);
    },
    resetSourceHealth(sourceId: string): Promise<SourceHealth> {
      return resetSourceHealth(controlPlane, storeDir, sourceId);
    },
    calculateReliability(profile: string): Promise<ReliabilityResult> {
      return calculateReliability(controlPlane, storeDir, profile);
    },
    getCostSummary(profile: string, date?: string): Promise<CostSummary> {
      return getCostSummary(controlPlane, storeDir, profile, date);
    },
    saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void> {
      return saveCheckpoint(storeDir, checkpoint);
    },
    loadCheckpoint(id: string): Promise<AgentCheckpoint | null> {
      return loadCheckpoint(storeDir, id);
    },
    listCheckpoints(profile?: string): Promise<AgentCheckpoint[]> {
      return listCheckpoints(storeDir, profile);
    },
    deleteCheckpoint(id: string): Promise<void> {
      return deleteCheckpoint(storeDir, id);
    }
  };

  return {
    policy,
    memory,
    ops,
    ...policy,
    ...memory,
    ...ops
  };
}

async function requireBrainDir(brainDir: string | undefined): Promise<string> {
  if (!brainDir) {
    throw new Error('Brain not configured. Pass brainDir to createAgentCmdb.');
  }
  await initBrainDir(brainDir);
  return brainDir;
}
