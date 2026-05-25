import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { listEntities, readEntity } from '../src/brain.js';
import type { BrainEntity, BrainIndex } from '../src/types.js';

const targets = [100, 1_000, 5_000, 10_000, 25_000, 50_000];
const brainDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-brain-bench-'));
const entities: BrainEntity[] = [];

mkdirSync(join(brainDir, 'entities', 'topics'), { recursive: true });
console.log('entities | listEntities ms | readEntity ms | index write ms');
console.log('---------|-----------------|---------------|---------------');

for (const target of targets) {
  const writeStart = performance.now();
  for (let index = entities.length; index < target; index += 1) {
    const id = `bench-topic-${index}`;
    const filePath = `entities/topics/${id}.md`;
    const absolutePath = join(brainDir, filePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `# Bench Topic ${index}\n\nBenchmark content ${index}.\n`, 'utf8');
    entities.push({
      id,
      kind: 'topic',
      name: `Bench Topic ${index}`,
      filePath,
      tags: ['bench'],
      trust: 'medium',
      lastUpdated: '2026-05-25T00:00:00.000Z',
      lastUpdatedBy: 'benchmark',
      summary: `Benchmark entity ${index}`
    });
  }
  const index: BrainIndex = {
    version: '1.0',
    updatedAt: '2026-05-25T00:00:00.000Z',
    entities
  };
  writeFileSync(join(brainDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
  const writeMs = performance.now() - writeStart;

  const listStart = performance.now();
  const listed = await listEntities(brainDir);
  const listMs = performance.now() - listStart;

  const readStart = performance.now();
  await readEntity(brainDir, `bench-topic-${target - 1}`);
  const readMs = performance.now() - readStart;

  console.log(`${listed.length} | ${listMs.toFixed(2)} | ${readMs.toFixed(2)} | ${writeMs.toFixed(2)}`);
}
