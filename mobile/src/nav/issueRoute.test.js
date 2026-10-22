import { describe, it, expect } from 'vitest';
import { issueFor, issueRoute } from './issueRoute.js';
import { issueRowsOf } from '../data/board.js';
import { runScenario } from '../../../server/testing/statusScenarios.js';

describe('issueRoute (#279, #325)', () => {
  it('a service row opens Service detail by uid', () => {
    expect(issueRoute({ id: 'services/vm-101:nginx', target: { kind: 'service', uid: 'vm-101:nginx' } }))
      .toEqual({ screen: 'serviceDetail', params: { uid: 'vm-101:nginx' } });
  });

  it('a node row opens Node detail by node key', () => {
    expect(issueRoute({ id: 'nodes/vm-101', target: { kind: 'node', nodeKey: 'vm-101' } }))
      .toEqual({ screen: 'node', params: { nodeKey: 'vm-101' } });
  });

  it('any other issue (the UPS, a job, a source) opens Incident detail by its entity id', () => {
    expect(issueRoute({ id: 'power/ups', target: { kind: 'incident' } }))
      .toEqual({ screen: 'incident', params: { id: 'power/ups' } });
    expect(issueRoute({ id: 'jobs/vm-103:backup', target: { kind: 'incident' } }))
      .toEqual({ screen: 'incident', params: { id: 'jobs/vm-103:backup' } });
  });

  it('returns null when the row refers to nothing that can be opened', () => {
    expect(issueRoute({ id: 'x', target: { kind: 'weather' } })).toBeNull();
    expect(issueRoute({ id: 'services/', target: { kind: 'service', uid: '' } })).toBeNull();
    expect(issueRoute({ id: 'x' })).toBeNull();
    expect(issueRoute(null)).toBeNull();
  });

  it('every issue of every kind the model has goes somewhere, and comes back to itself', () => {
    const { status } = runScenario('every-state', { now: Date.parse('2026-10-19T12:00:00Z') });
    const rows = issueRowsOf({ status });
    expect(new Set(rows.map((r) => r.kind))).toEqual(
      new Set(['node', 'ups', 'container', 'service', 'job', 'backup', 'integration', 'agent'])
    );
    for (const row of rows) {
      const route = issueRoute(row);
      expect(route, row.id).not.toBeNull();
      if (route.screen === 'incident') expect(issueFor(status, route.params.id).id).toBe(row.id);
    }
  });
});

describe('issueFor', () => {
  const status = {
    issues: [{ id: 'services/n:a' }, { id: 'backups/pve:proxmox-backup' }, { id: 'jobs/n:j' }],
  };
  it('finds an issue by its entity id', () => {
    expect(issueFor(status, 'services/n:a')).toEqual({ id: 'services/n:a' });
    expect(issueFor(status, 'jobs/n:j')).toEqual({ id: 'jobs/n:j' });
  });
  it('finds a job the model files as a backup by its job id, as a push names it', () => {
    expect(issueFor(status, 'jobs/pve:proxmox-backup')).toEqual({ id: 'backups/pve:proxmox-backup' });
  });
  it('is null for what is no issue now, and for no status or no id', () => {
    expect(issueFor(status, 'services/gone')).toBeNull();
    expect(issueFor(null, 'services/n:a')).toBeNull();
    expect(issueFor(status, null)).toBeNull();
    expect(issueFor(status, '')).toBeNull();
  });
});
