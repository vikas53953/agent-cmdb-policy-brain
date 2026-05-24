import { createAgentCmdb } from '@pylabmit/agent-cmdb';

const cmdb = createAgentCmdb({
  configPath: './examples/langchain/control-plane.yaml',
  storeDir: './agent-cmdb/state'
});

export async function beforeToolCall(action: string, tool: string) {
  const result = cmdb.preflight({
    profile: 'langchain-research-agent',
    action,
    tool,
    intent: 'answer_question'
  });

  if (!result.allowed) {
    throw new Error(`Agent CMDB blocked ${action}: ${result.decision.reason}`);
  }

  return result.route?.sources ?? [];
}
