#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  createEntity,
  deleteEntity,
  initBrainDir,
  listEntities,
  readEntity,
  searchEntities
} from './brain.js';
import {
  generateDailyDigest,
  generateWeeklyDigest
} from './digest.js';
import {
  formatDoctorReport,
  runDoctor
} from './doctor.js';
import { sourceFreshnessFromBrain } from './freshness.js';
import {
  evaluatePolicy,
  generateReadinessReport,
  inspectProfile,
  listObjects,
  loadControlPlane,
  loadDefaultControlPlane,
  preflightAction,
  resolveGraphNeighbors,
  resolveSourceRoute,
  validateControlPlane
} from './engine.js';
import { appendChange, appendEvidence, listChanges, listEvidence } from './store.js';
import type { ChangeAction, ObjectKind, ObjectStatus, TrustLevel } from './types.js';

type Command =
  | 'init'
  | 'brain'
  | 'digest'
  | 'digest-weekly'
  | 'doctor'
  | 'policy'
  | 'route'
  | 'inspect'
  | 'inventory'
  | 'sources'
  | 'preflight'
  | 'validate'
  | 'graph'
  | 'evidence-add'
  | 'evidence-list'
  | 'change-add'
  | 'change-list'
  | 'report';

interface ParsedArgs {
  command: Command;
  flags: Record<string, string>;
}

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);

  if (parsed.command === 'init') {
    await initProject(parsed.flags);
    return;
  }

  if (parsed.command === 'brain') {
    await handleBrainCommand(parsed.flags);
    return;
  }

  if (parsed.command === 'digest') {
    printJson(
      await generateDailyDigest({
        profile: required(parsed.flags, 'profile'),
        date: parsed.flags.date,
        storeDir: storeDir(parsed.flags),
        brainDir: brainDir(parsed.flags)
      })
    );
    return;
  }

  if (parsed.command === 'digest-weekly') {
    printJson(
      await generateWeeklyDigest({
        profile: required(parsed.flags, 'profile'),
        weekStart: parsed.flags['week-start'],
        storeDir: storeDir(parsed.flags),
        brainDir: brainDir(parsed.flags)
      })
    );
    return;
  }

  const controlPlane = loadCliControlPlane(parsed.flags);

  if (parsed.command === 'doctor') {
    console.log(
      formatDoctorReport(
        await runDoctor({
          controlPlane,
          storeDir: storeDir(parsed.flags),
          brainDir: brainDir(parsed.flags)
        })
      )
    );
    return;
  }

  if (parsed.command === 'policy') {
    const profile = required(parsed.flags, 'profile');
    const action = required(parsed.flags, 'action');
    const tool = parsed.flags.tool;
    printJson(evaluatePolicy(controlPlane, { profile, action, tool }));
    return;
  }

  if (parsed.command === 'route') {
    const profile = required(parsed.flags, 'profile');
    const intent = required(parsed.flags, 'intent');
    printJson(
      resolveSourceRoute(controlPlane, {
        profile,
        intent,
        freshness: await cliFreshness(controlPlane, parsed.flags)
      })
    );
    return;
  }

  if (parsed.command === 'inspect') {
    const profile = required(parsed.flags, 'profile');
    printJson(inspectProfile(controlPlane, profile));
    return;
  }

  if (parsed.command === 'inventory') {
    printJson(
      listObjects(controlPlane, {
        profile: parsed.flags.profile,
        kind: optionalObjectKind(parsed.flags.kind),
        status: optionalObjectStatus(parsed.flags.status),
        tag: parsed.flags.tag
      })
    );
    return;
  }

  if (parsed.command === 'sources') {
    printJson(controlPlane.sources);
    return;
  }

  if (parsed.command === 'preflight') {
    const profile = required(parsed.flags, 'profile');
    const action = required(parsed.flags, 'action');
    const tool = parsed.flags.tool;
    const intent = parsed.flags.intent;
    printJson(
      preflightAction(controlPlane, {
        profile,
        action,
        tool,
        intent,
        dryRun: booleanFlag(parsed.flags, 'dry-run'),
        freshness: await cliFreshness(controlPlane, parsed.flags)
      })
    );
    return;
  }

  if (parsed.command === 'validate') {
    printJson(validateControlPlane(controlPlane));
    return;
  }

  if (parsed.command === 'graph') {
    printJson(resolveGraphNeighbors(controlPlane, required(parsed.flags, 'id')));
    return;
  }

  if (parsed.command === 'evidence-add') {
    printJson(
      await appendEvidence(storeDir(parsed.flags), {
        profile: required(parsed.flags, 'profile'),
        source: required(parsed.flags, 'source'),
        intent: required(parsed.flags, 'intent'),
        summary: required(parsed.flags, 'summary'),
        trust: optionalTrustLevel(parsed.flags.trust) ?? 'medium',
        capturedAt: parsed.flags['captured-at'] ?? new Date().toISOString(),
        links: parsed.flags.links ? parsed.flags.links.split(',').filter(Boolean) : undefined,
        tags: parsed.flags.tags ? parsed.flags.tags.split(',').filter(Boolean) : undefined
      })
    );
    return;
  }

  if (parsed.command === 'evidence-list') {
    printJson(
      await listEvidence(storeDir(parsed.flags), {
        profile: parsed.flags.profile,
        source: parsed.flags.source,
        intent: parsed.flags.intent,
        trust: optionalTrustLevel(parsed.flags.trust),
        tag: parsed.flags.tag
      })
    );
    return;
  }

  if (parsed.command === 'change-add') {
    printJson(
      await appendChange(storeDir(parsed.flags), {
        target: required(parsed.flags, 'target'),
        targetType: parseObjectKind(required(parsed.flags, 'target-type')),
        action: parseChangeAction(required(parsed.flags, 'action')),
        actor: parsed.flags.actor ?? 'codex',
        reason: required(parsed.flags, 'reason'),
        changedAt: parsed.flags['changed-at'] ?? new Date().toISOString()
      })
    );
    return;
  }

  if (parsed.command === 'change-list') {
    printJson(
      await listChanges(storeDir(parsed.flags), {
        target: parsed.flags.target,
        targetType: optionalObjectKind(parsed.flags['target-type']),
        actor: parsed.flags.actor,
        action: optionalChangeAction(parsed.flags.action)
      })
    );
    return;
  }

  if (parsed.command === 'report') {
    printJson(generateReadinessReport(controlPlane));
    return;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;

  const commands: Command[] = [
    'policy',
    'init',
    'brain',
    'digest',
    'digest-weekly',
    'doctor',
    'route',
    'inspect',
    'inventory',
    'sources',
    'preflight',
    'validate',
    'graph',
    'evidence-add',
    'evidence-list',
    'change-add',
    'change-list',
    'report'
  ];

  if (!command || !commands.includes(command as Command)) {
    throw new Error(
      'Usage: agent-cmdb <init|policy|route|inspect|inventory|sources|preflight|validate|graph|evidence-add|evidence-list|change-add|change-list|brain|digest|digest-weekly|doctor|report> [--key value]'
    );
  }

  const flags: Record<string, string> = {};
  let startIndex = 0;
  if (command === 'brain') {
    const subcommand = rest[0];
    if (!subcommand || subcommand.startsWith('--')) {
      throw new Error('Missing brain subcommand: list, read, search, create, delete.');
    }
    flags.subcommand = subcommand;
    startIndex = 1;
  }

  const booleanFlags = new Set(['dry-run']);
  for (let index = startIndex; index < rest.length;) {
    const key = rest[index];
    const value = rest[index + 1];

    if (!key?.startsWith('--')) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}.`);
    }

    const flagName = key.slice(2);
    if (booleanFlags.has(flagName) && (!value || value.startsWith('--'))) {
      flags[flagName] = 'true';
      index += 1;
      continue;
    }

    if (!value || value.startsWith('--')) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}.`);
    }

    flags[flagName] = value;
    index += 2;
  }

  return {
    command: command as Command,
    flags
  };
}

function required(flags: Record<string, string>, key: string): string {
  const value = flags[key];
  if (!value) {
    throw new Error(`Missing required --${key}.`);
  }
  return value;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function storeDir(flags: Record<string, string>): string {
  return flags.store ?? flags['store-dir'] ?? join(process.cwd(), 'agent-cmdb', 'state');
}

function brainDir(flags: Record<string, string>): string {
  return flags['brain-dir'] ?? join(process.cwd(), 'agent-cmdb', 'brain');
}

function booleanFlag(flags: Record<string, string>, key: string): boolean {
  const value = flags[key];
  if (value === undefined) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid boolean flag --${key}: ${value}. Valid values: true, false.`);
}

async function cliFreshness(controlPlane: ReturnType<typeof loadCliControlPlane>, flags: Record<string, string>) {
  if (!controlPlane.sources.some((source) => source.freshnessTtl)) {
    return undefined;
  }
  return sourceFreshnessFromBrain(controlPlane, brainDir(flags));
}

function loadCliControlPlane(flags: Record<string, string>) {
  if (flags.config) {
    return loadControlPlane(resolve(flags.config));
  }

  const localConfig = join(process.cwd(), 'agent-cmdb', 'config', 'control-plane.yaml');
  if (existsSync(localConfig)) {
    return loadControlPlane(localConfig);
  }

  return loadDefaultControlPlane();
}

async function initProject(flags: Record<string, string>): Promise<void> {
  const root = resolve(flags.dir ?? process.cwd());
  const configDir = join(root, 'agent-cmdb', 'config');
  const stateDir = join(root, 'agent-cmdb', 'state');

  await mkdir(configDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFileIfMissing(join(configDir, 'control-plane.yaml'), initControlPlaneYaml);
  await writeFileIfMissing(join(stateDir, 'evidence.jsonl'), '');
  await writeFileIfMissing(join(stateDir, 'changes.jsonl'), '');
  await initBrainDir(join(root, 'agent-cmdb', 'brain'));
  await writeFileIfMissing(join(root, 'agent-cmdb.config.ts'), initTypescriptConfig);

  console.log(`Initialized Agent CMDB in ${join(root, 'agent-cmdb')}`);
}

async function writeFileIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') return;
    throw error;
  }
}

async function handleBrainCommand(flags: Record<string, string>): Promise<void> {
  const command = required(flags, 'subcommand');
  const dir = brainDir(flags);

  if (command === 'list') {
    printJson(await listEntities(dir, optionalBrainKind(flags.kind)));
    return;
  }

  if (command === 'read') {
    const result = await readEntity(dir, required(flags, 'id'));
    console.log(result.content);
    return;
  }

  if (command === 'search') {
    printJson(
      await searchEntities(dir, {
        keyword: flags.keyword,
        kind: optionalBrainKind(flags.kind),
        tag: flags.tag,
        updatedAfter: flags['updated-after'],
        updatedBefore: flags['updated-before']
      })
    );
    return;
  }

  if (command === 'create') {
    const kind = parseBrainKind(required(flags, 'kind'));
    printJson(
      await createEntity(
        dir,
        storeDir(flags),
        {
          id: required(flags, 'id'),
          kind,
          name: required(flags, 'name'),
          filePath: flags['file-path'] ?? defaultBrainFilePath(kind, required(flags, 'id')),
          tags: flags.tags ? flags.tags.split(',').filter(Boolean) : [],
          trust: optionalTrustLevel(flags.trust) ?? 'medium',
          summary: required(flags, 'summary')
        },
        required(flags, 'content'),
        flags.actor ?? 'codex'
      )
    );
    return;
  }

  if (command === 'delete') {
    await deleteEntity(dir, storeDir(flags), required(flags, 'id'), flags.actor ?? 'codex', required(flags, 'reason'));
    printJson({ deleted: required(flags, 'id') });
    return;
  }

  throw new Error(`Unknown brain subcommand: ${command}.`);
}

function optionalObjectKind(value: string | undefined): ObjectKind | undefined {
  return value ? parseObjectKind(value) : undefined;
}

function parseObjectKind(value: string): ObjectKind {
  const values: ObjectKind[] = ['profile', 'source', 'tool', 'job', 'memory', 'policy', 'workspace'];
  if (!values.includes(value as ObjectKind)) {
    throw new Error(`Invalid object kind: ${value}. Valid values: ${values.join(', ')}.`);
  }
  return value as ObjectKind;
}

function optionalBrainKind(value: string | undefined) {
  return value ? parseBrainKind(value) : undefined;
}

function parseBrainKind(value: string) {
  const aliases: Record<string, 'person' | 'company' | 'topic' | 'tool' | 'project'> = {
    people: 'person',
    companies: 'company',
    topics: 'topic',
    tools: 'tool',
    projects: 'project'
  };
  const normalized = aliases[value] ?? value;
  if (!['person', 'company', 'topic', 'tool', 'project'].includes(normalized)) {
    throw new Error('Invalid brain kind. Valid values: person, company, topic, tool, project, people, companies, topics, tools, projects.');
  }
  return normalized as 'person' | 'company' | 'topic' | 'tool' | 'project';
}

function defaultBrainFilePath(kind: 'person' | 'company' | 'topic' | 'tool' | 'project', id: string): string {
  const dirByKind = {
    person: 'people',
    company: 'companies',
    topic: 'topics',
    tool: 'tools',
    project: 'projects'
  };
  return `entities/${dirByKind[kind]}/${id}.md`;
}

function optionalObjectStatus(value: string | undefined): ObjectStatus | undefined {
  return value ? parseObjectStatus(value) : undefined;
}

function parseObjectStatus(value: string): ObjectStatus {
  const values: ObjectStatus[] = ['active', 'paused', 'blocked', 'planned'];
  if (!values.includes(value as ObjectStatus)) {
    throw new Error(`Invalid object status: ${value}. Valid values: ${values.join(', ')}.`);
  }
  return value as ObjectStatus;
}

function optionalTrustLevel(value: string | undefined): TrustLevel | undefined {
  if (!value) return undefined;
  const values: TrustLevel[] = ['high', 'medium', 'low'];
  if (!values.includes(value as TrustLevel)) {
    throw new Error(`Invalid trust level: ${value}. Valid values: ${values.join(', ')}.`);
  }
  return value as TrustLevel;
}

function parseChangeAction(value: string): ChangeAction {
  const values: ChangeAction[] = ['create', 'update', 'pause', 'resume', 'delete', 'verify'];
  if (!values.includes(value as ChangeAction)) {
    throw new Error(`Invalid change action: ${value}. Valid values: ${values.join(', ')}.`);
  }
  return value as ChangeAction;
}

function optionalChangeAction(value: string | undefined): ChangeAction | undefined {
  return value ? parseChangeAction(value) : undefined;
}

const initControlPlaneYaml = `version: "1.0"
updatedAt: "2026-05-25"

sources:
  - id: serpapi
    label: SerpAPI Web Search
    kind: tool
    readOnly: true

  - id: local-docs
    label: Local Documentation
    kind: wiki
    readOnly: true
    freshnessTtl: 7d
    brainEntityId: agent-security

profiles:
  - id: research-agent
    name: Research Agent
    purpose: Web research and summarization
    guardrails:
      - Do not make purchases or financial transactions
      - Do not post to social media
      - Prefer local documentation before external search
    routes:
      - intent: web_research
        sources:
          - local-docs
          - serpapi

policies:
  - id: deny-social-posting
    effect: deny
    actions:
      - social_post
      - social_reply
      - social_dm
    reason: Social media posting is disabled for all agents
    canEscalate: false
    suggestedAlternative: Draft the post for a human to review.

  - id: allow-research
    effect: allow
    profiles:
      - research-agent
    actions:
      - web_search
      - summarize
      - extract
    tools:
      - serpapi
      - local-docs
    reason: Research agent can search and summarize read-only sources

objects:
  - id: profile.research-agent
    kind: profile
    label: Research Agent
    status: active
    profile: research-agent
    tags:
      - agent
      - research

  - id: source.local-docs
    kind: source
    label: Local Documentation
    status: active
    profile: research-agent
    tags:
      - docs
      - read-only

  - id: source.serpapi
    kind: source
    label: SerpAPI Web Search
    status: active
    profile: research-agent
    tags:
      - web
      - read-only

relationships:
  - from: profile.research-agent
    to: source.local-docs
    type: uses

  - from: profile.research-agent
    to: source.serpapi
    type: uses
`;

const initTypescriptConfig = `import type { AgentCmdbOptions } from '@pylabmit/agent-cmdb';

const config: AgentCmdbOptions = {
  configPath: './agent-cmdb/config/control-plane.yaml',
  storeDir: './agent-cmdb/state',
  brainDir: './agent-cmdb/brain'
};

export default config;
`;

try {
  await main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
