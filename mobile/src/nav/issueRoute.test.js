import { describe, it, expect } from 'vitest';
import { issueRoute } from './issueRoute.js';
import { deriveIncidents } from '../data/derive.js';

describe('issueRoute (#279)', () => {
  it('a service row opens Service detail by uid', () => {
    expect(issueRoute({ id: 'service:vm-101:nginx', target: { kind: 'service', uid: 'vm-101:nginx', url: 'http://h' } }))
      .toEqual({ screen: 'serviceDetail', params: { uid: 'vm-101:nginx' } });
  });

  it('a node row opens Node detail by node key', () => {
    expect(issueRoute({ id: 'node:vm-101', target: { kind: 'node', nodeKey: 'vm-101' } }))
      .toEqual({ screen: 'node', params: { nodeKey: 'vm-101' } });
  });

  it('UPS and cron rows open Incident detail by incident id', () => {
    expect(issueRoute({ id: 'ups:apcups', target: { kind: 'ups' } }))
      .toEqual({ screen: 'incident', params: { id: 'ups:apcups' } });
    expect(issueRoute({ id: 'cron:vm-103:backup', target: { kind: 'cron', node: 'vm-103', job: 'backup' } }))
      .toEqual({ screen: 'incident', params: { id: 'cron:vm-103:backup' } });
  });

  it('returns null when the row refers to nothing that can be opened', () => {
    expect(issueRoute({ id: 'x', target: { kind: 'weather' } })).toBeNull();
    expect(issueRoute({ id: 'service:', target: { kind: 'service', uid: '' } })).toBeNull();
    expect(issueRoute({ id: 'x' })).toBeNull();
    expect(issueRoute(null)).toBeNull();
  });

  it('every row deriveIncidents emits has somewhere to go', () => {
    const incidents = deriveIncidents({
      services: { nodes: { n: { display_name: 'N', services: [
        { uid: 'n:a', display_name: 'A', status: 'down' },
        { uid: 'n:b', display_name: 'B', status: 'unknown' },
      ] } } },
      ups: { status: 2, charge: 50 },
      cron: [{ node: 'n', jobs: [{ job: 'j', runs: [{ status: 'failure' }] }] }],
    });
    expect(incidents.map((i) => i.kind)).toEqual(['service', 'ups', 'cron', 'unknown']);
    for (const inc of incidents) expect(issueRoute(inc)).not.toBeNull();
  });
});
