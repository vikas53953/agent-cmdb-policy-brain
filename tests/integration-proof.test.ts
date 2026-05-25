import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAgentCmdb } from '../src/interface.js';

describe('Integration proof - full agent lifecycle', () => {
  it('runs a complete agent workday and verifies every artifact', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'agent-cmdb-integration-proof-'));

    try {
      const configPath = join(process.cwd(), 'demo', 'policy-library.yaml');
      const storeDir = join(tempRoot, 'state');
      const brainDir = join(tempRoot, 'brain');
      const cmdb = createAgentCmdb({ configPath, storeDir, brainDir });
      const profile = 'research-agent';
      const entityId = 'ai-agent-security';
      const findings = [
        'New CVE-2026-1234 affects a generic agent executor',
        'Updated AI Agent Security Top 10 guidance published',
        'Research paper: sandboxing agent tool calls reduces risk 40%'
      ];

      // 1. Health check passes
      const initialHealth = cmdb.health();
      expect(initialHealth.ok).toBe(true);
      expect(initialHealth.errors).toBe(0);

      // 2. Brain is empty at start (listEntities returns [])
      const initialEntities = await cmdb.memory.listEntities();
      expect(initialEntities).toEqual([]);

      // 3. Allowed preflight returns correct route with sources
      const allowedPreflight = await cmdb.policy.preflight({
        profile,
        action: 'web_search',
        tool: 'web-search-api',
        intent: 'web_research'
      });
      expect(allowedPreflight.allowed).toBe(true);
      expect(allowedPreflight.route?.sources.map((source) => source.id)).toEqual([
        'local-docs',
        'web-search-api',
        'news-aggregator'
      ]);

      // 4. Denied preflight returns reason, canEscalate, suggestedAlternative
      const deniedPreflight = await cmdb.policy.preflight({
        profile,
        action: 'social_post',
        intent: 'marketing'
      });
      expect(deniedPreflight.allowed).toBe(false);
      expect(deniedPreflight.decision.reason).toContain('Social media posting is disabled');
      expect(deniedPreflight.decision.canEscalate).toBe(false);
      expect(deniedPreflight.decision.suggestedAlternative).toContain('Save a draft');

      // 5. Dry-run preflight does NOT increase evidence count
      const evidenceBeforeDryRun = await cmdb.memory.listEvidence();
      const dryRun = await cmdb.policy.preflight({
        profile,
        action: 'web_search',
        tool: 'web-search-api',
        intent: 'web_research',
        dryRun: true
      });
      const evidenceAfterDryRun = await cmdb.memory.listEvidence();
      expect(dryRun.allowed).toBe(true);
      expect(dryRun.dryRun).toBe(true);
      expect(evidenceAfterDryRun).toHaveLength(evidenceBeforeDryRun.length);

      // 6. logEvidence writes 3 records, each with unique ID
      const writtenEvidence = await Promise.all(
        findings.map((summary) =>
          cmdb.memory.logEvidence({
            profile,
            source: 'web-search-api',
            intent: 'web_research',
            summary,
            trust: 'high',
            capturedAt: new Date().toISOString(),
            tags: ['integration-proof', 'security']
          })
        )
      );
      expect(writtenEvidence).toHaveLength(3);
      expect(new Set(writtenEvidence.map((record) => record.id)).size).toBe(3);

      // 7. listEvidence returns all 3 manual findings, filterable by profile
      const evidence = await cmdb.memory.listEvidence();
      const profileEvidence = await cmdb.memory.listEvidence({ profile });
      const manualEvidence = await cmdb.memory.listEvidence({ tag: 'integration-proof' });
      expect(evidence).toHaveLength(4);
      expect(manualEvidence).toHaveLength(3);
      expect(profileEvidence.every((record) => record.profile === profile)).toBe(true);

      // 8. createEntity creates brain entity, readable via readEntity
      const createdEntity = await cmdb.memory.createEntity(
        {
          id: entityId,
          kind: 'topic',
          name: 'AI Agent Security',
          filePath: 'entities/topics/ai-agent-security.md',
          tags: ['security', 'agents', 'cve'],
          trust: 'high',
          summary: 'Security research about agent vulnerabilities and defenses'
        },
        `# AI Agent Security\n\n${findings.map((finding) => `- ${finding}`).join('\n')}\n`,
        profile
      );
      const firstRead = await cmdb.memory.readEntity(entityId);
      expect(createdEntity.id).toBe(entityId);
      expect(firstRead.entity.id).toBe(entityId);

      // 9. readEntity returns content, ageMs, stale=false
      expect(firstRead.content).toContain(findings[0]);
      expect(firstRead.ageMs).toBeGreaterThanOrEqual(0);
      expect(firstRead.stale).toBe(false);

      // 10. searchEntities finds the entity by keyword
      const searchResults = await cmdb.memory.searchEntities({ keyword: 'security' });
      expect(searchResults.map((entity) => entity.id)).toContain(entityId);

      // 11. listEntities returns 1 entity
      const entities = await cmdb.memory.listEntities();
      expect(entities).toHaveLength(1);

      // 12. writeEntity with appendOnly adds content with separator
      const appendedEntity = await cmdb.memory.writeEntity({
        entityId,
        content: '- New sandboxing checklist added',
        actor: profile,
        reason: 'Append integration proof update',
        appendOnly: true
      });
      const afterAppend = await cmdb.memory.readEntity(entityId);
      expect(appendedEntity.id).toBe(entityId);
      expect(afterAppend.content).toContain('---\n## Update');

      // 13. readEntity after append contains BOTH original and new content
      expect(afterAppend.content).toContain(findings[0]);
      expect(afterAppend.content).toContain('New sandboxing checklist added');

      // 14. logChange writes a change record
      const decisionChange = await cmdb.memory.logChange({
        target: `brain.${entityId}`,
        targetType: 'memory',
        action: 'update',
        actor: profile,
        reason: 'Recorded integration proof brain update',
        changedAt: new Date().toISOString()
      });
      expect(decisionChange.target).toBe(`brain.${entityId}`);

      // 15. listChanges returns the change record
      const changes = await cmdb.memory.listChanges({ target: `brain.${entityId}` });
      expect(changes.map((change) => change.id)).toContain(decisionChange.id);

      // 16. generateDailyDigest produces a file on disk
      const dailyDigest = await cmdb.memory.generateDailyDigest(profile);
      expect(existsSync(dailyDigest.digestPath)).toBe(true);

      // 17. Digest file content contains evidence summaries
      const dailyDigestContent = readFileSync(dailyDigest.digestPath, 'utf8');
      expect(dailyDigestContent).toContain(findings[0]);
      expect(dailyDigestContent).toContain(findings[1]);

      // 18. Digest evidenceCount matches actual evidence count
      expect(dailyDigest.evidenceCount).toBe(evidence.length);

      // 19. generateWeeklyDigest produces a weekly file
      const weeklyDigest = await cmdb.memory.generateWeeklyDigest(profile);
      expect(existsSync(weeklyDigest.digestPath)).toBe(true);

      // 20. health() still passes after all operations
      const finalHealth = cmdb.health();
      expect(finalHealth.ok).toBe(true);

      // 21. report() returns correct counts
      const report = cmdb.policy.report();
      expect(report.counts.profiles).toBe(2);
      expect(report.counts.sources).toBe(3);

      // 22. validate() returns no errors
      const validation = cmdb.policy.validate();
      expect(validation.filter((issue) => issue.severity === 'error')).toEqual([]);

      console.log('=== INTEGRATION PROOF ===');
      console.log(`Evidence: ${evidence.length}`);
      console.log(`Changes: ${(await cmdb.memory.listChanges()).length}`);
      console.log(`Brain entities: ${(await cmdb.memory.listEntities()).length}`);
      console.log('Digest generated: yes');
      console.log('Cross-method data flow: verified');
      console.log('=========================');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
