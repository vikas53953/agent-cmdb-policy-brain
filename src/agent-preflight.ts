import { createAgentCmdb } from './interface.js';
import { multiAgentExampleControlPlanePath } from './loader.js';
import type { PreflightResult } from './types.js';

export async function runAgentPreflight(
  action: string,
  profile: string,
  tool?: string,
  intent?: string,
  options: { configPath?: string; dryRun?: boolean } = {}
): Promise<PreflightResult> {
  const normalizedAction = requireNonEmptyString(action, 'Agent preflight action');
  const normalizedProfile = requireNonEmptyString(profile, 'Agent preflight profile');
  const normalizedTool = tool === undefined ? undefined : requireNonEmptyString(tool, 'Agent preflight tool');
  const normalizedIntent = intent === undefined ? undefined : requireNonEmptyString(intent, 'Agent preflight intent');

  const cmdb = createAgentCmdb({
    configPath: options.configPath ?? multiAgentExampleControlPlanePath
  });
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
      summary: `Agent preflight ${result.decision.effect}: ${result.decision.ruleId}. ${result.decision.reason}`,
      trust: 'high',
      capturedAt: now,
      tags: ['agent-preflight', result.decision.effect, result.decision.ruleId]
    });
  }

  await cmdb.logChange({
    target: result.decision.ruleId,
    targetType: 'policy',
    action: 'verify',
    actor: 'agent-preflight',
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
