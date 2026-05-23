import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  generateReadinessReport,
  getObject,
  hermesV1ControlPlane,
  listObjects,
  preflightAction,
  resolveGraphNeighbors,
  validateControlPlane
} from '../src/engine';
import { appendChange, appendEvidence, listChanges, listEvidence } from '../src/store';

describe('Agent CMDB V2 inventory', () => {
  it('lists profile-scoped active Gemma objects', () => {
    const objects = listObjects(hermesV1ControlPlane, {
      profile: 'gemma4cloud',
      status: 'active'
    });

    expect(objects.map((object) => object.id)).toContain('profile.gemma4cloud');
    expect(objects.map((object) => object.id)).toContain('job.gemma-pp-radar');
    expect(objects.every((object) => object.profile === 'gemma4cloud' || object.kind === 'profile')).toBe(true);
  });

  it('finds paused GBrain as a memory object', () => {
    const object = getObject(hermesV1ControlPlane, 'memory.gbrain');

    expect(object.kind).toBe('memory');
    expect(object.status).toBe('paused');
    expect(object.notes).toContain('GBrain remains paused');
  });
});

describe('Agent CMDB V2 graph', () => {
  it('resolves Gemma profile neighbors', () => {
    const graph = resolveGraphNeighbors(hermesV1ControlPlane, 'profile.gemma4cloud');

    expect(graph.node.id).toBe('profile.gemma4cloud');
    expect(graph.neighbors.map((neighbor) => neighbor.node.id)).toContain('source.xai-oauth');
    expect(graph.neighbors.map((neighbor) => neighbor.relationship.type)).toContain('uses');
  });
});

describe('Agent CMDB V2 preflight', () => {
  it('denies blocked action before route matters', () => {
    const result = preflightAction(hermesV1ControlPlane, {
      profile: 'gemma4cloud',
      action: 'x_account_post',
      tool: 'xurl',
      intent: 'x_research'
    });

    expect(result.allowed).toBe(false);
    expect(result.decision.effect).toBe('deny');
    expect(result.route?.sources[0].id).toBe('xai-oauth');
  });

  it('allows Gemma read-only research and attaches source route', () => {
    const result = preflightAction(hermesV1ControlPlane, {
      profile: 'gemma4cloud',
      action: 'x_research',
      tool: 'xai-oauth',
      intent: 'x_research'
    });

    expect(result.allowed).toBe(true);
    expect(result.decision.ruleId).toBe('gemma-allow-readonly-research');
    expect(result.route?.sources.map((source) => source.id)).toEqual([
      'xai-oauth',
      'last30days',
      'techmeme-pp-cli',
      'hackernews-pp-cli'
    ]);
  });
});

describe('Agent CMDB V2 validation and report', () => {
  it('validates starter control plane without errors', () => {
    const issues = validateControlPlane(hermesV1ControlPlane);

    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('generates readiness report counts', () => {
    const report = generateReadinessReport(hermesV1ControlPlane);

    expect(report.version).toBe('agent-cmdb-v2');
    expect(report.counts.profiles).toBe(2);
    expect(report.counts.policies).toBeGreaterThanOrEqual(6);
    expect(report.guardrails.deniedActions).toContain('x_account_post');
    expect(report.validation.errors).toBe(0);
  });
});

describe('Agent CMDB V2 file stores', () => {
  it('records and filters evidence', async () => {
    const storeDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-evidence-'));

    await appendEvidence(storeDir, {
      profile: 'gemma4cloud',
      source: 'techmeme-pp-cli',
      intent: 'x_research',
      summary: 'Techmeme surfaced an agent-platform funding signal.',
      trust: 'medium',
      capturedAt: '2026-05-24T00:00:00.000Z',
      links: ['https://example.invalid/signal']
    });

    await appendEvidence(storeDir, {
      profile: 'apple-farming',
      source: 'open-meteo-pp-cli',
      intent: 'weather',
      summary: 'Weather window looked spray-safe.',
      trust: 'high',
      capturedAt: '2026-05-24T00:01:00.000Z'
    });

    const gemmaEvidence = await listEvidence(storeDir, { profile: 'gemma4cloud' });

    expect(gemmaEvidence).toHaveLength(1);
    expect(gemmaEvidence[0].source).toBe('techmeme-pp-cli');
  });

  it('records and filters change log entries', async () => {
    const storeDir = mkdtempSync(join(tmpdir(), 'agent-cmdb-changes-'));

    await appendChange(storeDir, {
      target: 'policy.global-deny-xurl-account-actions',
      targetType: 'policy',
      action: 'update',
      actor: 'codex',
      reason: 'Keep xurl disabled while using Grok OAuth lane.',
      changedAt: '2026-05-24T00:02:00.000Z',
      before: { enabled: true },
      after: { enabled: true, verified: true }
    });

    const changes = await listChanges(storeDir, {
      target: 'policy.global-deny-xurl-account-actions'
    });

    expect(changes).toHaveLength(1);
    expect(changes[0].reason).toContain('xurl disabled');
  });
});
