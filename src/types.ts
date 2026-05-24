export type PolicyEffect = 'allow' | 'deny' | 'approval_required';
export type ObjectKind = 'profile' | 'source' | 'tool' | 'job' | 'memory' | 'policy' | 'workspace';
export type ObjectStatus = 'active' | 'paused' | 'blocked' | 'planned';
export type TrustLevel = 'high' | 'medium' | 'low';
export type IssueSeverity = 'error' | 'warning';
export type ChangeAction = 'create' | 'update' | 'pause' | 'resume' | 'delete' | 'verify';
export type BrainEntityKind = 'person' | 'company' | 'topic' | 'tool' | 'project';

export interface SourceRef {
  id: string;
  label: string;
  kind: 'memory' | 'tool' | 'oauth' | 'wiki' | 'web' | 'evidence';
  readOnly: boolean;
  notes?: string;
}

export interface SourceRoute {
  intent: string;
  sources: string[];
  notes?: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  purpose: string;
  guardrails: string[];
  routes: SourceRoute[];
}

export interface CmdbObject {
  id: string;
  kind: ObjectKind;
  label: string;
  status: ObjectStatus;
  profile?: string;
  tags: string[];
  dependsOn?: string[];
  notes?: string;
}

export interface Relationship {
  from: string;
  to: string;
  type: 'uses' | 'owns' | 'governed_by' | 'depends_on' | 'blocks' | 'writes_to';
  notes?: string;
}

export interface PolicyRule {
  id: string;
  effect: PolicyEffect;
  actions: string[];
  profiles?: string[];
  tools?: string[];
  reason: string;
  code?: string;
  canEscalate?: boolean;
  suggestedAlternative?: string;
}

export interface ControlPlane {
  version: string;
  updatedAt: string;
  sources: SourceRef[];
  profiles: AgentProfile[];
  policies: PolicyRule[];
  objects: CmdbObject[];
  relationships: Relationship[];
}

export interface PolicyRequest {
  profile: string;
  action: string;
  tool?: string;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  ruleId: string;
  code: string;
  reason: string;
  profile: string;
  action: string;
  tool?: string;
  canEscalate: boolean;
  suggestedAlternative?: string;
}

export interface SourceRouteRequest {
  profile: string;
  intent: string;
}

export interface ResolvedSourceRoute {
  profile: string;
  intent: string;
  sources: SourceRef[];
  guardrails: string[];
  notes?: string;
}

export interface ProfileInspection {
  id: string;
  name: string;
  purpose: string;
  guardrails: string[];
  routes: SourceRoute[];
}

export interface ObjectQuery {
  profile?: string;
  kind?: ObjectKind;
  status?: ObjectStatus;
  tag?: string;
}

export interface GraphNeighbor {
  relationship: Relationship;
  node: CmdbObject | SourceRef | AgentProfile | PolicyRule;
}

export interface GraphResult {
  node: CmdbObject | SourceRef | AgentProfile | PolicyRule;
  neighbors: GraphNeighbor[];
}

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
}

export interface PreflightRequest extends PolicyRequest {
  intent?: string;
}

export interface PreflightResult {
  allowed: boolean;
  approvalRequired: boolean;
  decision: PolicyDecision;
  route?: ResolvedSourceRoute;
  routeExecutable: boolean;
  guardrails: string[];
  warnings: string[];
}

export interface AgentCmdbReport {
  version: string;
  updatedAt: string;
  counts: {
    profiles: number;
    sources: number;
    policies: number;
    objects: number;
    relationships: number;
  };
  guardrails: {
    deniedActions: string[];
    pausedObjects: string[];
    blockedObjects: string[];
  };
  validation: {
    errors: number;
    warnings: number;
    issues: ValidationIssue[];
  };
}

export interface EvidenceRecord {
  id: string;
  profile: string;
  source: string;
  intent: string;
  summary: string;
  trust: TrustLevel;
  capturedAt: string;
  links?: string[];
  tags?: string[];
}

export type EvidenceInput = Omit<EvidenceRecord, 'id'>;

export interface EvidenceQuery {
  profile?: string;
  source?: string;
  intent?: string;
  trust?: TrustLevel;
  tag?: string;
}

export interface ChangeRecord {
  id: string;
  target: string;
  targetType: ObjectKind;
  action: ChangeAction;
  actor: string;
  reason: string;
  changedAt: string;
  before?: unknown;
  after?: unknown;
}

export type ChangeInput = Omit<ChangeRecord, 'id'>;

export interface ChangeQuery {
  target?: string;
  targetType?: ObjectKind;
  actor?: string;
  action?: ChangeAction;
}

export interface BrainEntity {
  id: string;
  kind: BrainEntityKind;
  name: string;
  filePath: string;
  tags: string[];
  trust: TrustLevel;
  lastUpdated: string;
  lastUpdatedBy: string;
  summary: string;
  relatedEntities?: string[];
}

export interface BrainIndex {
  version: string;
  updatedAt: string;
  entities: BrainEntity[];
}

export interface BrainReadResult {
  entity: BrainEntity;
  content: string;
  ageMs: number;
  stale: boolean;
}

export interface BrainWriteInput {
  entityId: string;
  content: string;
  actor: string;
  reason: string;
  appendOnly?: boolean;
}

export interface BrainSearchQuery {
  kind?: BrainEntityKind;
  tag?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  keyword?: string;
}

export interface DigestResult {
  profile: string;
  date: string;
  evidenceCount: number;
  changesCount: number;
  entitiesUpdated: string[];
  digestPath: string;
  summary: string;
}
