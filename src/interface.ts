import {
  createEntity,
  deleteEntity,
  initBrainDir,
  listEntities,
  readEntity,
  searchEntities,
  writeEntity
} from './brain.js';
import { generateDailyDigest, generateWeeklyDigest } from './digest.js';
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
import { calculatePreflightAnalytics } from './analytics.js';
import { getCostSummary } from './cost.js';
import { generateReadinessReport, validateControlPlane } from './validator.js';
import { loadControlPlane, loadDefaultControlPlane } from './loader.js';
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
  CostSummary,
  CreateEntityInput,
  DigestResult,
  EvidenceInput,
  EvidenceQuery,
  EvidenceRecord,
  HealthGateState,
  PreflightAnalytics,
  PreflightRequest,
  PreflightResult,
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
  readEntity(entityId: string, options?: { stripInjection?: boolean }): Promise<BrainReadResult>;
  writeEntity(input: BrainWriteInput): Promise<BrainEntity>;
  createEntity(entity: CreateEntityInput, content: string, actor: string): Promise<BrainEntity>;
  deleteEntity(entityId: string, actor: string, reason: string): Promise<void>;
  searchEntities(query: BrainSearchQuery): Promise<BrainEntity[]>;
  listEntities(kind?: BrainEntityKind): Promise<BrainEntity[]>;
  generateDailyDigest(profile: string, date?: string): Promise<DigestResult>;
  generateWeeklyDigest(profile: string, weekStart?: string): Promise<DigestResult>;
}

export interface IOpsClient {
  recordSourceSuccess(sourceId: string): Promise<SourceHealth>;
  recordSourceFailure(sourceId: string, reason?: string): Promise<SourceHealth>;
  getSourceHealth(sourceId: string): Promise<SourceHealth>;
  listSourceHealth(): Promise<SourceHealth[]>;
  isSourceAvailable(sourceId: string): Promise<boolean>;
  getHealthState(sourceId: string): Promise<HealthGateState>;
  resetSourceHealth(sourceId: string): Promise<SourceHealth>;
  calculatePreflightAnalytics(profile: string): Promise<PreflightAnalytics>;
  getCostSummary(profile: string, date?: string): Promise<CostSummary>;
}

export interface IAgentCMDB {
  policy: IPolicyClient;
  memory: IMemoryClient;
  ops: IOpsClient;
  health(): AgentCmdbHealth;
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

  function health(): AgentCmdbHealth {
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

  const policy: IPolicyClient = {
    preflight(request: PreflightRequest): Promise<PreflightResult> {
      return preflight(controlPlane, storeDir, request, { tamperMode });
    },
    async resolveRoute(request: SourceRouteRequest): Promise<ResolvedSourceRoute> {
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new Error('Source route request must be an object.');
      }
      const healthState = await listSourceHealth(controlPlane, storeDir, tamperMode);
      return resolveSourceRoute(controlPlane, { ...request, health: healthState });
    },
    validate(): ValidationIssue[] {
      return validateControlPlane(controlPlane);
    },
    report(): AgentCmdbReport {
      return generateReadinessReport(controlPlane);
    },
    health
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
    async readEntity(entityId: string, options?: { stripInjection?: boolean }): Promise<BrainReadResult> {
      return readEntity(await requireBrainDir(brainDir), entityId, options);
    },
    async writeEntity(input: BrainWriteInput): Promise<BrainEntity> {
      return writeEntity(await requireBrainDir(brainDir), storeDir, input);
    },
    async createEntity(entity: CreateEntityInput, content: string, actor: string): Promise<BrainEntity> {
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
      return recordSourceSuccess(controlPlane, storeDir, sourceId, tamperMode);
    },
    recordSourceFailure(sourceId: string, reason = 'source failure'): Promise<SourceHealth> {
      return recordSourceFailure(controlPlane, storeDir, sourceId, reason, tamperMode);
    },
    getSourceHealth(sourceId: string): Promise<SourceHealth> {
      return getSourceHealth(controlPlane, storeDir, sourceId, tamperMode);
    },
    listSourceHealth(): Promise<SourceHealth[]> {
      return listSourceHealth(controlPlane, storeDir, tamperMode);
    },
    isSourceAvailable(sourceId: string): Promise<boolean> {
      return isSourceAvailable(controlPlane, storeDir, sourceId, tamperMode);
    },
    getHealthState(sourceId: string): Promise<HealthGateState> {
      return getHealthState(controlPlane, storeDir, sourceId, tamperMode);
    },
    resetSourceHealth(sourceId: string): Promise<SourceHealth> {
      return resetSourceHealth(controlPlane, storeDir, sourceId, tamperMode);
    },
    calculatePreflightAnalytics(profile: string): Promise<PreflightAnalytics> {
      return calculatePreflightAnalytics(controlPlane, storeDir, profile, tamperMode);
    },
    getCostSummary(profile: string, date?: string): Promise<CostSummary> {
      return getCostSummary(controlPlane, storeDir, profile, date);
    }
  };

  return {
    policy,
    memory,
    ops,
    health
  };
}

async function requireBrainDir(brainDir: string | undefined): Promise<string> {
  if (!brainDir) {
    throw new Error('Brain not configured. Pass brainDir to createAgentCmdb.');
  }
  await initBrainDir(brainDir);
  return brainDir;
}
