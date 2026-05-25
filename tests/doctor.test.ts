import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEntity, readBrainIndex, writeBrainIndex } from '../src/brain.js';
import { runDoctor } from '../src/doctor.js';
import { appendEvidence } from '../src/store.js';
import type { ControlPlane } from '../src/types.js';

function makeDirs() {
  const root = mkdtempSync(join(tmpdir(), 'agent-cmdb-doctor-'));
  return {
    brainDir: join(root, 'brain'),
    storeDir: join(root, 'state')
  };
}

const controlPlane: ControlPlane = {
  version: '1.5-test',
  updatedAt: '2026-05-24T00:00:00.000Z',
  policy: {
    policies: []
  },
  sources: {
    sources: [
      {
        id: 'local-docs',
        label: 'Local Docs',
        kind: 'wiki',
        readOnly: true
      }
    ],
    profiles: [
      {
        id: 'research-agent',
        name: 'Research Agent',
        purpose: 'Research',
        guardrails: ['Read only.'],
        routes: [{ intent: 'research', sources: ['local-docs'] }]
      }
    ]
  },
  registry: {
    objects: [],
    relationships: []
  }
};

describe('agent-cmdb doctor', () => {
  it('returns a passing report with policy config, store, and brain counts', async () => {
    const { brainDir, storeDir } = makeDirs();
    await appendEvidence(storeDir, {
      profile: 'research-agent',
      source: 'local-docs',
      intent: 'research',
      summary: 'Doctor evidence.',
      trust: 'medium',
      capturedAt: '2026-05-24T00:00:00.000Z'
    });
    await createEntity(
      brainDir,
      storeDir,
      {
        id: 'agent-security',
        kind: 'topic',
        name: 'Agent Security',
        filePath: 'entities/topics/agent-security.md',
        tags: ['security'],
        trust: 'high',
        summary: 'Security notes.'
      },
      '# Agent Security',
      'doctor-test'
    );

    const report = await runDoctor({ controlPlane, storeDir, brainDir, now: '2026-05-24T00:00:00.000Z' });

    expect(report.ok).toBe(true);
    expect(report.controlPlane.errors).toBe(0);
    expect(report.store.evidenceCount).toBe(1);
    expect(report.brain.entityCount).toBe(1);
    expect(report.brain.staleEntityCount).toBe(0);
  });

  it('warns about stale brain entities and orphaned markdown files', async () => {
    const { brainDir, storeDir } = makeDirs();
    await createEntity(
      brainDir,
      storeDir,
      {
        id: 'agent-security',
        kind: 'topic',
        name: 'Agent Security',
        filePath: 'entities/topics/agent-security.md',
        tags: ['security'],
        trust: 'high',
        summary: 'Security notes.'
      },
      '# Agent Security',
      'doctor-test'
    );
    const index = await readBrainIndex(brainDir);
    index.entities[0].lastUpdated = '2026-05-01T00:00:00.000Z';
    await writeBrainIndex(brainDir, index);
    writeFileSync(join(brainDir, 'entities', 'topics', 'orphan.md'), '# Orphan', 'utf8');

    const report = await runDoctor({ controlPlane, storeDir, brainDir, now: '2026-05-24T00:00:00.000Z' });

    expect(report.ok).toBe(false);
    expect(report.brain.staleEntityCount).toBe(1);
    expect(report.brain.orphanedFiles).toEqual(['entities/topics/orphan.md']);
    expect(report.warnings).toContain('Brain has 1 stale entity.');
  });
});
