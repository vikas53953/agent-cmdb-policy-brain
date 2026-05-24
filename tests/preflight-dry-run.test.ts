import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentPreflight } from '../src/preflight.js';
import { listChanges, listEvidence } from '../src/store.js';

describe('agent preflight dry-run', () => {
  it('returns the same denial decision without writing evidence or changes', async () => {
    const storeDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-dry-run-'));

    const result = await agentPreflight(
      {
        profile: 'research-agent',
        action: 'social_post',
        tool: 'serpapi',
        intent: 'web_research',
        dryRun: true
      },
      { storeDir }
    );

    expect(result.allowed).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(await listEvidence(storeDir)).toHaveLength(0);
    expect(await listChanges(storeDir)).toHaveLength(0);
  });

  it('keeps non-dry-run audit behavior', async () => {
    const storeDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-normal-preflight-'));

    const result = await agentPreflight(
      {
        profile: 'research-agent',
        action: 'social_post',
        tool: 'serpapi',
        intent: 'web_research'
      },
      { storeDir }
    );

    expect(result.allowed).toBe(false);
    expect(result.dryRun).toBe(false);
    expect(await listEvidence(storeDir)).toHaveLength(1);
    expect(await listChanges(storeDir)).toHaveLength(1);
  });
});
