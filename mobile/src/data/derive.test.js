import { describe, it, expect } from 'vitest';
import {
  parseMetricPct, serviceIsProblem, flattenServices, sortProblemsFirst,
  groupByNode, thirdMetric, nodeUpDown, upsDegraded, cronDegraded,
  deriveSubsystems, deriveIncidents,
  SEVERITY, severityRank, maxSeverity, CPU_HOT, TEMP_HOT,
  statusToSeverity, statusToShape, formatRuntime,
  overallSeverity, nodeSeverity, hasUnknownService, subsystemSeverity,
  activeIncidentIds,
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

describe('deriveSubsystems (per-cell severity/word/detail shape)', () => {
  it('emits 4 cells in order, each with severity/word/detail (no degraded boolean)', () => {
    const cron = [{ node: 'pi', jobs: [{ job: 'b', runs: [{ status: 'failure', timestamp: 't', error: 'boom' }] }] }];
    const cells = deriveSubsystems({ services: SERVICES_BODY, ups: { status: 1, charge: 100 }, cron });
    expect(cells.map((c) => c.key)).toEqual(['services', 'nodes', 'ups', 'cron']);
    const byKey = Object.fromEntries(cells.map((c) => [c.key, c]));
    // Services carries the red (gitea down). detail = up(=total-down) / total = 2 / 3.
    expect(byKey.services).toMatchObject({ severity: 'critical', word: 'DOWN', detail: '2 / 3' });
    // Nodes is resource-only: vm-101 (cpu 45) hosts the down gitea but stays OK/green.
    expect(byKey.nodes).toMatchObject({ severity: 'healthy', word: 'OK', detail: '2 online' });
    expect(byKey.ups).toMatchObject({ severity: 'healthy', word: 'MAINS', detail: '100%' });
    expect(byKey.cron).toMatchObject({ severity: 'caution', word: 'FAILED', detail: '1 job' });
    // contract change: the old `degraded` boolean is gone
    expect(byKey.services.degraded).toBeUndefined();
    expect(byKey.cron.degraded).toBeUndefined();
  });

  it('unreachable → every cell NO SIGNAL / unknown / — (never green)', () => {
    const cells = deriveSubsystems({ services: SERVICES_BODY, ups: { status: 0 }, cron: [], unreachable: true });
    expect(cells.map((c) => c.key)).toEqual(['services', 'nodes', 'ups', 'cron']);
    for (const c of cells) {
      expect(c.severity).toBe('unknown');
      expect(c.word).toBe('NO SIGNAL');
      expect(c.detail).toBe('—');
    }
  });
});

describe('deriveIncidents', () => {
  it('emits one incident per down service, on-battery UPS, failing cron — ordered + stable', () => {
    const cron = [{ node: 'pi', jobs: [{ job: 'backup', runs: [{ status: 'failure', timestamp: 't', error: 'disk full' }] }] }];
    const incidents = deriveIncidents({ services: SERVICES_BODY, ups: { status: 0, charge: 80 }, cron });
    // SERVICES_BODY's pihole is status 'unknown' with no source → a tracked-unknown UNKN row
    // (new contract: deriveIncidents now also emits tracked-unknown services).
    expect(incidents.map((i) => i.kind)).toEqual(['service', 'ups', 'cron', 'unknown']);
    const svc = incidents[0];
    expect(svc.id).toBe('service:vm-101:gitea');
    expect(svc.node).toBe('VM 101');
    expect(svc.uptime24).toBe(0.42);
    expect(incidents.find((i) => i.kind === 'cron').cause).toBe('disk full');
    // Sort = down → ups → cron → unknown (stable by id within a kind).
    // Services: only vm-101:gitea is 'down' → 'service:vm-101:gitea'
    // UPS: status=0 → 'ups:apcups'
    // Cron: node='pi', job='backup' fails → 'cron:pi:backup'
    // Unknown: gateway-pi:pihole (status 'unknown', no source) → 'unknown:gateway-pi:pihole'
    expect(incidents.map((i) => i.id)).toEqual([
      'service:vm-101:gitea',
      'ups:apcups',
      'cron:pi:backup',
      'unknown:gateway-pi:pihole',
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

// ----- New Task-1 severity / status / incident logic ------------------------

const HOT_BODY = {
  nodes: {
    'vm-9': {
      display_name: 'VM 9',
      metrics: { cpu: '95.0', memPercent: '50.0', temp: null, diskPercent: '40.0' },
      services: [{ uid: 'vm-9:web', display_name: 'Web', status: 'up' }],
    },
  },
};

describe('SEVERITY / severityRank / maxSeverity', () => {
  it('exposes the numeric rank map', () => {
    expect(SEVERITY).toEqual({ unknown: -1, healthy: 0, caution: 1, critical: 2 });
  });
  it('severityRank returns the numeric rank for a severity string', () => {
    expect(severityRank('unknown')).toBe(-1);
    expect(severityRank('healthy')).toBe(0);
    expect(severityRank('caution')).toBe(1);
    expect(severityRank('critical')).toBe(2);
  });
  it('maxSeverity returns the worst (highest-rank) severity', () => {
    expect(maxSeverity('healthy', 'critical', 'caution')).toBe('critical');
    expect(maxSeverity('unknown', 'healthy')).toBe('healthy');
    expect(maxSeverity('caution', 'caution')).toBe('caution');
    expect(maxSeverity('unknown', 'unknown')).toBe('unknown');
    expect(maxSeverity()).toBe('unknown');
  });
});

describe('statusToSeverity', () => {
  it('up→healthy, down→critical, unknown/presence→unknown', () => {
    expect(statusToSeverity('up')).toBe('healthy');
    expect(statusToSeverity('down')).toBe('critical');
    expect(statusToSeverity('unknown')).toBe('unknown');
    expect(statusToSeverity('up', 'presence')).toBe('unknown');
    expect(statusToSeverity('down', 'presence')).toBe('unknown');
  });
});

describe('statusToShape', () => {
  it('up→disc, down→slash, unknown→ring, presence→ring', () => {
    expect(statusToShape('up')).toBe('disc');
    expect(statusToShape('down')).toBe('slash');
    expect(statusToShape('unknown')).toBe('ring');
    expect(statusToShape('up', 'presence')).toBe('ring');
    expect(statusToShape('down', 'presence')).toBe('ring');
  });
});

describe('formatRuntime', () => {
  it('seconds → Xm (rounded to whole minutes)', () => {
    expect(formatRuntime(480)).toBe('8m');
    expect(formatRuntime(90)).toBe('2m'); // round(1.5) = 2
    expect(formatRuntime(0)).toBe('0m');
    expect(formatRuntime('480')).toBe('8m'); // tolerates numeric strings
  });
  it('null / undefined / NaN → null (charge-only fallback path)', () => {
    expect(formatRuntime(null)).toBeNull();
    expect(formatRuntime(undefined)).toBeNull();
    expect(formatRuntime(NaN)).toBeNull();
    expect(formatRuntime('nope')).toBeNull();
  });
});

describe('nodeSeverity (resource-only)', () => {
  it('cpu at the CPU_HOT boundary (90) → caution', () => {
    expect(nodeSeverity({ metrics: { cpu: '90', memPercent: '10' } })).toBe('caution');
  });
  it('temp at the TEMP_HOT boundary (75) → caution', () => {
    expect(nodeSeverity({ metrics: { cpu: '10', memPercent: '10', temp: '75' } })).toBe('caution');
  });
  it('cool metrics → healthy', () => {
    expect(nodeSeverity({ metrics: { cpu: '10', memPercent: '10', temp: '40' } })).toBe('healthy');
  });
  it('no metrics → unknown', () => {
    expect(nodeSeverity({ metrics: null })).toBe('unknown');
    expect(nodeSeverity({ metrics: {} })).toBe('unknown');
    expect(nodeSeverity({})).toBe('unknown');
  });
  it('a down service does NOT make the node critical (resource-only)', () => {
    const node = { metrics: { cpu: '12', memPercent: '20', temp: '40' }, services: [{ uid: 'x', status: 'down' }] };
    expect(nodeSeverity(node)).toBe('healthy');
  });
  it('CPU_HOT / TEMP_HOT constants are 90 / 75', () => {
    expect(CPU_HOT).toBe(90);
    expect(TEMP_HOT).toBe(75);
  });
});

describe('hasUnknownService', () => {
  it('true for a tracked unknown; false for presence breadcrumbs / up / null', () => {
    const tracked = { nodes: { n: { services: [{ uid: 'a', status: 'unknown' }] } } };
    const presence = { nodes: { n: { services: [{ uid: 'a', status: 'unknown', source: 'presence' }] } } };
    const allUp = { nodes: { n: { services: [{ uid: 'a', status: 'up' }] } } };
    expect(hasUnknownService(tracked)).toBe(true);
    expect(hasUnknownService(presence)).toBe(false);
    expect(hasUnknownService(allUp)).toBe(false);
    expect(hasUnknownService(null)).toBe(false);
  });
});

describe('overallSeverity (strict worst-of)', () => {
  const up = (uid) => ({ uid, status: 'up' });
  const body = (services, metrics = { cpu: '10', memPercent: '10' }) => ({
    nodes: { n: { display_name: 'N', metrics, services } },
  });

  it('any down service → critical', () => {
    expect(overallSeverity({ services: body([{ uid: 'n:a', status: 'down' }]), ups: { status: 1 }, cron: [] })).toBe('critical');
  });
  it('UPS on battery only → caution', () => {
    expect(overallSeverity({ services: body([up('n:a')]), ups: { status: 0 }, cron: [] })).toBe('caution');
  });
  it('cron failure only → caution', () => {
    const cron = [{ node: 'p', jobs: [{ job: 'j', runs: [{ status: 'failure', error: 'x' }] }] }];
    expect(overallSeverity({ services: body([up('n:a')]), ups: { status: 1 }, cron })).toBe('caution');
  });
  it('a hot node only → caution', () => {
    expect(overallSeverity({ services: body([up('n:a')], { cpu: '96', memPercent: '10' }), ups: { status: 1 }, cron: [] })).toBe('caution');
  });
  it('a lone tracked-unknown service → caution', () => {
    expect(overallSeverity({ services: body([{ uid: 'n:a', status: 'unknown' }]), ups: { status: 1 }, cron: [] })).toBe('caution');
  });
  it('all healthy → healthy', () => {
    expect(overallSeverity({ services: body([up('n:a')]), ups: { status: 1 }, cron: [] })).toBe('healthy');
  });
  it('services == null → unknown (cold start, never green)', () => {
    expect(overallSeverity({ services: null, ups: { status: 1 }, cron: [] })).toBe('unknown');
  });
  it('unreachable === true with a stale non-null body → unknown (mid-session outage ≠ green)', () => {
    expect(overallSeverity({ services: body([up('n:a')]), ups: { status: 1 }, cron: [], unreachable: true })).toBe('unknown');
  });
  it('mixed down + battery → critical (worst-of, not averaged)', () => {
    expect(overallSeverity({ services: body([{ uid: 'n:a', status: 'down' }]), ups: { status: 0 }, cron: [] })).toBe('critical');
  });
  it('a presence breadcrumb (unknown) does NOT raise caution', () => {
    expect(overallSeverity({ services: body([{ uid: 'n:a', status: 'unknown', source: 'presence' }]), ups: { status: 1 }, cron: [] })).toBe('healthy');
  });
});

describe('subsystemSeverity (§5 per-cell word/detail table)', () => {
  it('Services cell carries the red (DOWN · up / total) when a service is down', () => {
    const cell = subsystemSeverity('services', { services: SERVICES_BODY, ups: { status: 1 }, cron: [] });
    expect(cell).toMatchObject({ severity: 'critical', word: 'DOWN', detail: '2 / 3' });
  });
  it('Services cell is DEGRADED amber for a lone tracked-unknown (no down)', () => {
    const svcBody = { nodes: { n: { display_name: 'N', metrics: { cpu: '5' }, services: [
      { uid: 'n:a', status: 'up' },
      { uid: 'n:b', status: 'unknown' },
    ] } } };
    const cell = subsystemSeverity('services', { services: svcBody, ups: { status: 1 }, cron: [] });
    expect(cell).toMatchObject({ severity: 'caution', word: 'DEGRADED', detail: '1 unknown' });
  });
  it('Services cell is OK green (total / total) when all up', () => {
    const svcBody = { nodes: { n: { display_name: 'N', metrics: { cpu: '5' }, services: [
      { uid: 'n:a', status: 'up' }, { uid: 'n:b', status: 'up' },
    ] } } };
    const cell = subsystemSeverity('services', { services: svcBody, ups: { status: 1 }, cron: [] });
    expect(cell).toMatchObject({ severity: 'healthy', word: 'OK', detail: '2 / 2' });
  });

  it('Nodes cell stays OK/green for a down-service node with healthy resources (never red)', () => {
    const cell = subsystemSeverity('nodes', { services: SERVICES_BODY, ups: { status: 1 }, cron: [] });
    expect(cell).toMatchObject({ severity: 'healthy', word: 'OK', detail: '2 online' });
  });
  it('Nodes cell is DEGRADED amber when a node is resource-hot (1 hot · 95%)', () => {
    const cell = subsystemSeverity('nodes', { services: HOT_BODY, ups: { status: 1 }, cron: [] });
    expect(cell).toMatchObject({ severity: 'caution', word: 'DEGRADED', detail: '1 hot · 95%' });
  });

  it('UPS cell: ON BATTERY (charge · runtime) / charge-only / MAINS / NO SIGNAL', () => {
    const batt = subsystemSeverity('ups', { services: SERVICES_BODY, ups: { status: 0, charge: 47, runtime: 480 }, cron: [] });
    expect(batt).toMatchObject({ severity: 'caution', word: 'ON BATTERY', detail: '47% · 8m' });
    const battNoRt = subsystemSeverity('ups', { services: SERVICES_BODY, ups: { status: 0, charge: 47 }, cron: [] });
    expect(battNoRt.detail).toBe('47%');
    const mains = subsystemSeverity('ups', { services: SERVICES_BODY, ups: { status: 1, charge: 100 }, cron: [] });
    expect(mains).toMatchObject({ severity: 'healthy', word: 'MAINS', detail: '100%' });
    const missing = subsystemSeverity('ups', { services: SERVICES_BODY, ups: null, cron: [] });
    expect(missing).toMatchObject({ severity: 'unknown', word: 'NO SIGNAL', detail: '—' });
  });

  it('Cron cell: FAILED amber (N job) vs OK green (0 fail)', () => {
    const failCron = [{ node: 'pi', jobs: [{ job: 'b', runs: [{ status: 'failure', error: 'boom' }] }] }];
    const failed = subsystemSeverity('cron', { services: SERVICES_BODY, ups: { status: 1 }, cron: failCron });
    expect(failed).toMatchObject({ severity: 'caution', word: 'FAILED', detail: '1 job' });
    const ok = subsystemSeverity('cron', { services: SERVICES_BODY, ups: { status: 1 }, cron: [] });
    expect(ok).toMatchObject({ severity: 'healthy', word: 'OK', detail: '0 fail' });
  });

  it('every cell is NO SIGNAL steel when unreachable (never green)', () => {
    for (const key of ['services', 'nodes', 'ups', 'cron']) {
      const cell = subsystemSeverity(key, { services: SERVICES_BODY, ups: { status: 1 }, cron: [], unreachable: true });
      expect(cell).toMatchObject({ severity: 'unknown', word: 'NO SIGNAL', detail: '—' });
    }
  });

  it('Nodes / UPS / Cron never emit a critical (red) severity, even amid a down service', () => {
    const failCron = [{ node: 'pi', jobs: [{ job: 'b', runs: [{ status: 'failure', error: 'x' }] }] }];
    for (const key of ['nodes', 'ups', 'cron']) {
      const cell = subsystemSeverity(key, { services: SERVICES_BODY, ups: { status: 0 }, cron: failCron });
      expect(cell.severity).not.toBe('critical');
    }
  });
});

describe('deriveIncidents — per-incident severity/word/shape/readout (honest numbers)', () => {
  it('service-down → slash / critical / DOWN, readout = node only (no invented age)', () => {
    const inc = deriveIncidents({ services: SERVICES_BODY, ups: { status: 1 }, cron: [] })
      .find((i) => i.kind === 'service');
    expect(inc).toMatchObject({ severity: 'critical', word: 'DOWN', shape: 'slash', readout: 'VM 101' });
    // honest numbers: NO synthesized timestamp / age fields
    expect(inc._at).toBeUndefined();
    expect(inc.age).toBeUndefined();
    expect(inc.detectedAt).toBeUndefined();
    expect(inc.since).toBeUndefined();
  });
  it('ups → bolt / caution / ON BATTERY, readout = {charge}% · {runtime}', () => {
    const inc = deriveIncidents({ services: null, ups: { status: 0, charge: 47, runtime: 480 }, cron: [] })
      .find((i) => i.kind === 'ups');
    expect(inc).toMatchObject({ severity: 'caution', word: 'ON BATTERY', shape: 'bolt', readout: '47% · 8m' });
  });
  it('ups readout is charge-only when runtime is absent', () => {
    const inc = deriveIncidents({ services: null, ups: { status: 0, charge: 47 }, cron: [] })
      .find((i) => i.kind === 'ups');
    expect(inc.readout).toBe('47%');
  });
  it('cron failure → slash / caution / FAILED, readout = node', () => {
    const cron = [{ node: 'pi-1', jobs: [{ job: 'backup', runs: [{ status: 'failure', error: 'disk full' }] }] }];
    const inc = deriveIncidents({ services: null, ups: { status: 1 }, cron })
      .find((i) => i.kind === 'cron');
    expect(inc).toMatchObject({ severity: 'caution', word: 'FAILED', shape: 'slash', readout: 'pi-1' });
  });
  it('tracked-unknown service → ring / unknown / UNKN, readout = {node} · no signal; presence excluded', () => {
    const svcBody = { nodes: { n: { display_name: 'Node A', services: [
      { uid: 'n:tracked', display_name: 'Tracked', status: 'unknown' },
      { uid: 'n:crumb', display_name: 'Crumb', status: 'unknown', source: 'presence' },
    ] } } };
    const unknowns = deriveIncidents({ services: svcBody, ups: { status: 1 }, cron: [] })
      .filter((i) => i.kind === 'unknown');
    expect(unknowns).toHaveLength(1); // presence breadcrumb excluded
    expect(unknowns[0]).toMatchObject({
      id: 'unknown:n:tracked', severity: 'unknown', word: 'UNKN', shape: 'ring',
      readout: 'Node A · no signal',
    });
  });
  it('sort order is down → ups → cron → unknown', () => {
    const cron = [{ node: 'pi', jobs: [{ job: 'j', runs: [{ status: 'failure', error: 'x' }] }] }];
    const kinds = deriveIncidents({ services: SERVICES_BODY, ups: { status: 0, charge: 50 }, cron }).map((i) => i.kind);
    expect(kinds).toEqual(['service', 'ups', 'cron', 'unknown']);
  });
});

describe('activeIncidentIds', () => {
  it('returns the Set of incident ids', () => {
    const incidents = deriveIncidents({ services: SERVICES_BODY, ups: { status: 0, charge: 50 }, cron: [] });
    const ids = activeIncidentIds(incidents);
    expect(ids).toBeInstanceOf(Set);
    expect(ids.has('service:vm-101:gitea')).toBe(true);
    expect(ids.has('ups:apcups')).toBe(true);
    expect(ids.has('unknown:gateway-pi:pihole')).toBe(true);
  });
  it('all-active → history (ids not in the set) is empty', () => {
    const incidents = deriveIncidents({ services: SERVICES_BODY, ups: { status: 0, charge: 50 }, cron: [] });
    const ids = activeIncidentIds(incidents);
    const history = incidents.filter((i) => !ids.has(i.id));
    expect(history).toEqual([]);
  });
  it('empty incidents → empty set', () => {
    expect(activeIncidentIds([]).size).toBe(0);
  });
});
