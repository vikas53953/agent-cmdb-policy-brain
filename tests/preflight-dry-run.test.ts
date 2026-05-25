import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';
import { listChanges, listEvidence } from '../src/store.js';

describe('agent preflight dry-run', () => {
  it('returns the same denial decision without writing evidence or changes', async () => {
    const storeDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-dry-run-'));
    const cmdb = createAgentCmdb({ storeDir });

    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'social_post',
      tool: 'web-search-api',
      intent: 'web_research',
      dryRun: true
    });

    expect(result.allowed).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(await listEvidence(storeDir)).toHaveLength(0);
    expect(await listChanges(storeDir)).toHaveLength(0);
  });

  it('keeps non-dry-run audit behavior', async () => {
    const storeDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-normal-preflight-'));
    const cmdb = createAgentCmdb({ storeDir });

    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'social_post',
      tool: 'web-search-api',
      intent: 'web_research'
    });

    expect(result.allowed).toBe(false);
    expect(result.dryRun).toBe(false);
    expect(await listEvidence(storeDir)).toHaveLength(1);
    expect(await listChanges(storeDir)).toHaveLength(1);
  });

  it('logs a change on allowed preflight decisions', async () => {
    const storeDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-allowed-preflight-'));
    const cmdb = createAgentCmdb({ storeDir });

    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'web_search',
      tool: 'web-search-api',
      intent: 'web_research'
    });

    expect(result.allowed).toBe(true);
    expect(await listEvidence(storeDir)).toHaveLength(0);
    expect(await listChanges(storeDir)).toHaveLength(1);
  });
});
