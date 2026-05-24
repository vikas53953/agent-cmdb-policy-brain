import { createAgentCmdb, type AgentCmdbOptions } from './interface.js';
import type { PreflightRequest, PreflightResult } from './types.js';

export async function agentPreflight(
  request: PreflightRequest,
  options: AgentCmdbOptions = {}
): Promise<PreflightResult> {
  const cmdb = createAgentCmdb(options);
  const result = cmdb.preflight(request);
  const now = new Date().toISOString();

  if (result.decision.effect === 'deny') {
    await cmdb.logEvidence({
      profile: result.decision.profile,
      source: 'agent-cmdb-preflight',
      intent: request.intent ?? result.decision.action,
      summary: `Denied: ${result.decision.reason}`,
      trust: 'high',
      capturedAt: now,
      tags: ['agent-cmdb', 'preflight', 'deny', result.decision.ruleId]
    });
  }

  await cmdb.logChange({
    target: result.decision.ruleId,
    targetType: 'policy',
    action: 'verify',
    actor: 'agent-cmdb-preflight',
    reason: `Preflight ${result.decision.effect} for ${result.decision.profile}/${result.decision.action}.`,
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
