import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defaultControlPlanePath,
  loadControlPlane,
  loadDefaultControlPlane,
  validateControlPlane
} from '../src/engine.js';

describe('Control plane loader', () => {
  it('loads the default JSON control plane and validates it without errors', () => {
    const controlPlane = loadDefaultControlPlane();
    const issues = validateControlPlane(controlPlane);

    expect(defaultControlPlanePath).toContain('examples');
    expect(controlPlane.version).toBe('1.0');
    expect(controlPlane.profiles.map((profile) => profile.id)).toEqual(['research-agent']);
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('throws a clean loader error for invalid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-cmdb-loader-invalid-json-'));
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{bad json', 'utf8');

    expect(() => loadControlPlane(file)).toThrow(`Failed to parse control plane JSON at ${file}:`);
  });

  it('throws a clean loader error when required arrays are missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-cmdb-loader-missing-arrays-'));
    const file = join(dir, 'bad.json');
    writeFileSync(file, JSON.stringify({ version: 'bad', updatedAt: '2026-05-24' }), 'utf8');

    expect(() => loadControlPlane(file)).toThrow('Control plane sources must be an array.');
  });

  it('refuses to load a control plane with validation errors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-cmdb-loader-validation-'));
    const file = join(dir, 'bad.json');
    const controlPlane = loadDefaultControlPlane();
    controlPlane.profiles[0].routes[0].sources = ['missing-source'];
    writeFileSync(file, JSON.stringify(controlPlane), 'utf8');

    expect(() => loadControlPlane(file)).toThrow(
      'Control plane validation failed: route_unknown_source: Route research-agent/web_research references unknown source missing-source.'
    );
  });
});
