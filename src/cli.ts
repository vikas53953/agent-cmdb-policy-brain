import { join } from 'node:path';
import {
  evaluatePolicy,
  generateReadinessReport,
  inspectProfile,
  listObjects,
  loadDefaultControlPlane,
  preflightAction,
  resolveGraphNeighbors,
  resolveSourceRoute,
  validateControlPlane
} from './engine.js';
import { appendChange, appendEvidence, listChanges, listEvidence } from './store.js';
import type { ChangeAction, ObjectKind, ObjectStatus, TrustLevel } from './types.js';

type Command =
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
  const controlPlane = loadDefaultControlPlane();

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

try {
  await main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
