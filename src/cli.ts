#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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

  const controlPlane = loadCliControlPlane(parsed.flags);

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
    printJson(resolveSourceRoute(controlPlane, { profile, intent }));
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
    printJson(preflightAction(controlPlane, { profile, action, tool, intent }));
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
      'Usage: agent-cmdb <policy|route|inspect|inventory|sources|preflight|validate|graph|evidence-add|evidence-list|change-add|change-list|report> [--key value]'
    );
  }

  const flags: Record<string, string> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];

    if (!key?.startsWith('--') || !value) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}.`);
    }

    flags[key.slice(2)] = value;
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
  return flags.store ?? join(process.cwd(), 'agent-cmdb', 'state');
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
  await writeFile(join(configDir, 'control-plane.yaml'), initControlPlaneYaml, 'utf8');
  await writeFile(join(stateDir, 'evidence.jsonl'), '', 'utf8');
  await writeFile(join(stateDir, 'changes.jsonl'), '', 'utf8');
  await writeFile(join(root, 'agent-cmdb.config.ts'), initTypescriptConfig, 'utf8');

  console.log(`Initialized Agent CMDB in ${join(root, 'agent-cmdb')}`);
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
  storeDir: './agent-cmdb/state'
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
