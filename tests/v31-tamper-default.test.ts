import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';
import { loadControlPlane, multiAgentExampleControlPlanePath } from '../src/loader.js';

describe('v3.1 tamperMode default', () => {
  it('fails closed on corrupt health state when tamperMode is not explicitly set', async () => {
    const storeDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-tamper-default-'));
    writeFileSync(join(storeDir, 'health.json'), '{"sources":[],"prevHash":"bad"}', 'utf8');

    const cmdb = createAgentCmdb({
      controlPlane: loadControlPlane(multiAgentExampleControlPlanePath),
      storeDir
    });

    await expect(cmdb.ops.getSourceHealth('web-search-api')).rejects.toMatchObject({
      name: 'CorruptStoreError'
    });
  });
});
