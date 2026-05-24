import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hermesPreflight } from '../src/hermes-preflight.js';
import { listChanges, listEvidence } from '../src/store.js';

describe('Hermes preflight hook', () => {
  let previousStoreDir: string | undefined;
  let storeDir: string;

  beforeEach(() => {
    previousStoreDir = process.env.AGENT_CMDB_STORE_DIR;
    storeDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-hermes-preflight-'));
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
    const result = await hermesPreflight('x_research', 'gemma4cloud', 'xai-oauth', 'x_research');

    expect(result.allowed).toBe(true);
    expect(await listEvidence(storeDir)).toHaveLength(0);
    expect(await listChanges(storeDir, { actor: 'hermes-preflight' })).toHaveLength(1);
  });

  it('denies X account posting and logs both evidence and change records', async () => {
    const result = await hermesPreflight('x_account_post', 'gemma4cloud', 'xurl', 'x_research');

    expect(result.allowed).toBe(false);
    expect(result.decision.ruleId).toBe('global-deny-xurl-account-actions');
    expect(await listEvidence(storeDir, { profile: 'gemma4cloud' })).toHaveLength(1);
    expect(await listChanges(storeDir, { actor: 'hermes-preflight' })).toHaveLength(1);
  });

  it('dry-runs X account posting without writing audit records', async () => {
    const result = await hermesPreflight('x_account_post', 'gemma4cloud', 'xurl', 'x_research', { dryRun: true });

    expect(result.allowed).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.decision.ruleId).toBe('global-deny-xurl-account-actions');
    expect(await listEvidence(storeDir)).toHaveLength(0);
    expect(await listChanges(storeDir)).toHaveLength(0);
  });

  it('returns approval_required for unknown actions and logs the decision', async () => {
    const result = await hermesPreflight('unknown_action', 'gemma4cloud', 'xai-oauth', 'x_research');

    expect(result.allowed).toBe(false);
    expect(result.approvalRequired).toBe(true);
    expect(result.decision.canEscalate).toBe(true);
    expect(await listEvidence(storeDir)).toHaveLength(0);
    expect(await listChanges(storeDir, { actor: 'hermes-preflight' })).toHaveLength(1);
  });

  it('throws a clean error for an invalid profile', async () => {
    await expect(hermesPreflight('x_research', 'missing-profile', 'xai-oauth')).rejects.toThrow(
      'Unknown profile: missing-profile.'
    );
  });

  it('throws a clean error for empty action input', async () => {
    await expect(hermesPreflight('', 'gemma4cloud', 'xai-oauth')).rejects.toThrow(
      'Hermes preflight action must be a non-empty string.'
    );
  });
});
