import {
  generateReadinessReport,
  hermesV1ControlPlane,
  preflightAction,
  resolveSourceRoute,
  validateControlPlane
} from './engine.js';
import { appendChange, appendEvidence, listChanges, listEvidence } from './store.js';
import type {
  AgentCmdbReport,
  ChangeInput,
  ChangeQuery,
  ChangeRecord,
  ControlPlane,
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
  preflight(request: PreflightRequest): PreflightResult;
  resolveRoute(request: SourceRouteRequest): ResolvedSourceRoute;
  logEvidence(input: EvidenceInput): Promise<EvidenceRecord>;
  listEvidence(query?: EvidenceQuery): Promise<EvidenceRecord[]>;
  logChange(input: ChangeInput): Promise<ChangeRecord>;
  listChanges(query?: ChangeQuery): Promise<ChangeRecord[]>;
  validate(): ValidationIssue[];
  report(): AgentCmdbReport;
  health(): AgentCmdbHealth;
}

export interface AgentCmdbOptions {
  controlPlane?: ControlPlane;
  storeDir: string;
}

export function createAgentCmdb(options: AgentCmdbOptions): IAgentCMDB {
  const controlPlane = options.controlPlane ?? hermesV1ControlPlane;

  return {
    preflight(request: PreflightRequest): PreflightResult {
      return preflightAction(controlPlane, request);
    },
    resolveRoute(request: SourceRouteRequest): ResolvedSourceRoute {
      return resolveSourceRoute(controlPlane, request);
    },
    logEvidence(input: EvidenceInput): Promise<EvidenceRecord> {
      return appendEvidence(options.storeDir, input);
    },
    listEvidence(query: EvidenceQuery = {}): Promise<EvidenceRecord[]> {
      return listEvidence(options.storeDir, query);
    },
    logChange(input: ChangeInput): Promise<ChangeRecord> {
      return appendChange(options.storeDir, input);
    },
    listChanges(query: ChangeQuery = {}): Promise<ChangeRecord[]> {
      return listChanges(options.storeDir, query);
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
    }
  };
}
