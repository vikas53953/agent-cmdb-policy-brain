import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadControlPlane } from '../src/loader.js';
import { createAgentCmdb } from '../src/interface.js';

const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

describe('OSS package shape', () => {
  it('has publishable package metadata and a build script', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      name: string;
      private?: boolean;
      version: string;
      main: string;
      types: string;
      bin: Record<string, string>;
      exports: Record<string, unknown>;
      scripts: Record<string, string>;
    };

    expect(packageJson.name).toBe('@pylabmit/agent-cmdb');
    expect(packageJson.private).toBeUndefined();
    expect(packageJson.version).toBe('3.0.0');
    expect(packageJson.main).toBe('dist/interface.js');
    expect(packageJson.types).toBe('dist/interface.d.ts');
    expect(packageJson.bin['agent-cmdb']).toBe('dist/cli.js');
    expect(packageJson.exports['./doctor']).toBe(null);
    expect(packageJson.exports['./duration']).toBe(null);
    expect(packageJson.exports['./freshness']).toBe(null);
    expect(packageJson.exports['./types']).toBeDefined();
    expect(packageJson.exports['./analytics']).toBe(null);
    expect(packageJson.exports['./brain']).toBe(null);
    expect(packageJson.exports['./digest']).toBe(null);
    expect(packageJson.exports['./route-resolver']).toBe(null);
    expect(packageJson.exports['./preflight']).toBeUndefined();
    expect(packageJson.exports['./policy-engine']).toBe(null);
    expect(packageJson.exports['./store']).toBe(null);
    expect(packageJson.scripts.build).toContain("rmSync('dist'");
    expect(packageJson.scripts.build).toContain('tsc -p tsconfig.build.json');
  });

  it('keeps private examples and internal reports out of the publish surface', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      files: string[];
    };

    expect(packageJson.files).toEqual([
      'dist',
      'examples/basic',
      'examples/multi-agent',
      'README.md',
      'LICENSE'
    ]);
    expect(existsSync(join(process.cwd(), 'examples', ['he', 'rmes'].join('')))).toBe(false);
    expect(packageJson.files).not.toContain('examples');
    expect(packageJson.files).not.toContain('reports');
    expect(packageJson.files).not.toContain('docs');
  });

  it('does not expose personal or vendor-specific terms in publishable source files', () => {
    const blockedTerms = [
      blockedTerm(['ge', 'mma', '4cloud'], 'i'),
      blockedTerm(['apple', '-farming'], 'i'),
      blockedTerm(['xu', 'rl'], 'i'),
      blockedTerm(['x', 'ai', '-oauth'], 'i'),
      blockedTerm(['pp', '-cli'], 'i'),
      blockedTerm(['neha', '-insta'], 'i'),
      blockedTerm(['NO', 'VA']),
      blockedTerm(['AT', 'LAS']),
      blockedTerm(['CI', 'PHER']),
      blockedTerm(['KI', 'RA']),
      blockedTerm(['Her', 'mes'], 'i'),
      blockedTerm(['Printing', ' Press'], 'i'),
      blockedTerm(['Forti', 'Manager']),
      blockedTerm(['Forti', 'Gate']),
      blockedTerm(['Forti', 'Analyzer']),
      blockedTerm(['Sev', 'One']),
      blockedTerm(['NP', '7'])
    ];
    const publishableFiles = collectTextFiles([
      join(process.cwd(), 'src'),
      join(process.cwd(), 'tests'),
      join(process.cwd(), 'examples'),
      join(process.cwd(), 'README.md'),
      join(process.cwd(), 'package.json')
    ]);
    const leaks = publishableFiles.flatMap((filePath) => {
      const content = readFileSync(filePath, 'utf8');
      return blockedTerms
        .filter((term) => term.test(content))
        .map((term) => `${filePath}: ${term.source}`);
    });

    expect(leaks).toEqual([]);
  });

  it('keeps framework concerns split into dedicated modules', () => {
    for (const fileName of [
      'policy-engine.ts',
      'route-resolver.ts',
      'graph-engine.ts',
      'validator.ts',
      'loader.ts',
      'preflight.ts'
    ]) {
      expect(existsSync(join(process.cwd(), 'src', fileName))).toBe(true);
    }
  });

  it('loads a generic YAML policy config example', () => {
    const controlPlane = loadControlPlane(join(process.cwd(), 'examples', 'basic', 'policy-library.yaml'));

    expect(controlPlane.sources.profiles.map((profile) => profile.id)).toContain('research-agent');
    expect(controlPlane.sources.sources.map((source) => source.id)).toContain('web-search-api');
  });

  it('loads every shipped example policy config', () => {
    for (const examplePath of [
      join(process.cwd(), 'examples', 'basic', 'policy-library.yaml'),
      join(process.cwd(), 'examples', 'multi-agent', 'policy-library.yaml')
    ]) {
      expect(loadControlPlane(examplePath).sources.profiles.length).toBeGreaterThan(0);
    }
  });

  it('creates an Agent CMDB instance from configPath', async () => {
    const cmdb = createAgentCmdb({
      configPath: join(process.cwd(), 'examples', 'basic', 'policy-library.yaml'),
      storeDir: mkdtempSync(join(tmpdir(), 'agent-cmdb-oss-configpath-'))
    });

    const result = await cmdb.policy.preflight({
      profile: 'research-agent',
      action: 'web_search',
      tool: 'web-search-api',
      intent: 'web_research'
    });

    expect(result.allowed).toBe(true);
    expect(result.route?.sources[0].id).toBe('local-docs');
  });

  it('scaffolds a generic config directory with init', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-cmdb-init-'));

    execFileSync(process.execPath, [tsxCli, join(process.cwd(), 'src', 'cli.ts'), 'init'], {
      cwd,
      encoding: 'utf8'
    });

    expect(existsSync(join(cwd, 'agent-cmdb', 'config', 'policy-library.yaml'))).toBe(true);
    expect(existsSync(join(cwd, 'agent-cmdb', 'state'))).toBe(true);
    expect(existsSync(join(cwd, 'agent-cmdb', 'brain', 'index.json'))).toBe(true);
    expect(existsSync(join(cwd, 'agent-cmdb.config.ts'))).toBe(true);

    const controlPlane = loadControlPlane(join(cwd, 'agent-cmdb', 'config', 'policy-library.yaml'));
    expect(controlPlane.sources.profiles[0].id).toBe('research-agent');
  });

  it('does not overwrite existing config or state when init is rerun', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agent-cmdb-init-idempotent-'));

    execFileSync(process.execPath, [tsxCli, join(process.cwd(), 'src', 'cli.ts'), 'init'], {
      cwd,
      encoding: 'utf8'
    });
    const configPath = join(cwd, 'agent-cmdb', 'config', 'policy-library.yaml');
    const evidencePath = join(cwd, 'agent-cmdb', 'state', 'evidence.jsonl');
    writeFileSync(configPath, 'version: "custom"\nprofiles: []\nsources: []\npolicies: []\n', 'utf8');
    writeFileSync(evidencePath, '{"id":"ev_keep"}\n', 'utf8');

    execFileSync(process.execPath, [tsxCli, join(process.cwd(), 'src', 'cli.ts'), 'init'], {
      cwd,
      encoding: 'utf8'
    });

    expect(readFileSync(configPath, 'utf8')).toContain('version: "custom"');
    expect(readFileSync(evidencePath, 'utf8')).toBe('{"id":"ev_keep"}\n');
  });
});

function collectTextFiles(paths: string[]): string[] {
  return paths.flatMap((path) => {
    if (!existsSync(path)) return [];
    const stat = statSync(path);
    if (stat.isFile()) return [path];
    return readdirSync(path)
      .flatMap((entry) => collectTextFiles([join(path, entry)]))
      .filter((filePath) => /\.(ts|json|ya?ml|md)$/.test(filePath));
  });
}

function blockedTerm(parts: string[], flags = ''): RegExp {
  return new RegExp(parts.join(''), flags);
}
