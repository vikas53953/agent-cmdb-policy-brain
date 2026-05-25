import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEntity, readBrainIndex, writeBrainIndex } from '../src/brain.js';
import { generateDailyDigest, generateWeeklyDigest } from '../src/digest.js';
import { appendChange, appendEvidence } from '../src/store.js';

const today = new Date().toISOString().slice(0, 10);
const todayTimestamp = `${today}T09:00:00.000Z`;

function makeDirs() {
  const root = mkdtempSync(join(tmpdir(), 'agent-cmdb-digest-'));
  return {
    brainDir: join(root, 'brain'),
    storeDir: join(root, 'state')
  };
}

describe('Agent CMDB digest', () => {
  it('generateDailyDigest writes markdown with evidence, changes, and brain updates', async () => {
    const { brainDir, storeDir } = makeDirs();
    await appendEvidence(storeDir, {
      profile: 'research-agent',
      source: 'web-search-api',
      intent: 'web_research',
      summary: 'Agent firewall pattern is trending.',
      trust: 'high',
      capturedAt: todayTimestamp
    });
    await appendChange(storeDir, {
      target: 'policy.allow-research',
      targetType: 'policy',
      action: 'verify',
      actor: 'codex',
      reason: 'Verified research policy.',
      changedAt: todayTimestamp
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
      'research-agent'
    );

    const result = await generateDailyDigest({
      profile: 'research-agent',
      date: today,
      storeDir,
      brainDir
    });

    expect(result.evidenceCount).toBe(1);
    expect(result.changesCount).toBe(2);
    expect(result.entitiesUpdated).toEqual(['agent-security']);
    expect(existsSync(result.digestPath)).toBe(true);
    const markdown = readFileSync(result.digestPath, 'utf8');
    expect(markdown).toContain(`# Daily digest: research-agent - ${today}`);
    expect(markdown).toContain('[high] Agent firewall pattern is trending. (source: web-search-api)');
    expect(markdown).toContain('verify policy.allow-research: Verified research policy. (by codex)');
    expect(markdown).toContain('Agent Security - updated by research-agent');
  });

  it('generateDailyDigest with no data produces an empty digest', async () => {
    const { brainDir, storeDir } = makeDirs();

    const result = await generateDailyDigest({
      profile: 'research-agent',
      date: today,
      storeDir,
      brainDir
    });

    expect(result.evidenceCount).toBe(0);
    expect(result.changesCount).toBe(0);
    expect(result.entitiesUpdated).toEqual([]);
    expect(readFileSync(result.digestPath, 'utf8')).toContain('0 evidence, 0 changes, 0 brain updates.');
  });

  it('writes daily digest to the correct path', async () => {
    const { brainDir, storeDir } = makeDirs();

    const result = await generateDailyDigest({
      profile: 'research-agent',
      date: today,
      storeDir,
      brainDir
    });

    expect(result.digestPath).toBe(join(brainDir, 'digest', 'daily', `${today}-research-agent.md`));
  });

  it('rejects unsafe digest profile and date segments before writing files', async () => {
    const { brainDir, storeDir } = makeDirs();

    await expect(
      generateDailyDigest({
        profile: '../escape',
        date: today,
        storeDir,
        brainDir
      })
    ).rejects.toThrow('Digest profile must be a safe filename segment.');

    await expect(
      generateDailyDigest({
        profile: 'research-agent',
        date: '../2026-05-25',
        storeDir,
        brainDir
      })
    ).rejects.toThrow('Digest date must be YYYY-MM-DD.');
  });

  it('rejects unsafe weekly digest weekStart before writing files', async () => {
    const { brainDir, storeDir } = makeDirs();

    await expect(
      generateWeeklyDigest({
        profile: 'research-agent',
        weekStart: '2026-05-25/../../escape',
        storeDir,
        brainDir
      })
    ).rejects.toThrow('Digest weekStart must be YYYY-MM-DD.');
  });

  it('DigestResult counts match filtered evidence and changes', async () => {
    const { brainDir, storeDir } = makeDirs();
    await appendEvidence(storeDir, {
      profile: 'research-agent',
      source: 'local-docs',
      intent: 'web_research',
      summary: 'Today record.',
      trust: 'medium',
      capturedAt: todayTimestamp
    });
    await appendEvidence(storeDir, {
      profile: 'other-agent',
      source: 'local-docs',
      intent: 'web_research',
      summary: 'Other profile.',
      trust: 'medium',
      capturedAt: todayTimestamp
    });
    await appendChange(storeDir, {
      target: 'policy.x',
      targetType: 'policy',
      action: 'verify',
      actor: 'codex',
      reason: 'Today change.',
      changedAt: todayTimestamp
    });

    const result = await generateDailyDigest({
      profile: 'research-agent',
      date: today,
      storeDir,
      brainDir
    });

    expect(result.evidenceCount).toBe(1);
    expect(result.changesCount).toBe(1);
    expect(result.summary).toBe('1 evidence, 1 changes, 0 brain updates.');
  });

  it('generateWeeklyDigest reads daily digests for the seven-day window', async () => {
    const { brainDir, storeDir } = makeDirs();
    const dailyDir = join(brainDir, 'digest', 'daily');
    await mkdir(dailyDir, { recursive: true });
    writeFileSync(join(dailyDir, '2026-05-25-research-agent.md'), '# Daily 1\n\nSignal one.', 'utf8');
    writeFileSync(join(dailyDir, '2026-05-27-research-agent.md'), '# Daily 2\n\nSignal two.', 'utf8');
    writeFileSync(join(dailyDir, '2026-06-05-research-agent.md'), '# Out of range', 'utf8');

    const result = await generateWeeklyDigest({
      profile: 'research-agent',
      weekStart: '2026-05-25',
      storeDir,
      brainDir
    });

    expect(result.digestPath).toBe(join(brainDir, 'digest', 'weekly', '2026-05-25-research-agent.md'));
    const markdown = readFileSync(result.digestPath, 'utf8');
    expect(markdown).toContain('Signal one.');
    expect(markdown).toContain('Signal two.');
    expect(markdown).not.toContain('Out of range');
  });

  it('generateWeeklyDigest returns evidence, change, and brain update counts for the week', async () => {
    const { brainDir, storeDir } = makeDirs();
    await appendEvidence(storeDir, {
      profile: 'research-agent',
      source: 'local-docs',
      intent: 'web_research',
      summary: 'Weekly in-range evidence.',
      trust: 'high',
      capturedAt: '2026-05-26T10:00:00.000Z'
    });
    await appendEvidence(storeDir, {
      profile: 'research-agent',
      source: 'local-docs',
      intent: 'web_research',
      summary: 'Out-of-range evidence.',
      trust: 'high',
      capturedAt: '2026-06-05T10:00:00.000Z'
    });
    await appendChange(storeDir, {
      target: 'policy.weekly',
      targetType: 'policy',
      action: 'verify',
      actor: 'codex',
      reason: 'Weekly in-range change.',
      changedAt: '2026-05-27T10:00:00.000Z'
    });
    await createEntity(
      brainDir,
      storeDir,
      {
        id: 'weekly-topic',
        kind: 'topic',
        name: 'Weekly Topic',
        filePath: 'entities/topics/weekly-topic.md',
        tags: ['weekly'],
        trust: 'medium',
        summary: 'Weekly topic.'
      },
      '# Weekly Topic',
      'research-agent'
    );
    const index = await readBrainIndex(brainDir);
    index.entities[0].lastUpdated = '2026-05-28T10:00:00.000Z';
    await writeBrainIndex(brainDir, index);

    const result = await generateWeeklyDigest({
      profile: 'research-agent',
      weekStart: '2026-05-25',
      storeDir,
      brainDir
    });

    expect(result.evidenceCount).toBe(1);
    expect(result.changesCount).toBe(2);
    expect(result.entitiesUpdated).toEqual(['weekly-topic']);
    expect(result.summary).toBe('1 evidence, 2 changes, 1 brain updates, 0 daily digests rolled up.');
  });
});
