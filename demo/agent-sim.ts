import { createAgentCmdb } from '../src/interface.js';
import { loadControlPlane } from '../src/loader.js';
import { formatDoctorReport, runDoctor } from '../src/doctor.js';

const configPath = './demo/control-plane.yaml';
const storeDir = './demo/state';
const brainDir = './demo/brain';
const profile = 'research-agent';
const entityId = 'ai-agent-security';

let attempted = 0;
let allowed = 0;
let denied = 0;

const cmdb = createAgentCmdb({ configPath, storeDir, brainDir });
const controlPlane = loadControlPlane(configPath);

await main();

async function main(): Promise<void> {
  printHeader('Agent CMDB - Live Demo (research-agent, day 1)');
  const health = cmdb.health();
  console.log(`[BOOT]       Control plane: ${health.ok ? 'HEALTHY' : 'UNHEALTHY'} (${health.errors} errors, ${health.warnings} warnings)`);
  if (!health.ok) {
    for (const issue of health.issues) {
      console.log(`[BOOT]       ${issue.severity.toUpperCase()}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const existing = await readPriorKnowledge();
  const evidenceBeforeDryRun = (await cmdb.listEvidence()).length;
  const search = cmdb.preflight({
    profile,
    action: 'web_search',
    tool: 'serpapi',
    intent: 'web_research'
  });
  attempted += 1;
  if (search.allowed) allowed += 1;
  console.log('[PREFLIGHT]  web_search via serpapi -> ALLOWED');
  console.log(`             Route: ${search.route?.sources.map((source) => source.id).join(' -> ') ?? 'none'}`);
  console.log(`             Guardrails: ${search.guardrails.join(', ')}`);
  await cmdb.logChange({
    target: search.decision.ruleId,
    targetType: 'policy',
    action: 'verify',
    actor: profile,
    reason: 'Verified allowed research action before execution.',
    changedAt: new Date().toISOString(),
    after: { allowed: search.allowed, route: search.route?.sources.map((source) => source.id) }
  });

  const blockedMarketing = cmdb.preflight({
    profile,
    action: 'social_post',
    tool: 'social-media-tool',
    intent: 'marketing'
  });
  attempted += 1;
  if (!blockedMarketing.allowed) denied += 1;
  console.log('[PREFLIGHT]  social_post via social-media-tool -> DENIED');
  console.log(`             Rule: ${blockedMarketing.decision.ruleId}`);
  console.log(`             Reason: ${blockedMarketing.decision.reason}`);
  console.log(`             Can escalate: ${blockedMarketing.decision.canEscalate}`);
  console.log(`             Try instead: ${blockedMarketing.decision.suggestedAlternative ?? 'none'}`);

  const dryRun = cmdb.preflight({
    profile,
    action: 'web_search',
    tool: 'serpapi',
    intent: 'web_research',
    dryRun: true
  });
  attempted += 1;
  if (dryRun.allowed) allowed += 1;
  const evidenceAfterDryRun = (await cmdb.listEvidence()).length;
  console.log(`[DRY-RUN]    web_search -> ${dryRun.allowed ? 'ALLOWED' : 'BLOCKED'} (no side effects logged)`);
  console.log(`             Evidence count stayed at ${evidenceAfterDryRun} (before: ${evidenceBeforeDryRun})`);

  const findings = [
    'New CVE-2026-1234 affects LangChain agent executor',
    'OWASP releases updated AI Agent Security Top 10',
    'Research paper: sandboxing agent tool calls reduces risk 40%'
  ];
  console.log(`[EXECUTE]    Researching via ${search.route?.sources.length ?? 0} sources...`);
  console.log(`             Found: ${findings.join('; ')}`);

  for (const finding of findings) {
    const record = await cmdb.logEvidence({
      profile,
      source: 'serpapi',
      intent: 'web_research',
      summary: finding,
      trust: 'high',
      capturedAt: new Date().toISOString(),
      tags: ['demo', 'security', 'agent-research']
    });
    console.log(`[EVIDENCE]   Logged ${record.id}`);
  }

  if (!existing) {
    const entity = await cmdb.createEntity(
      {
        id: entityId,
        kind: 'topic',
        name: 'AI Agent Security',
        filePath: 'entities/topics/ai-agent-security.md',
        tags: ['security', 'agents', 'cve'],
        trust: 'high',
        summary: 'Research on AI agent security vulnerabilities and defenses'
      },
      renderInitialMarkdown(findings),
      profile
    );
    console.log(`[BRAIN]      Created entity: ${entity.id} (${entity.kind})`);
    console.log(`             Tags: ${entity.tags.join(', ')}`);
  } else {
    const entity = await cmdb.writeEntity({
      entityId,
      content: renderUpdateMarkdown(findings),
      actor: profile,
      reason: 'New security findings discovered during demo research.',
      appendOnly: true
    });
    console.log(`[BRAIN]      Updated entity: ${entity.id}`);
  }

  await cmdb.logChange({
    target: `brain.${entityId}`,
    targetType: 'memory',
    action: 'update',
    actor: profile,
    reason: 'Updated with 3 new findings from daily research',
    changedAt: new Date().toISOString()
  });
  console.log(`[CHANGE]     Logged: brain.${entityId} updated`);

  const blockedShare = cmdb.preflight({
    profile,
    action: 'social_post',
    tool: 'social-media-tool',
    intent: 'share_findings'
  });
  attempted += 1;
  if (!blockedShare.allowed) denied += 1;
  await cmdb.logEvidence({
    profile,
    source: 'agent-cmdb-preflight',
    intent: 'share_findings',
    summary: `Blocked social_post: ${blockedShare.decision.reason}`,
    trust: 'high',
    capturedAt: new Date().toISOString(),
    tags: ['demo', 'blocked']
  });
  console.log('[BLOCKED]    social_post -> DENIED (logged as evidence)');

  const matches = await cmdb.searchEntities({ keyword: 'security' });
  console.log(`[SEARCH]     Brain search 'security' -> ${matches.length} entity found${matches.length === 1 ? '' : 's'}`);

  const digest = await cmdb.generateDailyDigest(profile);
  console.log(`[DIGEST]     Generated daily digest: ${digest.digestPath.replaceAll('\\', '/')}`);
  console.log(`             Summary: ${digest.summary}`);

  const doctor = await runDoctor({ controlPlane, storeDir, brainDir });
  console.log('[DOCTOR]     Full health report');
  console.log(indent(formatDoctorReport(doctor), '             '));

  const evidence = await cmdb.listEvidence();
  const changes = await cmdb.listChanges();
  const entities = await cmdb.listEntities();
  printSummary({
    attempted,
    allowed,
    denied,
    evidence: evidence.length,
    entities: entities.length,
    changes: changes.length,
    digestGenerated: Boolean(digest.digestPath)
  });
}

async function readPriorKnowledge(): Promise<boolean> {
  try {
    const knowledge = await cmdb.readEntity(entityId);
    console.log(`[BRAIN]      Found prior knowledge on '${entityId}'. Stale: ${knowledge.stale ? 'yes' : 'no'}.`);
    console.log(`             Preview: ${preview(knowledge.content)}`);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unknown brain entity')) {
      console.log(`[BRAIN]      No prior knowledge on '${entityId}'. Will learn today.`);
      return false;
    }
    throw error;
  }
}

function renderInitialMarkdown(findings: string[]): string {
  return `# AI Agent Security

## Day 1 Findings

${findings.map((finding) => `- ${finding}`).join('\n')}
`;
}

function renderUpdateMarkdown(findings: string[]): string {
  return findings.map((finding) => `- ${finding}`).join('\n');
}

function printHeader(title: string): void {
  console.log('+------------------------------------------------------+');
  console.log(`|  ${title.padEnd(50)}  |`);
  console.log('+------------------------------------------------------+');
}

function printSummary(summary: {
  attempted: number;
  allowed: number;
  denied: number;
  evidence: number;
  entities: number;
  changes: number;
  digestGenerated: boolean;
}): void {
  console.log('+------------------------------------------------------+');
  console.log('|  Summary                                             |');
  console.log('+------------------------------------------------------+');
  console.log(`  Actions attempted:  ${summary.attempted}`);
  console.log(`  Allowed:            ${summary.allowed}`);
  console.log(`  Denied:             ${summary.denied}`);
  console.log(`  Evidence records:   ${summary.evidence}`);
  console.log(`  Brain entities:     ${summary.entities}`);
  console.log(`  Changes logged:     ${summary.changes}`);
  console.log(`  Digest generated:   ${summary.digestGenerated ? 'yes' : 'no'}`);
  console.log('+------------------------------------------------------+');
}

function preview(content: string): string {
  return content.replace(/\s+/g, ' ').slice(0, 100);
}

function indent(value: string, prefix: string): string {
  return value.split('\n').map((line) => `${prefix}${line}`).join('\n');
}
