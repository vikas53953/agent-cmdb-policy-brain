import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';

function makeCmdb() {
  return createAgentCmdb({ storeDir: mkdtempSync(join(tmpdir(), 'agent-cmdb-interface-adversarial-')) });
}

describe('IAgentCMDB adversarial contract', () => {
  it('fails closed for missing preflight input with a descriptive decision', async () => {
    const cmdb = makeCmdb();

    await expect(
      // @ts-expect-error runtime adversarial input
      cmdb.policy.preflight(undefined)
    ).resolves.toMatchObject({
      allowed: false,
      decision: {
        ruleId: 'invalid-request'
      }
    });
  });

  it('fails closed for preflight input with missing action', async () => {
    const cmdb = makeCmdb();

    await expect(
      // @ts-expect-error runtime adversarial input
      cmdb.policy.preflight({
        profile: 'research-agent'
      })
    ).resolves.toMatchObject({
      allowed: false,
      decision: {
        ruleId: 'invalid-request'
      }
    });
  });

  it('rejects missing route input with a descriptive error', async () => {
    const cmdb = makeCmdb();

    // @ts-expect-error runtime adversarial input
    await expect(cmdb.policy.resolveRoute(undefined)).rejects.toThrow('Source route request must be an object.');
  });

  it('rejects malformed evidence input before writing', async () => {
    const cmdb = makeCmdb();

    await expect(
      // @ts-expect-error runtime adversarial input
      cmdb.memory.logEvidence({
        profile: 'research-agent'
      })
    ).rejects.toThrow('Evidence source must be a non-empty string.');
    await expect(cmdb.memory.listEvidence()).resolves.toHaveLength(0);
  });

  it('rejects invalid trust values before writing evidence', async () => {
    const cmdb = makeCmdb();

    await expect(
      cmdb.memory.logEvidence({
        profile: 'research-agent',
        source: 'web-search-api',
        intent: 'web_research',
        summary: 'Invalid trust probe.',
        // @ts-expect-error runtime adversarial input
        trust: 'garbage',
        capturedAt: '2026-05-24T00:00:00.000Z'
      })
    ).rejects.toThrow('Invalid trust level: garbage. Valid values: high, medium, low.');
    await expect(cmdb.memory.listEvidence()).resolves.toHaveLength(0);
  });

  it('rejects malformed evidence query objects', async () => {
    const cmdb = makeCmdb();

    await expect(
      // @ts-expect-error runtime adversarial input
      cmdb.memory.listEvidence(null)
    ).rejects.toThrow('Evidence query must be an object.');
    await expect(
      // @ts-expect-error runtime adversarial input
      cmdb.memory.listEvidence({ profile: 123 })
    ).rejects.toThrow('Evidence query profile must be a non-empty string.');
  });

  it('rejects malformed change input before writing', async () => {
    const cmdb = makeCmdb();

    await expect(
      // @ts-expect-error runtime adversarial input
      cmdb.memory.logChange({
        target: 'policy.global-deny-social-media-tool-account-actions'
      })
    ).rejects.toThrow('Change targetType must be a non-empty string.');
    await expect(cmdb.memory.listChanges()).resolves.toHaveLength(0);
  });

  it('rejects invalid change enums before writing', async () => {
    const cmdb = makeCmdb();

    await expect(
      cmdb.memory.logChange({
        target: 'policy.global-deny-social-media-tool-account-actions',
        // @ts-expect-error runtime adversarial input
        targetType: 'bogus',
        action: 'verify',
        actor: 'codex',
        reason: 'Invalid target type probe.',
        changedAt: '2026-05-24T00:00:00.000Z'
      })
    ).rejects.toThrow('Invalid object kind: bogus.');

    await expect(
      cmdb.memory.logChange({
        target: 'policy.global-deny-social-media-tool-account-actions',
        targetType: 'policy',
        // @ts-expect-error runtime adversarial input
        action: 'blocked',
        actor: 'codex',
        reason: 'Invalid action probe.',
        changedAt: '2026-05-24T00:00:00.000Z'
      })
    ).rejects.toThrow('Invalid change action: blocked.');
  });

  it('rejects malformed change query objects', async () => {
    const cmdb = makeCmdb();

    await expect(
      // @ts-expect-error runtime adversarial input
      cmdb.memory.listChanges(null)
    ).rejects.toThrow('Change query must be an object.');
    await expect(
      // @ts-expect-error runtime adversarial input
      cmdb.memory.listChanges({ actor: 123 })
    ).rejects.toThrow('Change query actor must be a non-empty string.');
  });
});
