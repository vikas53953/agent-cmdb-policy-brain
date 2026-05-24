import { readFile } from 'node:fs/promises';
import { createAgentCmdb } from '../src/interface.js';
import { loadControlPlane } from '../src/loader.js';
import { formatDoctorReport, runDoctor } from '../src/doctor.js';

const configPath = './demo/control-plane.yaml';
const storeDir = './demo/state';
const brainDir = './demo/brain';
const profile = 'research-agent';
const entityId = 'ai-agent-security';

const cmdb = createAgentCmdb({ configPath, storeDir, brainDir });
const controlPlane = loadControlPlane(configPath);

await main();

async function main(): Promise<void> {
  printHeader('Agent CMDB - Live Demo (research-agent, day 2)');
  const health = cmdb.health();
  console.log(`[BOOT]       Control plane: ${health.ok ? 'HEALTHY' : 'UNHEALTHY'} (${health.errors} errors, ${health.warnings} warnings)`);
  if (!health.ok) {
    for (const issue of health.issues) {
      console.log(`[BOOT]       ${issue.severity.toUpperCase()}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const knowledge = await cmdb.readEntity(entityId);
  console.log(`[BRAIN]      Found prior knowledge. Last updated: ${knowledge.entity.lastUpdated}.`);
  console.log(`             Stale: ${knowledge.stale ? 'yes' : 'no'}. Content preview: ${preview(knowledge.content)}.`);

  const search = await cmdb.preflight({
    profile,
    action: 'web_search',
    tool: 'serpapi',
    intent: 'web_research'
  });
  console.log(`[PREFLIGHT]  web_search via serpapi -> ${search.allowed ? 'ALLOWED' : 'DENIED'}`);
  console.log(`             Route: ${search.route?.sources.map((source) => source.id).join(' -> ') ?? 'none'}`);

  const findings = [
    'Agent policy sandboxes now require explicit filesystem scopes',
    'Tool-call allowlists reduced unauthorized actions in a benchmark'
  ];
  console.log('[EXECUTE]    Day 2 research found 2 new results');
  for (const finding of findings) {
    const record = await cmdb.logEvidence({
      profile,
      source: 'news-aggregator',
      intent: 'web_research',
      summary: finding,
      trust: 'medium',
      capturedAt: new Date().toISOString(),
      tags: ['demo', 'security', 'day-2']
    });
    console.log(`[EVIDENCE]   Logged ${record.id}`);
  }

  const updated = await cmdb.writeEntity({
    entityId,
    content: findings.map((finding) => `- ${finding}`).join('\n'),
    actor: profile,
    reason: 'Day 2 research added two new agent security findings.',
    appendOnly: true
  });
  console.log(`[BRAIN]      Appended to entity: ${updated.id}`);
  const brainMarkdown = await readFile(`./demo/brain/entities/topics/${entityId}.md`, 'utf8');
  console.log(`[BRAIN]      Append marker present: ${brainMarkdown.includes('---\n## Update') ? 'yes' : 'no'}`);

  const daily = await cmdb.generateDailyDigest(profile);
  console.log(`[DIGEST]     Generated day 2 daily digest: ${daily.digestPath.replaceAll('\\', '/')}`);
  console.log(`             Summary: ${daily.summary}`);

  const weekly = await cmdb.generateWeeklyDigest(profile);
  console.log(`[DIGEST]     Generated weekly digest: ${weekly.digestPath.replaceAll('\\', '/')}`);
  console.log(`             Weekly summary: ${weekly.summary}`);

  const doctor = await runDoctor({ controlPlane, storeDir, brainDir });
  console.log('[DOCTOR]     Full health report');
  console.log(indent(formatDoctorReport(doctor), '             '));

  const evidence = await cmdb.listEvidence({ profile });
  const changes = await cmdb.listChanges();
  console.log('+------------------------------------------------------+');
  console.log('|  Day 2 Summary                                       |');
  console.log('+------------------------------------------------------+');
  console.log(`  Total evidence across 2 days: ${evidence.length}`);
  console.log('  Brain entity updates: 2 (day 1 create + day 2 append)');
  console.log(`  Weekly digest covers: ${weekly.evidenceCount} evidence, ${weekly.changesCount} changes`);
  console.log(`  Total changes logged: ${changes.length}`);
  console.log('+------------------------------------------------------+');
}

function printHeader(title: string): void {
  console.log('+------------------------------------------------------+');
  console.log(`|  ${title.padEnd(50)}  |`);
  console.log('+------------------------------------------------------+');
}

function preview(content: string): string {
  return content.replace(/\s+/g, ' ').slice(0, 100);
}

function indent(value: string, prefix: string): string {
  return value.split('\n').map((line) => `${prefix}${line}`).join('\n');
}
