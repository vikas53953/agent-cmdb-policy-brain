import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
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
      scripts: Record<string, string>;
    };

    expect(packageJson.name).toBe('@pylabmit/agent-cmdb');
    expect(packageJson.private).toBeUndefined();
    expect(packageJson.version).toBe('1.0.0');
    expect(packageJson.main).toBe('dist/interface.js');
    expect(packageJson.types).toBe('dist/interface.d.ts');
    expect(packageJson.bin['agent-cmdb']).toBe('dist/cli.js');
    expect(packageJson.scripts.build).toBe('tsc -p tsconfig.build.json');
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

  it('loads a generic YAML control plane example', () => {
    const controlPlane = loadControlPlane(join(process.cwd(), 'examples', 'basic', 'control-plane.yaml'));

    expect(controlPlane.profiles.map((profile) => profile.id)).toContain('research-agent');
    expect(controlPlane.sources.map((source) => source.id)).toContain('serpapi');
  });

  it('loads every shipped example control plane', () => {
    for (const examplePath of [
      join(process.cwd(), 'examples', 'basic', 'control-plane.yaml'),
      join(process.cwd(), 'examples', 'multi-agent', 'control-plane.yaml'),
      join(process.cwd(), 'examples', 'hermes', 'control-plane.json'),
      join(process.cwd(), 'examples', 'langchain', 'control-plane.yaml')
    ]) {
      expect(loadControlPlane(examplePath).profiles.length).toBeGreaterThan(0);
    }
  });

  it('creates an Agent CMDB instance from configPath', () => {
    const cmdb = createAgentCmdb({
      configPath: join(process.cwd(), 'examples', 'basic', 'control-plane.yaml'),
      storeDir: mkdtempSync(join(tmpdir(), 'agent-cmdb-oss-configpath-'))
    });

    const result = cmdb.preflight({
      profile: 'research-agent',
      action: 'web_search',
      tool: 'serpapi',
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

    expect(existsSync(join(cwd, 'agent-cmdb', 'config', 'control-plane.yaml'))).toBe(true);
    expect(existsSync(join(cwd, 'agent-cmdb', 'state'))).toBe(true);
    expect(existsSync(join(cwd, 'agent-cmdb', 'state', 'evidence.jsonl'))).toBe(true);
    expect(existsSync(join(cwd, 'agent-cmdb', 'state', 'changes.jsonl'))).toBe(true);
    expect(existsSync(join(cwd, 'agent-cmdb.config.ts'))).toBe(true);

    const controlPlane = loadControlPlane(join(cwd, 'agent-cmdb', 'config', 'control-plane.yaml'));
    expect(controlPlane.profiles[0].id).toBe('research-agent');
  });
});
