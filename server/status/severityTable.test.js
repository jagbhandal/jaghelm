/**
 * One test per row of the severity table in spec §6.1, named after the row,
 * then one per rule under it. Each runs the whole model (buildStatus) on the
 * payloads the refreshes cache, cycle after cycle where the row needs memory.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NOW,
  card,
  cronNode,
  cronRun,
  cycles,
  entityOf,
  inputs,
  missing,
  monitored,
  node,
  once,
} from '../testing/statusFixtures.js';
import { DEFAULT_THRESHOLDS } from './thresholds.js';

const nodeState = (status, key = 'n1') => entityOf(status, `nodes/${key}`).state;
const states = (list, id) => list.map((s) => entityOf(s, id)?.state);

test('§6.1 row "Node CPU": warn at ≥ 90 % for 2 consecutive cycles, never crit', () => {
  const run = cycles([
    inputs({ nodes: { n1: node({ cpu: '95.0' }) } }),
    inputs({ nodes: { n1: node({ cpu: '99.0' }) } }),
    inputs({ nodes: { n1: node({ cpu: '100.0' }) } }),
  ]);
  assert.deepEqual(
    run.map((s) => nodeState(s)),
    ['ok', 'warn', 'warn']
  );
  const n = entityOf(run[1], 'nodes/n1');
  assert.equal(n.reason, 'CPU 99 % (warning above 90 % for 2 cycles)');
  assert.deepEqual(n.metric, { name: 'cpu', value: 99, unit: '%' });
  assert.equal(n.conditions.cpu, 'warn');

  // One cycle over the line, then under it, then over: the run starts again.
  const blip = cycles([
    inputs({ nodes: { n1: node({ cpu: '95.0' }) } }),
    inputs({ nodes: { n1: node({ cpu: '50.0' }) } }),
    inputs({ nodes: { n1: node({ cpu: '95.0' }) } }),
  ]);
  assert.deepEqual(
    blip.map((s) => nodeState(s)),
    ['ok', 'ok', 'ok']
  );
});

test('§6.1 row "Node memory": warn at ≥ 90 %, never crit', () => {
  assert.equal(nodeState(once(inputs({ nodes: { n1: node({ memPercent: '89.9' }) } }))), 'ok');
  const s = once(inputs({ nodes: { n1: node({ memPercent: '90.0' }) } }));
  assert.equal(nodeState(s), 'warn');
  assert.equal(entityOf(s, 'nodes/n1').reason, 'Memory 90 % (warning above 90 %)');
  assert.equal(nodeState(once(inputs({ nodes: { n1: node({ memPercent: '100.0' }) } }))), 'warn');
});

test('§6.1 row "Node disk, storage pool": warn at ≥ 90 %, crit at ≥ 95 %', () => {
  assert.equal(nodeState(once(inputs({ nodes: { n1: node({ diskPercent: '89.9' }) } }))), 'ok');
  const warn = once(inputs({ nodes: { n1: node({ diskPercent: '94.0' }) } }));
  assert.equal(nodeState(warn), 'warn');
  assert.equal(entityOf(warn, 'nodes/n1').reason, 'Disk 94 % (warning above 90 %)');
  const crit = once(inputs({ nodes: { n1: node({ diskPercent: '95.0' }) } }));
  assert.equal(nodeState(crit), 'crit');
  assert.equal(entityOf(crit, 'nodes/n1').reason, 'Disk 95 % (critical above 95 %)');

  // A Proxmox storage pool on the node follows the same lines.
  const pool = (percent) =>
    inputs({
      nodes: { pve: node() },
      integrations: {
        proxmox: {
          _preset: 'proxmox',
          _storagePools: [{ name: 'local-lvm', percent }],
          _status: { state: 'ok' },
        },
      },
    });
  assert.equal(nodeState(once(pool(80)), 'pve'), 'ok');
  assert.equal(nodeState(once(pool(91)), 'pve'), 'warn');
  const full = once(pool(97.4));
  assert.equal(nodeState(full, 'pve'), 'crit');
  assert.equal(
    entityOf(full, 'nodes/pve').reason,
    'Storage pool local-lvm 97 % (critical above 95 %)'
  );
  assert.equal(entityOf(full, 'nodes/pve').conditions['pool:local-lvm'], 'crit');
});

test('§6.1 row "Node temperature (hottest sensor)": warn at ≥ 75 °C, crit at ≥ 85 °C', () => {
  assert.equal(nodeState(once(inputs({ nodes: { n1: node({ temp: '74.9' }) } }))), 'ok');
  const warn = once(inputs({ nodes: { n1: node({ temp: '75.0' }) } }));
  assert.equal(nodeState(warn), 'warn');
  assert.equal(entityOf(warn, 'nodes/n1').reason, 'Temperature 75 °C (warning above 75 °C)');
  assert.equal(nodeState(once(inputs({ nodes: { n1: node({ temp: '85.0' }) } }))), 'crit');
  // A node with no sensor (a VM) is judged on the rest.
  assert.equal(nodeState(once(inputs({ nodes: { n1: node({ temp: null }) } }))), 'ok');
});

test('§6.1 row "Node: no metrics while Prometheus is healthy": crit, unreachable', () => {
  const down = once(inputs({ nodes: { n1: node({}, { reachable: false }) } }));
  assert.equal(nodeState(down), 'crit');
  assert.equal(entityOf(down, 'nodes/n1').word, 'Unreachable');
  // No `up` series and no metric: judged by metric presence, as push does.
  const silent = once(
    inputs({
      nodes: {
        n1: node(
          { cpu: null, memPercent: null, diskPercent: null, temp: null },
          { reachable: null }
        ),
      },
    })
  );
  assert.equal(nodeState(silent), 'crit');
  assert.equal(entityOf(silent, 'nodes/n1').reason, 'Unreachable: no metrics from Prometheus');
});

test('§6.1 row "Service (Kuma)": warn when pending for more than one cycle, crit when down', () => {
  const id = 'services/n1:app';
  const pending = cycles(
    [1, 2, 3].map(() =>
      inputs({
        nodes: { n1: node({}, { services: [monitored('n1:app', 'unknown')] }) },
        internal: { kumaStatusOf: { 'n1:app': 'pending' } },
      })
    )
  );
  assert.deepEqual(states(pending, id), ['ok', 'warn', 'warn']);
  assert.equal(entityOf(pending[1], id).word, 'Pending');
  const down = once(
    inputs({ nodes: { n1: node({}, { services: [monitored('n1:app', 'down')] }) } })
  );
  assert.equal(entityOf(down, id).state, 'crit');
  assert.equal(entityOf(down, id).reason, 'Kuma: down');
});

test('§6.1 row "Container that backs a monitored service, missing": warn, following its monitor; never crit (#438)', () => {
  const backing = (status) =>
    once(
      inputs({
        nodes: { n1: node({}, { services: [missing('n1:immich-server', NOW - 120_000)] }) },
        internal: { backedBy: { 'n1:immich-server': { monitor: 'Immich', status } } },
      })
    );
  const e = (status) => entityOf(backing(status), 'services/n1:immich-server');
  assert.equal(e('up').kind, 'container');
  assert.deepEqual(
    [e('up').state, e('up').word, e('up').reason],
    ['warn', 'Missing', 'Missing: the container is gone; Kuma monitor Immich is up']
  );
  assert.equal(e('up').since, NOW - 120_000, 'since is when it was last seen');
  // Down, the monitor's own card is the crit: the container is a warning.
  assert.deepEqual(
    [e('down').state, e('down').reason],
    ['warn', 'Missing: the container is gone; Kuma monitor Immich is down']
  );
  assert.deepEqual(
    [e('pending').state, e('pending').word, e('pending').reason],
    ['unknown', 'No signal', 'Kuma: Immich pending']
  );
  assert.deepEqual(
    [e('maintenance').state, e('maintenance').word, e('maintenance').reason],
    ['maintenance', 'Maintenance', 'Kuma: Immich in maintenance']
  );
  for (const status of ['up', 'down', 'pending', 'maintenance', 'unknown']) {
    assert.notEqual(backing(status).overall.state, 'crit', status);
  }
});

test('§6.1 row "Other container, missing": warn', () => {
  const s = once(
    inputs({ nodes: { n1: node({}, { services: [missing('n1:redis'), card('n1:alloy')] }) } })
  );
  assert.equal(entityOf(s, 'services/n1:redis').state, 'warn');
  assert.equal(entityOf(s, 'services/n1:redis').word, 'Missing');
  assert.equal(entityOf(s, 'services/n1:alloy').state, 'ok');
});

test('§6.1 row "UPS": crit on battery, or low battery', () => {
  const ups = (status) =>
    entityOf(
      once(
        inputs({
          ups: {
            status,
            charge: 80,
            runtime: 1500,
            load: 20,
            ok: true,
            configured: true,
            model: null,
          },
        })
      ),
      'power/ups'
    );
  assert.equal(ups(1).state, 'ok');
  assert.equal(ups(2).state, 'crit');
  assert.equal(ups(2).reason, 'On battery (80 % charge)');
  assert.equal(ups(3).state, 'crit');
  assert.equal(ups(3).word, 'Low battery');
});

test('§6.1 row "Job (cron)": warn when its last run failed, or when overdue', () => {
  const s = once(
    inputs({
      cron: [
        cronNode('vm103', {
          ok: cronRun('success'),
          broken: cronRun('failure', 60_000, { error: 'exit 1' }),
          late: cronRun('success', 3 * 3_600_000, { expected_every_seconds: 3600 }),
        }),
      ],
    })
  );
  assert.equal(entityOf(s, 'jobs/vm103:ok').state, 'ok');
  assert.equal(entityOf(s, 'jobs/vm103:broken').state, 'warn');
  assert.equal(entityOf(s, 'jobs/vm103:broken').reason, 'Last run failed: exit 1');
  assert.equal(entityOf(s, 'jobs/vm103:late').state, 'warn');
  assert.equal(
    entityOf(s, 'jobs/vm103:late').reason,
    'Overdue: no report on schedule (expected every 60 min)'
  );
});

test('§6.1 row "Backup": warn when overdue, crit when its last run failed', () => {
  const s = once(
    inputs({
      cron: [
        cronNode('pve', {
          'vzdump-ok': cronRun('success', 60_000, { expected_every_seconds: 86_400 }),
          'vzdump-failed': cronRun('failure', 60_000, { error: 'storage full' }),
          'vzdump-late': cronRun('success', 3 * 86_400_000, { expected_every_seconds: 86_400 }),
        }),
      ],
      backupJobs: ['pve:vzdump-ok', 'pve:vzdump-failed', 'pve:vzdump-late'],
    })
  );
  assert.equal(entityOf(s, 'backups/pve:vzdump-ok').state, 'ok');
  assert.equal(entityOf(s, 'backups/pve:vzdump-failed').state, 'crit');
  assert.equal(entityOf(s, 'backups/pve:vzdump-failed').reason, 'Last backup failed: storage full');
  assert.equal(entityOf(s, 'backups/pve:vzdump-late').state, 'warn');
  assert.equal(entityOf(s, 'jobs/pve:vzdump-failed'), undefined, 'a backup is not also a job');
});

test('§6.1 row "Integration": warn when unreachable or its login was refused', () => {
  const s = once(
    inputs({
      integrations: {
        sonarr: {
          Queue: '3',
          _status: { state: 'ok', since: NOW - 1000, failures: 0, nextAttemptAt: null },
        },
        radarr: {
          _error: 'HTTP 502',
          _status: {
            state: 'backing_off',
            since: NOW - 5000,
            failures: 2,
            nextAttemptAt: NOW + 60_000,
          },
        },
        qbit: {
          _error: 'HTTP 401 (login refused twice; not retried until it is saved in Settings)',
          _status: { state: 'auth_failed', since: NOW - 9000, failures: 2, nextAttemptAt: null },
        },
      },
    })
  );
  assert.equal(entityOf(s, 'integrations/sonarr').state, 'ok');
  assert.equal(entityOf(s, 'integrations/radarr').state, 'warn');
  assert.equal(entityOf(s, 'integrations/radarr').reason, 'Fetch failed: HTTP 502');
  assert.equal(entityOf(s, 'integrations/radarr').since, NOW - 5000);
  assert.equal(entityOf(s, 'integrations/qbit').state, 'warn');
  assert.equal(
    entityOf(s, 'integrations/qbit').reason,
    'Login refused: save it in Settings to retry'
  );
});

test('§6.1 row "Arcane agent": warn when offline', () => {
  const s = once(
    inputs({
      arcaneAgents: [
        { env: 'pi1', state: 'up' },
        { env: 'pi2', state: 'down' },
      ],
    })
  );
  assert.equal(entityOf(s, 'integrations/arcane:pi1').state, 'ok');
  const off = entityOf(s, 'integrations/arcane:pi2');
  assert.equal(off.state, 'warn');
  assert.equal(off.subsystem, 'integrations');
  assert.equal(off.word, 'Offline');
});

test('§6.1 row "Monitoring source (Prometheus, Kuma, NUT) failed": the source warns, its entities are unknown', () => {
  const healthy = inputs({
    nodes: { n1: node({}, { services: [card('n1:alloy'), monitored('n1:app', 'up')] }) },
  });
  const [, prom] = cycles([
    healthy,
    inputs({
      nodes: {},
      prometheusOk: false,
      ups: { ...healthy.ups, ok: false, configured: null },
    }),
  ]);
  assert.equal(entityOf(prom, 'nodes/n1').state, 'unknown');
  assert.equal(entityOf(prom, 'nodes/n1').reason, 'No data: Prometheus unreachable');
  assert.equal(entityOf(prom, 'power/ups').state, 'unknown');
  assert.equal(prom.issues.filter((i) => i.kind === 'source').length, 1);
  assert.equal(prom.issues[0].id, 'sources/prometheus');
  assert.equal(prom.issues[0].state, 'warn');

  const kuma = once(
    inputs({ nodes: { n1: node({}, { services: [monitored('n1:app', 'down')] }) }, kumaOk: false })
  );
  assert.equal(entityOf(kuma, 'services/n1:app').state, 'unknown', 'a stale down is not crit');
  assert.equal(entityOf(kuma, 'services/n1:app').reason, 'No data: Kuma unreachable');
  assert.deepEqual(
    kuma.issues.filter((i) => i.kind === 'source').map((i) => i.id),
    ['sources/kuma']
  );

  const nut = once(
    inputs({
      ups: {
        status: null,
        charge: null,
        runtime: null,
        load: null,
        ok: true,
        configured: true,
        model: null,
      },
    })
  );
  assert.equal(entityOf(nut, 'power/ups').state, 'unknown');
  assert.equal(entityOf(nut, 'power/ups').reason, 'No data: NUT exporter not reporting');
  assert.deepEqual(
    nut.issues.map((i) => i.id),
    ['sources/nut', 'power/ups']
  );
});

// ── The rules under the table ──

test('§6.1 rule "Recovery uses hysteresis": 5 points for percentages, 5 °C for temperature', () => {
  const disk = (pcts) =>
    cycles(pcts.map((d) => inputs({ nodes: { n1: node({ diskPercent: String(d) }) } }))).map((s) =>
      nodeState(s)
    );
  // crit holds down to 90, then warn holds down to 85.
  assert.deepEqual(disk([96, 92, 90, 89, 85, 84.9]), [
    'crit',
    'crit',
    'crit',
    'warn',
    'warn',
    'ok',
  ]);
  assert.deepEqual(disk([88, 91, 86, 84]), ['ok', 'warn', 'warn', 'ok']);
  const held = cycles(
    [91, 87].map((d) => inputs({ nodes: { n1: node({ diskPercent: String(d) }) } }))
  )[1];
  assert.equal(entityOf(held, 'nodes/n1').reason, 'Disk 87 % (warning until below 85 %)');

  const temp = (cs) =>
    cycles(cs.map((t) => inputs({ nodes: { n1: node({ temp: String(t) }) } }))).map((s) =>
      nodeState(s)
    );
  assert.deepEqual(temp([86, 81, 79, 71, 69]), ['crit', 'crit', 'warn', 'warn', 'ok']);

  const cpu = (ps) =>
    cycles(ps.map((c) => inputs({ nodes: { n1: node({ cpu: String(c) }) } }))).map((s) =>
      nodeState(s)
    );
  assert.deepEqual(cpu([95, 95, 86, 85, 84.9]), ['ok', 'warn', 'warn', 'warn', 'ok']);
});

test('§6.1 rule "Worst-of order": crit > warn > unknown > maintenance > ok', () => {
  const board = (cards, extra = {}) =>
    once(inputs({ nodes: { n1: node({}, { services: cards }) }, ...extra }));
  const maint = { kumaStatusOf: { 'n1:m': 'maintenance' } };
  const overall = (s) => s.overall.state;
  assert.equal(overall(board([card('n1:a')])), 'ok');
  assert.equal(
    overall(board([card('n1:a'), monitored('n1:m', 'unknown')], { internal: maint })),
    'maintenance'
  );
  assert.equal(
    overall(
      board([monitored('n1:m', 'unknown'), monitored('n1:u', 'unknown')], { internal: maint })
    ),
    'unknown'
  );
  assert.equal(overall(board([monitored('n1:u', 'unknown'), missing('n1:w')])), 'warn');
  assert.equal(overall(board([missing('n1:w'), monitored('n1:d', 'down')])), 'crit');
  const services = board([missing('n1:w'), monitored('n1:d', 'down'), monitored('n1:u', 'unknown')])
    .subsystems[0];
  assert.equal(services.state, 'crit');
  assert.deepEqual(services.counts, {
    total: 3,
    ok: 0,
    warn: 1,
    crit: 1,
    unknown: 1,
    maintenance: 0,
  });
});

test('§6.1 rule "unknown breaks the quiet line, maintenance does not"', () => {
  const quiet = once(
    inputs({ nodes: { n1: node({}, { services: [card('n1:a'), card('n1:b')] }) } })
  );
  assert.equal(quiet.overall.sentence, 'All 2 services up · 1 node healthy');
  assert.deepEqual(quiet.issues, []);

  const maint = once(
    inputs({
      nodes: { n1: node({}, { services: [card('n1:a'), monitored('n1:m', 'unknown')] }) },
      internal: { kumaStatusOf: { 'n1:m': 'maintenance' } },
    })
  );
  assert.equal(maint.overall.sentence, '1 service up · 1 node healthy');
  assert.deepEqual(maint.issues, [], 'maintenance is not an issue');
  assert.equal(maint.subsystems[0].detail, '1 / 2 up · 1 in maintenance');

  const unknown = once(
    inputs({ nodes: { n1: node({}, { services: [card('n1:a'), monitored('n1:u', 'unknown')] }) } })
  );
  assert.equal(unknown.overall.sentence, '1 up · 1 no signal');
  assert.deepEqual(
    unknown.issues.map((i) => i.id),
    ['services/n1:u']
  );
});

test('§6.1 rule "All numbers are defaults in the server threshold config"', () => {
  const lowered = {
    ...DEFAULT_THRESHOLDS,
    disk: { warn: 0.5, crit: 0.6 },
    temp: { warn: 40, crit: 44 },
    cpu: { warn: 0.5, cycles: 1 },
    pending: { cycles: 1 },
  };
  const s = once(
    inputs({
      nodes: {
        n1: node(
          { diskPercent: '55.0', temp: '45.0', cpu: '60.0' },
          { services: [monitored('n1:p', 'unknown')] }
        ),
      },
      internal: { kumaStatusOf: { 'n1:p': 'pending' } },
    }),
    { thresholds: lowered }
  );
  const n = entityOf(s, 'nodes/n1');
  assert.deepEqual(n.conditions, { disk: 'warn', temp: 'crit', mem: 'ok', cpu: 'warn' });
  assert.equal(
    entityOf(s, 'services/n1:p').state,
    'warn',
    'one pending cycle is enough at pending.cycles = 1'
  );
});
