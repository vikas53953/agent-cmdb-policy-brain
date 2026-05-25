import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';
import { appendEvidence } from '../src/store.js';

function makeDirs() {
  const root = mkdtempSync(join(tmpdir(), 'agent-cmdb-interface-brain-'));
  return {
    brainDir: join(root, 'brain'),
    storeDir: join(root, 'state')
  };
}

describe('IAgentCMDB brain facade', () => {
  it('brain methods throw a descriptive error when brainDir is not configured', async () => {
    const cmdb = createAgentCmdb({ storeDir: mkdtempSync(join(tmpdir(), 'agent-cmdb-no-brain-')) });

    await expect(cmdb.memory.readEntity('agent-security')).rejects.toThrow(
      'Brain not configured. Pass brainDir to createAgentCmdb.'
    );
  });

  it('creates, reads, lists, and searches brain entities when brainDir is configured', async () => {
    const { brainDir, storeDir } = makeDirs();
    const cmdb = createAgentCmdb({ brainDir, storeDir });

    await cmdb.memory.createEntity(
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
      'research-agent'
    );

    expect((await cmdb.memory.readEntity('agent-security')).content).toContain('Agent Security');
    expect((await cmdb.memory.listEntities('topic')).map((entity) => entity.id)).toEqual(['agent-security']);
    expect((await cmdb.memory.searchEntities({ keyword: 'security' })).map((entity) => entity.id)).toEqual(['agent-security']);
  });

  it('writes brain entities through the facade', async () => {
    const { brainDir, storeDir } = makeDirs();
    const cmdb = createAgentCmdb({ brainDir, storeDir });
    await cmdb.memory.createEntity(
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
      'research-agent'
    );

    await cmdb.memory.writeEntity({
      entityId: 'agent-security',
      content: 'New evidence.',
      actor: 'research-agent',
      reason: 'Facade write',
      appendOnly: true
    });

    expect((await cmdb.memory.readEntity('agent-security')).content).toContain('New evidence.');
  });

  it('deletes brain entities through the facade', async () => {
    const { brainDir, storeDir } = makeDirs();
    const cmdb = createAgentCmdb({ brainDir, storeDir });
    await cmdb.memory.createEntity(
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
      'research-agent'
    );

    await cmdb.memory.deleteEntity('agent-security', 'research-agent', 'Cleanup');

    expect(await cmdb.memory.listEntities()).toEqual([]);
  });

  it('generates daily digests through the facade', async () => {
    const { brainDir, storeDir } = makeDirs();
    const cmdb = createAgentCmdb({ brainDir, storeDir });
    const date = new Date().toISOString().slice(0, 10);
    await appendEvidence(storeDir, {
      profile: 'research-agent',
      source: 'local-docs',
      intent: 'research',
      summary: 'Facade digest evidence.',
      trust: 'medium',
      capturedAt: `${date}T00:00:00.000Z`
    });

    const digest = await cmdb.memory.generateDailyDigest('research-agent', date);

    expect(digest.evidenceCount).toBe(1);
    expect(digest.summary).toContain('1 evidence');
  });
});
