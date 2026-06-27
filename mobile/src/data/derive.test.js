import { describe, it, expect } from 'vitest';
import {
  parseMetricPct, serviceIsProblem, flattenServices, sortProblemsFirst,
  groupByNode, thirdMetric, nodeUpDown, upsDegraded, cronDegraded,
  deriveSubsystems, deriveIncidents,
} from './derive.js';

const SERVICES_BODY = {
  nodes: {
    'vm-101': {
      display_name: 'VM 101', subtitle: 'app', icon: '🖥', border_color: '#6366f1',
      metrics: { cpu: '45.3', memPercent: '31.2', diskPercent: '55.6', diskUnit: 'GB', temp: null },
      services: [
        { uid: 'vm-101:adguard', container: 'adguard', display_name: 'AdGuard', name: 'AdGuard', icon: null, status: 'up', ping: 12, uptime24: 0.999, url: 'http://h/adguard', docker: null },
        { uid: 'vm-101:gitea', container: 'gitea', display_name: 'Gitea', name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://h/gitea', docker: null },
      ],
    },
    'gateway-pi': {
      display_name: 'Gateway Pi', subtitle: 'edge', icon: '🍓', border_color: '#34d399',
      metrics: { cpu: '8.0', memPercent: '40.0', temp: '52.1', diskPercent: '20.0', diskUnit: 'GB' },
      services: [
        { uid: 'gateway-pi:pihole', container: 'pihole', display_name: 'Pi-hole', name: 'Pi-hole', icon: null, status: 'unknown', ping: null, uptime24: null, url: '', docker: null },
      ],
    },
  },
};

describe('parseMetricPct', () => {
  it('parses string metrics to numbers', () => expect(parseMetricPct('45.3')).toBeCloseTo(45.3));
  it('returns null for null/garbage', () => {
    expect(parseMetricPct(null)).toBeNull();
    expect(parseMetricPct('n/a')).toBeNull();
  });
});

describe('serviceIsProblem', () => {
  it('only down is a problem', () => {
    expect(serviceIsProblem({ status: 'down' })).toBe(true);
    expect(serviceIsProblem({ status: 'up' })).toBe(false);
    expect(serviceIsProblem({ status: 'unknown' })).toBe(false);
  });
});

describe('flattenServices', () => {
  it('flattens and attaches nodeKey/nodeName', () => {
    const flat = flattenServices(SERVICES_BODY);
    expect(flat).toHaveLength(3);
    const gitea = flat.find((s) => s.uid === 'vm-101:gitea');
    expect(gitea.nodeKey).toBe('vm-101');
    expect(gitea.nodeName).toBe('VM 101');
  });
  it('tolerates a null/empty body', () => {
    expect(flattenServices(null)).toEqual([]);
    expect(flattenServices({ nodes: {} })).toEqual([]);
  });
});

describe('sortProblemsFirst', () => {
  it('puts down services first, keeps the rest stable, does not mutate', () => {
    const flat = flattenServices(SERVICES_BODY);
    const input = [...flat];
    const sorted = sortProblemsFirst(flat);
    expect(sorted[0].status).toBe('down');
    expect(sorted.map((s) => s.uid)).toEqual([
      'vm-101:gitea', 'gateway-pi:pihole', 'vm-101:adguard',
    ]);
    expect(flat).toEqual(input); // unmutated
  });
});

describe('groupByNode + nodeUpDown', () => {
  it('groups services under their node in entries order', () => {
    const groups = groupByNode(SERVICES_BODY);
    expect(groups.map((g) => g.nodeKey)).toEqual(['vm-101', 'gateway-pi']);
    expect(groups[0].services).toHaveLength(2);
  });
  it('counts up/down per node (unknown is not down)', () => {
    const node = SERVICES_BODY.nodes['vm-101'];
    expect(nodeUpDown(node)).toEqual({ up: 1, down: 1 });
    const pi = SERVICES_BODY.nodes['gateway-pi'];
    expect(nodeUpDown(pi)).toEqual({ up: 1, down: 0 }); // unknown counts as up-side
  });
});

describe('thirdMetric', () => {
  it('returns TEMP descriptor when temp is a numeric string', () => {
    const result = thirdMetric({ temp: '52.1', diskPercent: '20.0' });
    expect(result.label).toBe('TEMP');
    expect(result.value).toBe('52.1');
    expect(result.unit).toBe('°C');
    expect(result.percent).toBeCloseTo(52.1);
  });
  it('returns DISK descriptor when temp is null', () => {
    const result = thirdMetric({ temp: null, diskPercent: '55.6' });
    expect(result.label).toBe('DISK');
    expect(result.value).toBe('55.6');
    expect(result.unit).toBe('%');
    expect(result.percent).toBeCloseTo(55.6);
  });
  it('returns DISK descriptor when temp is a non-numeric/garbage string', () => {
    const result = thirdMetric({ temp: 'n/a', diskPercent: '30.0' });
    expect(result.label).toBe('DISK');
    expect(result.unit).toBe('%');
    expect(result.percent).toBeCloseTo(30.0);
  });
});

describe('upsDegraded / cronDegraded', () => {
  it('ups on battery is degraded; online or null is not', () => {
    expect(upsDegraded({ status: 0 })).toBe(true);
    expect(upsDegraded({ status: 1 })).toBe(false);
    expect(upsDegraded({ status: null })).toBe(false);
  });
  it('cron is degraded iff a job newest run failed', () => {
    const ok = [{ node: 'pi', jobs: [{ job: 'a', runs: [{ status: 'success', timestamp: 't' }] }] }];
    const bad = [{ node: 'pi', jobs: [{ job: 'b', runs: [{ status: 'failure', timestamp: 't', error: 'boom' }] }] }];
    expect(cronDegraded(ok)).toBe(false);
    expect(cronDegraded(bad)).toBe(true);
    expect(cronDegraded(null)).toBe(false);
  });
});

describe('deriveSubsystems', () => {
  it('marks Services + Cron degraded, Nodes + UPS calm', () => {
    const cron = [{ node: 'pi', jobs: [{ job: 'b', runs: [{ status: 'failure', timestamp: 't', error: 'boom' }] }] }];
    const cells = deriveSubsystems({ services: SERVICES_BODY, ups: { status: 1 }, cron });
    const byKey = Object.fromEntries(cells.map((c) => [c.key, c.degraded]));
    expect(byKey.services).toBe(true);  // gitea down
    expect(byKey.nodes).toBe(false);
    expect(byKey.ups).toBe(false);
    expect(byKey.cron).toBe(true);
    expect(cells.map((c) => c.key)).toEqual(['services', 'nodes', 'ups', 'cron']);
  });
});

describe('deriveIncidents', () => {
  it('emits one incident per down service, on-battery UPS, failing cron — ordered + stable', () => {
    const cron = [{ node: 'pi', jobs: [{ job: 'backup', runs: [{ status: 'failure', timestamp: 't', error: 'disk full' }] }] }];
    const incidents = deriveIncidents({ services: SERVICES_BODY, ups: { status: 0, charge: 80 }, cron });
    expect(incidents.map((i) => i.kind)).toEqual(['service', 'ups', 'cron']);
    const svc = incidents[0];
    expect(svc.id).toBe('service:vm-101:gitea');
    expect(svc.node).toBe('VM 101');
    expect(svc.uptime24).toBe(0.42);
    expect(incidents.find((i) => i.kind === 'cron').cause).toBe('disk full');
    // DEVIATION: hardcoded expected id order derived by hand from fixture data.
    // service incidents (rank 0) first, then ups (rank 1), then cron (rank 2).
    // Within rank, ordered by id lexical sort.
    // Services: only vm-101:gitea is 'down' → id='service:vm-101:gitea' (one service incident)
    // UPS: status=0 → id='ups:apcups'
    // Cron: node='pi', job='backup' fails → id='cron:pi:backup'
    // Final order: ['service:vm-101:gitea', 'ups:apcups', 'cron:pi:backup']
    expect(incidents.map((i) => i.id)).toEqual([
      'service:vm-101:gitea',
      'ups:apcups',
      'cron:pi:backup',
    ]);
  });

  it('emits one incident per failing cron job when multiple jobs fail', () => {
    const cron = [{
      node: 'pi',
      jobs: [
        { job: 'backup', runs: [{ status: 'failure', timestamp: 't', error: 'disk full' }] },
        { job: 'sync',   runs: [{ status: 'failure', timestamp: 't', error: 'timeout' }] },
      ],
    }];
    const incidents = deriveIncidents({ services: null, ups: { status: 1 }, cron });
    const cronIds = incidents.filter((i) => i.kind === 'cron').map((i) => i.id);
    expect(cronIds).toContain('cron:pi:backup');
    expect(cronIds).toContain('cron:pi:sync');
    expect(cronIds).toHaveLength(2);
  });
});

describe('sortProblemsFirst (down → unknown → up)', () => {
  it('orders down first, unknown/presence in the middle, up last', () => {
    const input = [
      { uid: 'a', status: 'up' },
      { uid: 'b', status: 'unknown', source: 'presence' },
      { uid: 'c', status: 'down' },
    ];
    expect(sortProblemsFirst(input).map((s) => s.uid)).toEqual(['c', 'b', 'a']);
  });
});
