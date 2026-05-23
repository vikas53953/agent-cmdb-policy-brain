import { join } from 'node:path';
import {
  evaluatePolicy,
  generateReadinessReport,
  hermesV1ControlPlane,
  inspectProfile,
  listObjects,
  preflightAction,
  resolveGraphNeighbors,
  resolveSourceRoute,
  validateControlPlane
} from './engine';
import { appendChange, appendEvidence, listChanges, listEvidence } from './store';

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

  if (parsed.command === 'policy') {
    const profile = required(parsed.flags, 'profile');
    const action = required(parsed.flags, 'action');
    const tool = parsed.flags.tool;
    printJson(evaluatePolicy(hermesV1ControlPlane, { profile, action, tool }));
    return;
  }

  if (parsed.command === 'route') {
    const profile = required(parsed.flags, 'profile');
    const intent = required(parsed.flags, 'intent');
    printJson(resolveSourceRoute(hermesV1ControlPlane, { profile, intent }));
    return;
  }

  if (parsed.command === 'inspect') {
    const profile = required(parsed.flags, 'profile');
    printJson(inspectProfile(hermesV1ControlPlane, profile));
    return;
  }

  if (parsed.command === 'inventory') {
    printJson(
      listObjects(hermesV1ControlPlane, {
        profile: parsed.flags.profile,
        kind: parsed.flags.kind as never,
        status: parsed.flags.status as never,
        tag: parsed.flags.tag
      })
    );
    return;
  }

  if (parsed.command === 'sources') {
    printJson(hermesV1ControlPlane.sources);
    return;
  }

  if (parsed.command === 'preflight') {
    const profile = required(parsed.flags, 'profile');
    const action = required(parsed.flags, 'action');
    const tool = parsed.flags.tool;
    const intent = parsed.flags.intent;
    printJson(preflightAction(hermesV1ControlPlane, { profile, action, tool, intent }));
    return;
  }

  if (parsed.command === 'validate') {
    printJson(validateControlPlane(hermesV1ControlPlane));
    return;
  }

  if (parsed.command === 'graph') {
    printJson(resolveGraphNeighbors(hermesV1ControlPlane, required(parsed.flags, 'id')));
    return;
  }

  if (parsed.command === 'evidence-add') {
    printJson(
      await appendEvidence(storeDir(parsed.flags), {
        profile: required(parsed.flags, 'profile'),
        source: required(parsed.flags, 'source'),
        intent: required(parsed.flags, 'intent'),
        summary: required(parsed.flags, 'summary'),
        trust: (parsed.flags.trust ?? 'medium') as never,
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
        trust: parsed.flags.trust as never
      })
    );
    return;
  }

  if (parsed.command === 'change-add') {
    printJson(
      await appendChange(storeDir(parsed.flags), {
        target: required(parsed.flags, 'target'),
        targetType: required(parsed.flags, 'target-type') as never,
        action: required(parsed.flags, 'action') as never,
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
        targetType: parsed.flags['target-type'] as never,
        actor: parsed.flags.actor
      })
    );
    return;
  }

  if (parsed.command === 'report') {
    printJson(generateReadinessReport(hermesV1ControlPlane));
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

try {
  await main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
