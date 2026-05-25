import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { appendEvidence, listEvidence } from '../src/store.js';

const targets = [100, 1_000, 5_000, 10_000, 25_000, 50_000];
const storeDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-evidence-bench-'));
let written = 0;

console.log('records | listEvidence ms | append ms');
console.log('--------|-----------------|----------');

for (const target of targets) {
  const appendStart = performance.now();
  for (; written < target; written += 1) {
    await appendEvidence(storeDir, {
      profile: 'bench-agent',
      source: 'bench-source',
      intent: 'bench',
      summary: `Evidence benchmark record ${written}`,
      trust: 'medium',
      capturedAt: '2026-05-25T00:00:00.000Z'
    });
  }
  const appendMs = performance.now() - appendStart;

  const listStart = performance.now();
  const records = await listEvidence(storeDir, {
    profile: 'bench-agent',
    dateRange: {
      from: '2026-05-25',
      to: '2026-05-25'
    }
  });
  const listMs = performance.now() - listStart;

  console.log(`${records.length} | ${listMs.toFixed(2)} | ${appendMs.toFixed(2)}`);
}
