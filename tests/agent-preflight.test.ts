import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';
import { multiAgentExampleControlPlanePath } from '../src/loader.js';
import { listChanges, listEvidence } from '../src/store.js';

describe('single Agent CMDB preflight entry point', () => {
  let storeDir: string;

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-agent-preflight-'));
  });

  function cmdb() {
    return createAgentCmdb({
      configPath: multiAgentExampleControlPlanePath,
      storeDir
    });
  }

  it('allows read-only research and logs a change record', async () => {
    const result = await cmdb().preflight({
      profile: 'research-agent',
      action: 'web_research',
      tool: 'web-search-api',
      intent: 'web_research'
    });

    expect(result.allowed).toBe(true);
    expect(await listEvidence(storeDir)).toHaveLength(0);
    expect(await listChanges(storeDir, { actor: 'agent-cmdb-preflight' })).toHaveLength(1);
  });

  it('denies social account posting and logs both evidence and change records', async () => {
    const result = await cmdb().preflight({
      profile: 'research-agent',
      action: 'social_post',
      tool: 'social-media-tool',
      intent: 'web_research'
    });

    expect(result.allowed).toBe(false);
    expect(result.decision.ruleId).toBe('object-status-blocked');
    expect(await listEvidence(storeDir, { profile: 'research-agent' })).toHaveLength(1);
    expect(await listChanges(storeDir, { actor: 'agent-cmdb-preflight' })).toHaveLength(1);
  });

  it('dry-runs social account posting without writing audit records', async () => {
    const result = await cmdb().preflight({
      profile: 'research-agent',
      action: 'social_post',
      tool: 'social-media-tool',
      intent: 'web_research',
      dryRun: true
    });

    expect(result.allowed).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.decision.ruleId).toBe('object-status-blocked');
    expect(await listEvidence(storeDir)).toHaveLength(0);
    expect(await listChanges(storeDir)).toHaveLength(0);
  });

  it('denies unknown actions by default and logs the decision', async () => {
    const result = await cmdb().preflight({
      profile: 'research-agent',
      action: 'unknown_action',
      tool: 'web-search-api',
      intent: 'web_research'
    });

    expect(result.allowed).toBe(false);
    expect(result.approvalRequired).toBe(false);
    expect(result.decision.ruleId).toBe('default-deny');
    expect(result.decision.canEscalate).toBe(false);
    expect(await listEvidence(storeDir)).toHaveLength(1);
    expect(await listChanges(storeDir, { actor: 'agent-cmdb-preflight' })).toHaveLength(1);
  });

  it('throws a clean error for an invalid profile', async () => {
    await expect(cmdb().preflight({
      profile: 'missing-profile',
      action: 'web_research',
      tool: 'web-search-api'
    })).rejects.toThrow('Unknown profile: missing-profile.');
  });

  it('throws a clean error for empty action input', async () => {
    await expect(cmdb().preflight({
      profile: 'research-agent',
      action: '',
      tool: 'web-search-api'
    })).rejects.toThrow('Policy request action must be a non-empty string.');
  });
});
