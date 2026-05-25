export type PolicyEffect = 'allow' | 'deny' | 'approval_required';
export type ObjectKind = 'profile' | 'source' | 'tool' | 'job' | 'memory' | 'policy' | 'workspace';
export type ObjectStatus = 'active' | 'paused' | 'blocked' | 'planned';
export type TrustLevel = 'high' | 'medium' | 'low';
export type IssueSeverity = 'error' | 'warning';
export type ChangeAction = 'create' | 'update' | 'pause' | 'resume' | 'delete' | 'verify';
export type BrainEntityKind = 'person' | 'company' | 'topic' | 'tool' | 'project';
export type TamperMode = 'warn' | 'fail';

export interface SourceRef {
  id: string;
  label: string;
  kind: 'memory' | 'tool' | 'oauth' | 'wiki' | 'web' | 'evidence';
  readOnly: boolean;
  notes?: string;
  freshnessTtl?: string;
  brainEntityId?: string;
  health?: SourceHealthConfig;
  costPerCall?: number;
}

export interface SourceRoute {
  intent: string;
  sources: string[];
  notes?: string;
  blockOnStale?: boolean;
  writeActions?: string[];
}

export interface AgentProfile {
  id: string;
  name: string;
  purpose: string;
  guardrails: string[];
  routes: SourceRoute[];
  reliability?: ReliabilityConfig;
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
  writeActions?: string[];
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
  freshness?: SourceFreshnessInput[];
  health?: SourceHealth[];
}

export interface SourceFreshnessInput {
  sourceId: string;
  lastUpdated: string;
}

export interface SourceFreshnessStatus {
  sourceId: string;
  ttl: string;
  lastUpdated?: string;
  ageMs?: number;
  stale: boolean;
  reason?: string;
}

export interface ResolvedSourceRoute {
  profile: string;
  intent: string;
  sources: SourceRef[];
  skippedSources: string[];
  guardrails: string[];
  notes?: string;
  blockOnStale: boolean;
  staleSourceIds: string[];
  freshness: SourceFreshnessStatus[];
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
  dryRun?: boolean;
  freshness?: SourceFreshnessInput[];
}

export type PreflightResult = AllowPreflightResult | DenyPreflightResult | DryRunPreflightResult;

export interface BasePreflightResult {
  allowed: boolean;
  approvalRequired: boolean;
  decision: PolicyDecision;
  routeExecutable: boolean;
  guardrails: string[];
  warnings: string[];
  dryRun: boolean;
}

export interface AllowPreflightResult extends BasePreflightResult {
  allowed: true;
  approvalRequired: false;
  route?: ResolvedSourceRoute;
  routeExecutable: boolean;
  dryRun: false;
}

export interface DenyPreflightResult extends BasePreflightResult {
  allowed: false;
  approvalRequired: boolean;
  route?: undefined;
  routeExecutable: false;
  dryRun: false;
}

export interface DryRunPreflightResult extends BasePreflightResult {
  dryRun: true;
  wouldAllow: boolean;
  route?: ResolvedSourceRoute;
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
  prevHash: string;
  profile: string;
  source: string;
  intent: string;
  summary: string;
  trust: TrustLevel;
  capturedAt: string;
  tokenCount?: number;
  estimatedCost?: number;
  links?: string[];
  tags?: string[];
  warnings?: string[];
}

export type EvidenceInput = Omit<EvidenceRecord, 'id' | 'prevHash' | 'warnings'>;

export interface EvidenceQuery {
  profile?: string;
  source?: string;
  intent?: string;
  trust?: TrustLevel;
  tag?: string;
  dateRange?: DateRange;
}

export interface DateRange {
  from?: string;
  to?: string;
}

export interface ChangeRecord {
  id: string;
  prevHash: string;
  target: string;
  targetType: ObjectKind;
  action: ChangeAction;
  actor: string;
  reason: string;
  changedAt: string;
  before?: unknown;
  after?: unknown;
  warnings?: string[];
}

export type ChangeInput = Omit<ChangeRecord, 'id' | 'prevHash' | 'warnings'>;

export interface ChangeQuery {
  target?: string;
  targetType?: ObjectKind;
  actor?: string;
  action?: ChangeAction;
  dateRange?: DateRange;
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
  warnings?: string[];
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

export interface SourceHealthConfig {
  failureThreshold?: number;
  recoveryTimeoutMs?: number;
}

export interface SourceHealth {
  sourceId: string;
  status: 'up' | 'down' | 'half-open';
  consecutiveFailures: number;
  probeCount?: number;
  recoveryAttempts?: number;
  lastChecked: string;
  lastFailure?: string;
  lastSuccess?: string;
  warnings?: string[];
}

export type HealthGateState = 'closed' | 'open' | 'half-open';

export interface ReliabilityConfig {
  target: number;
  windowHours: number;
  metric: 'allow_rate';
}

export interface ReliabilityResult {
  profile: string;
  target: number;
  actual: number;
  withinBudget: boolean;
  failureBudgetRemaining: number;
  totalDecisions: number;
  allowedCount: number;
  deniedCount: number;
  windowStart: string;
  windowEnd: string;
  warnings?: string[];
}

export interface CostSummary {
  profile: string;
  date: string;
  totalCalls: number;
  totalTokens: number;
  totalCost: number;
  bySource: Array<{
    sourceId: string;
    calls: number;
    tokens: number;
    cost: number;
  }>;
}

export interface AgentCheckpoint {
  id: string;
  profile: string;
  taskDescription: string;
  currentStep: number;
  totalSteps: number;
  completedSteps: string[];
  pendingSteps: string[];
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  prevHash: string;
  warnings?: string[];
}

export interface DoctorReport {
  ok: boolean;
  checkedAt: string;
  errors: string[];
  warnings: string[];
  controlPlane: {
    errors: number;
    warnings: number;
  };
  store: {
    writable: boolean;
    evidenceCount: number;
    changesCount: number;
    lastWriteAt?: string;
  };
  brain: {
    configured: boolean;
    indexReadable: boolean;
    entityCount: number;
    staleEntityCount: number;
    orphanedFiles: string[];
  };
}
