import { createAgentCmdb } from './interface.js';
import { hermesExampleControlPlanePath } from './loader.js';
import type { PreflightResult } from './types.js';

export async function hermesPreflight(
  action: string,
  profile: string,
  tool?: string,
  intent?: string,
  options: { dryRun?: boolean } = {}
): Promise<PreflightResult> {
  const normalizedAction = requireNonEmptyString(action, 'Hermes preflight action');
  const normalizedProfile = requireNonEmptyString(profile, 'Hermes preflight profile');
  const normalizedTool = tool === undefined ? undefined : requireNonEmptyString(tool, 'Hermes preflight tool');
  const normalizedIntent = intent === undefined ? undefined : requireNonEmptyString(intent, 'Hermes preflight intent');

  const cmdb = createAgentCmdb({ configPath: hermesExampleControlPlanePath });
  const result = cmdb.preflight({
    action: normalizedAction,
    profile: normalizedProfile,
    tool: normalizedTool,
    intent: normalizedIntent,
    dryRun: options.dryRun
  });
  const now = new Date().toISOString();

  if (result.dryRun) {
    return result;
  }

  if (result.decision.effect === 'deny') {
    await cmdb.logEvidence({
      profile: normalizedProfile,
      source: 'agent-cmdb-preflight',
      intent: normalizedIntent ?? normalizedAction,
      summary: `Hermes preflight ${result.decision.effect}: ${result.decision.ruleId}. ${result.decision.reason}`,
      trust: 'high',
      capturedAt: now,
      tags: ['hermes-preflight', result.decision.effect, result.decision.ruleId]
    });
  }

  await cmdb.logChange({
    target: result.decision.ruleId,
    targetType: 'policy',
    action: 'verify',
    actor: 'hermes-preflight',
    reason: `Preflight ${result.decision.effect} for ${normalizedProfile}/${normalizedAction}.`,
    changedAt: now,
    after: {
      allowed: result.allowed,
      approvalRequired: result.approvalRequired,
      routeExecutable: result.routeExecutable,
      decision: result.decision
    }
  });

  return result;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}
