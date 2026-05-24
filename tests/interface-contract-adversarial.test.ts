import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';

function makeCmdb() {
  return createAgentCmdb({ storeDir: mkdtempSync(join(tmpdir(), 'agent-cmdb-interface-adversarial-')) });
}

describe('IAgentCMDB adversarial contract', () => {
  it('rejects missing preflight input with a descriptive error', () => {
    const cmdb = makeCmdb();

    expect(() =>
      // @ts-expect-error runtime adversarial input
      cmdb.preflight(undefined)
    ).toThrow('Policy request must be an object.');
  });

  it('rejects preflight input with missing action', () => {
    const cmdb = makeCmdb();

    expect(() =>
      // @ts-expect-error runtime adversarial input
      cmdb.preflight({
        profile: 'gemma4cloud'
      })
    ).toThrow('Policy request action must be a non-empty string.');
  });

  it('rejects missing route input with a descriptive error', () => {
    const cmdb = makeCmdb();

    expect(() =>
      // @ts-expect-error runtime adversarial input
      cmdb.resolveRoute(undefined)
    ).toThrow('Source route request must be an object.');
  });

  it('rejects malformed evidence input before writing', async () => {
    const cmdb = makeCmdb();

    await expect(
      // @ts-expect-error runtime adversarial input
      cmdb.logEvidence({
        profile: 'gemma4cloud'
      })
    ).rejects.toThrow('Evidence source must be a non-empty string.');
    await expect(cmdb.listEvidence()).resolves.toHaveLength(0);
  });

  it('rejects invalid trust values before writing evidence', async () => {
    const cmdb = makeCmdb();

    await expect(
      cmdb.logEvidence({
        profile: 'gemma4cloud',
        source: 'xai-oauth',
        intent: 'x_research',
        summary: 'Invalid trust probe.',
        // @ts-expect-error runtime adversarial input
        trust: 'garbage',
        capturedAt: '2026-05-24T00:00:00.000Z'
      })
    ).rejects.toThrow('Invalid trust level: garbage. Valid values: high, medium, low.');
    await expect(cmdb.listEvidence()).resolves.toHaveLength(0);
  });

  it('rejects malformed evidence query objects', async () => {
    const cmdb = makeCmdb();

    await expect(
      // @ts-expect-error runtime adversarial input
      cmdb.listEvidence(null)
    ).rejects.toThrow('Evidence query must be an object.');
    await expect(
      // @ts-expect-error runtime adversarial input
      cmdb.listEvidence({ profile: 123 })
    ).rejects.toThrow('Evidence query profile must be a non-empty string.');
  });

  it('rejects malformed change input before writing', async () => {
    const cmdb = makeCmdb();

    await expect(
      // @ts-expect-error runtime adversarial input
      cmdb.logChange({
        target: 'policy.global-deny-xurl-account-actions'
      })
    ).rejects.toThrow('Change targetType must be a non-empty string.');
    await expect(cmdb.listChanges()).resolves.toHaveLength(0);
  });

  it('rejects invalid change enums before writing', async () => {
    const cmdb = makeCmdb();

    await expect(
      cmdb.logChange({
        target: 'policy.global-deny-xurl-account-actions',
        // @ts-expect-error runtime adversarial input
        targetType: 'bogus',
        action: 'verify',
        actor: 'codex',
        reason: 'Invalid target type probe.',
        changedAt: '2026-05-24T00:00:00.000Z'
      })
    ).rejects.toThrow('Invalid object kind: bogus.');

    await expect(
      cmdb.logChange({
        target: 'policy.global-deny-xurl-account-actions',
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
      cmdb.listChanges(null)
    ).rejects.toThrow('Change query must be an object.');
    await expect(
      // @ts-expect-error runtime adversarial input
      cmdb.listChanges({ actor: 123 })
    ).rejects.toThrow('Change query actor must be a non-empty string.');
  });
});
