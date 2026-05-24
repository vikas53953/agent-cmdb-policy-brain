import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAgentPreflight } from '../src/agent-preflight.js';
import { listChanges, listEvidence } from '../src/store.js';

describe('Agent preflight hook', () => {
  let previousStoreDir: string | undefined;
  let storeDir: string;

  beforeEach(() => {
    previousStoreDir = process.env.AGENT_CMDB_STORE_DIR;
    storeDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-agent-preflight-'));
    process.env.AGENT_CMDB_STORE_DIR = storeDir;
  });

  afterEach(() => {
    if (previousStoreDir === undefined) {
      delete process.env.AGENT_CMDB_STORE_DIR;
    } else {
      process.env.AGENT_CMDB_STORE_DIR = previousStoreDir;
    }
  });

  it('allows read-only research and logs a change record', async () => {
    const result = await runAgentPreflight('web_research', 'research-agent', 'web-search-api', 'web_research');

    expect(result.allowed).toBe(true);
    expect(await listEvidence(storeDir)).toHaveLength(0);
    expect(await listChanges(storeDir, { actor: 'agent-preflight' })).toHaveLength(1);
  });

  it('denies social account posting and logs both evidence and change records', async () => {
    const result = await runAgentPreflight('social_post', 'research-agent', 'social-media-tool', 'web_research');

    expect(result.allowed).toBe(false);
    expect(result.decision.ruleId).toBe('object-status-blocked');
    expect(await listEvidence(storeDir, { profile: 'research-agent' })).toHaveLength(1);
    expect(await listChanges(storeDir, { actor: 'agent-preflight' })).toHaveLength(1);
  });

  it('dry-runs social account posting without writing audit records', async () => {
    const result = await runAgentPreflight('social_post', 'research-agent', 'social-media-tool', 'web_research', { dryRun: true });

    expect(result.allowed).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.decision.ruleId).toBe('object-status-blocked');
    expect(await listEvidence(storeDir)).toHaveLength(0);
    expect(await listChanges(storeDir)).toHaveLength(0);
  });

  it('returns approval_required for unknown actions and logs the decision', async () => {
    const result = await runAgentPreflight('unknown_action', 'research-agent', 'web-search-api', 'web_research');

    expect(result.allowed).toBe(false);
    expect(result.approvalRequired).toBe(true);
    expect(result.decision.canEscalate).toBe(true);
    expect(await listEvidence(storeDir)).toHaveLength(0);
    expect(await listChanges(storeDir, { actor: 'agent-preflight' })).toHaveLength(1);
  });

  it('throws a clean error for an invalid profile', async () => {
    await expect(runAgentPreflight('web_research', 'missing-profile', 'web-search-api')).rejects.toThrow(
      'Unknown profile: missing-profile.'
    );
  });

  it('throws a clean error for empty action input', async () => {
    await expect(runAgentPreflight('', 'research-agent', 'web-search-api')).rejects.toThrow(
      'Agent preflight action must be a non-empty string.'
    );
  });
});
