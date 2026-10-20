/**
 * Table-driven tests of the status model's rules (#290): every entity kind in
 * every state it can take, through the rule functions and through the whole
 * model, plus the five state names against the UI's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STATES as UI_STATES } from '../../src/ui/lib/status.js';
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
import {
  STATES,
  errorText,
  judgeAgent,
  judgeContainer,
  judgeIntegration,
  judgeJob,
  judgeNode,
  judgeService,
  judgeUps,
  levelOf,
  spanText,
  worstOf,
} from './rules.js';
import { DEFAULT_THRESHOLDS as T } from './thresholds.js';

test('the model names the five states exactly as src/ui/lib/status.js does', () => {
  assert.deepEqual([...STATES], [...UI_STATES]);
});

test('worstOf: crit > warn > unknown > maintenance > ok, ok for none', () => {
  const rows = [
    [[], 'ok'],
    [['ok', 'maintenance'], 'maintenance'],
    [['maintenance', 'unknown', 'ok'], 'unknown'],
    [['unknown', 'warn'], 'warn'],
    [['warn', 'crit', 'unknown'], 'crit'],
  ];
  for (const [states, want] of rows) assert.equal(worstOf(states), want, states.join(','));
});

test('levelOf: lines and hysteresis, table', () => {
  const lines = { warn: 0.9, crit: 0.95 };
  const rows = [
    // value, previous level, level
    [0.5, undefined, 'ok'],
    [0.9, undefined, 'warn'],
    [0.95, undefined, 'crit'],
    [0.93, 'crit', 'crit'],
    [0.89, 'crit', 'warn'],
    [0.86, 'warn', 'warn'],
    [0.84, 'warn', 'ok'],
    [0.89, 'ok', 'ok'],
  ];
  for (const [v, prev, want] of rows)
    assert.equal(levelOf(v, prev, lines, 0.05), want, `${v} after ${prev}`);
  assert.equal(levelOf(0.99, 'ok', { warn: 0.9 }, 0.05), 'warn', 'no crit line: never crit');
});

const nodeRows = [
  // name, node, ctx, state, word, reason
  ['healthy', node(), {}, 'ok', 'Healthy', 'Healthy'],
  [
    'unreachable (up = 0)',
    node({}, { reachable: false }),
    {},
    'crit',
    'Unreachable',
    "Unreachable: Prometheus can't scrape it",
  ],
  [
    'missing from a failed cycle',
    null,
    { prometheusOk: false },
    'unknown',
    'No signal',
    'No data: Prometheus unreachable',
  ],
  [
    'the up query failed',
    node({}, { failedReads: ['reachable'] }),
    { prometheusOk: false },
    'unknown',
    'No signal',
    'No data: Prometheus unreachable',
  ],
  [
    'no up series and a metric read failed',
    node({ cpu: null }, { reachable: null, failedReads: ['cpu'] }),
    { prometheusOk: false },
    'unknown',
    'No signal',
    'No data: Prometheus unreachable',
  ],
  [
    'one reading failed',
    node({ temp: null }, { failedReads: ['temp'] }),
    { prometheusOk: false },
    'unknown',
    'No signal',
    'No temperature reading: the Prometheus query failed',
  ],
  [
    'a failed reading under a crit one',
    node({ diskPercent: '97.0' }, { failedReads: ['temp'] }),
    { prometheusOk: false },
    'crit',
    'Critical',
    'Disk 97 % (critical above 95 %) · No temperature reading: the Prometheus query failed',
  ],
  [
    'disk warn',
    node({ diskPercent: '91.2' }),
    {},
    'warn',
    'Warning',
    'Disk 91 % (warning above 90 %)',
  ],
  [
    'a reading shown rounded down, never over a line it is under',
    node({ diskPercent: '94.99' }),
    {},
    'warn',
    'Warning',
    'Disk 94 % (warning above 90 %)',
  ],
  [
    'two readings, worst first',
    node({ memPercent: '92.0', temp: '88.0' }),
    {},
    'crit',
    'Critical',
    'Temperature 88 °C (critical above 85 °C) · Memory 92 % (warning above 90 %)',
  ],
  [
    'a pool on the node',
    node(),
    { pools: [{ name: 'tank', percent: 93 }] },
    'warn',
    'Warning',
    'Storage pool tank 93 % (warning above 90 %)',
  ],
  [
    'a pool with no reading',
    node(),
    { pools: [{ name: 'tank', percent: null }] },
    'ok',
    'Healthy',
    'Healthy',
  ],
];

for (const [name, n, ctx, state, word, reason] of nodeRows) {
  test(`judgeNode: ${name} → ${state}`, () => {
    const v = judgeNode(n, { prometheusOk: true, thresholds: T, ...ctx });
    assert.deepEqual([v.state, v.word, v.reason], [state, word, reason]);
  });
}

test('judgeNode: conditions give each reading its state; metric is the worst reading', () => {
  const v = judgeNode(node({ diskPercent: '96.0', memPercent: '91.0', temp: null }), {
    prometheusOk: true,
    thresholds: T,
  });
  assert.deepEqual(v.conditions, { disk: 'crit', mem: 'warn', cpu: 'ok' });
  assert.deepEqual(v.metric, { name: 'disk', value: 96, unit: '%' });
  assert.equal(
    judgeNode(node({}, { reachable: false }), { prometheusOk: true, thresholds: T }).metric,
    undefined
  );
});

// #462: a reading with no value this cycle (a sensor that didn't answer), the
// level the model held for it last cycle, and what the node says.
const heldRows = [
  // name, the node's readings, held levels, state, reason
  [
    'temperature held at warn',
    { temp: null },
    { temp: 'warn' },
    'warn',
    'Temperature: no reading (warning held until below 70 °C)',
  ],
  [
    'temperature held at crit',
    { temp: null },
    { temp: 'crit' },
    'crit',
    'Temperature: no reading (critical held until below 80 °C)',
  ],
  [
    'disk held at crit',
    { diskPercent: null },
    { disk: 'crit' },
    'crit',
    'Disk: no reading (critical held until below 90 %)',
  ],
  [
    'memory held at warn',
    { memPercent: null },
    { mem: 'warn' },
    'warn',
    'Memory: no reading (warning held until below 85 %)',
  ],
  [
    'CPU held at warn',
    { cpu: null },
    { cpu: 'warn' },
    'warn',
    'CPU: no reading (warning held until below 85 %)',
  ],
  [
    'memory held at crit, which it has no line for (a damaged snapshot): at warn',
    { memPercent: null },
    { mem: 'crit' },
    'warn',
    'Memory: no reading (warning held until below 85 %)',
  ],
  [
    'a held one beside a reading that was read, worst first',
    { diskPercent: '97.0', temp: null },
    { temp: 'warn' },
    'crit',
    'Disk 97 % (critical above 95 %) · Temperature: no reading (warning held until below 70 °C)',
  ],
];

for (const [name, metrics, levels, state, reason] of heldRows) {
  test(`judgeNode: no value this cycle, ${name} (#462)`, () => {
    const v = judgeNode(node(metrics), {
      prometheusOk: true,
      memo: { levels, streak: {} },
      thresholds: T,
    });
    assert.deepEqual([v.state, v.reason], [state, reason]);
    for (const [key, level] of Object.entries(levels)) {
      assert.equal(v.memo.levels[key], level, `${key}: the level is kept for next cycle`);
      assert.equal(v.conditions[key], 'unknown', `${key}: no value, so no meter colour`);
    }
  });
}

test('judgeNode: a held reading claims no value it does not have: no number, no metric (#462)', () => {
  const held = judgeNode(node({ temp: null }), {
    prometheusOk: true,
    memo: { levels: { temp: 'warn', cpu: 'ok', mem: 'ok', disk: 'ok' }, streak: {} },
    thresholds: T,
  });
  assert.equal(held.word, 'Warning');
  assert.equal(held.metric, undefined, 'the metric is the reading behind the state: there is none');
  assert.doesNotMatch(held.reason, /^Temperature \d/, 'no reading is printed');
  // Beside a read reading at the same level, that one is the metric.
  const both = judgeNode(node({ temp: null, memPercent: '92.0' }), {
    prometheusOk: true,
    memo: { levels: { temp: 'warn' }, streak: {} },
    thresholds: T,
  });
  assert.deepEqual(both.metric, { name: 'mem', value: 92, unit: '%' });
});

test('judgeNode: a storage pool with no value keeps the level it held (#462)', () => {
  const v = judgeNode(node(), {
    prometheusOk: true,
    pools: [{ name: 'tank', percent: null }],
    memo: { levels: { 'pool:tank': 'warn' }, streak: {} },
    thresholds: T,
  });
  assert.deepEqual(
    [v.state, v.reason, v.conditions['pool:tank'], v.memo.levels['pool:tank']],
    ['warn', 'Storage pool tank: no reading (warning held until below 85 %)', 'unknown', 'warn']
  );
});

test('judgeNode: a reading held at ok with no value is left out, its level and CPU run kept (#462)', () => {
  const v = judgeNode(node({ temp: null, cpu: null }), {
    prometheusOk: true,
    memo: { levels: { temp: 'ok', cpu: 'ok' }, streak: { cpu: { n: 1 } } },
    thresholds: T,
  });
  assert.deepEqual([v.state, v.reason], ['ok', 'Healthy']);
  assert.deepEqual(v.conditions, { disk: 'ok', mem: 'ok' }, 'nothing open: no meter for them');
  assert.deepEqual(v.memo.levels, { disk: 'ok', mem: 'ok', temp: 'ok', cpu: 'ok' });
  assert.deepEqual(v.memo.streak, { cpu: { n: 1 } }, "CPU's run of cycles over its line is kept");
  // With nothing held (a VM has no temperature sensor), there is nothing to keep.
  const vm = judgeNode(node({ temp: null }), { prometheusOk: true, thresholds: T });
  assert.equal(Object.hasOwn(vm.memo.levels, 'temp'), false);
});

const serviceRows = [
  // name, input, state, word, reason
  ['up', { status: 'up' }, 'ok', 'Up', 'Kuma: up'],
  ['down', { status: 'down' }, 'crit', 'Down', 'Kuma: down'],
  [
    'no status',
    { status: 'unknown', kumaStatus: 'unknown' },
    'unknown',
    'No signal',
    'Kuma: no status',
  ],
  [
    'in maintenance',
    { status: 'unknown', kumaStatus: 'maintenance' },
    'maintenance',
    'Maintenance',
    'Kuma: in maintenance',
  ],
  [
    'pending, first cycle, nothing before',
    { status: 'unknown', kumaStatus: 'pending' },
    'ok',
    'Pending',
    'Kuma: pending',
  ],
  [
    'pending, second cycle',
    {
      status: 'unknown',
      kumaStatus: 'pending',
      prev: { kind: 'service', state: 'ok', memo: { pending: { n: 1, since: NOW - 30_000 } } },
    },
    'warn',
    'Pending',
    'Kuma: pending (retrying its check)',
  ],
  [
    'Kuma failed',
    { status: 'down', kumaOk: false },
    'unknown',
    'No signal',
    'No data: Kuma unreachable',
  ],
];

for (const [name, input, state, word, reason] of serviceRows) {
  test(`judgeService: ${name} → ${state}`, () => {
    const v = judgeService({ kumaOk: true, now: NOW, thresholds: T, ...input });
    assert.deepEqual([v.state, v.word, v.reason], [state, word, reason]);
  });
}

const containerRows = [
  ['running', { card: card('n:a'), containersRead: true }, 'ok', 'Running'],
  ['missing', { card: missing('n:a'), containersRead: true }, 'warn', 'Missing: no longer running'],
  [
    'missing, backs a monitor',
    { card: missing('n:a'), backedBy: 'App', containersRead: true },
    'crit',
    'Missing: it backs the Kuma monitor App',
  ],
  [
    'container list unread',
    { card: card('n:a'), containersRead: false },
    'unknown',
    'No data: Prometheus unreachable',
  ],
];

for (const [name, input, state, reason] of containerRows) {
  test(`judgeContainer: ${name} → ${state}`, () => {
    const v = judgeContainer(input);
    assert.deepEqual([v.state, v.reason], [state, reason]);
  });
}

const upsRows = [
  ['on mains', { status: 1, charge: 100, ok: true }, 'ok', 'On mains'],
  ['on battery', { status: 2, charge: 64.4, ok: true }, 'crit', 'On battery (64 % charge)'],
  ['on battery, no charge reading', { status: 2, charge: null, ok: true }, 'crit', 'On battery'],
  ['low battery', { status: 3, charge: 9, ok: true }, 'crit', 'Low battery (9 % charge)'],
  ['NUT says unknown', { status: 0, ok: true }, 'unknown', 'NUT reports the UPS status as unknown'],
  ['exporter quiet', { status: null, ok: true }, 'unknown', 'No data: NUT exporter not reporting'],
  ['query failed', { status: null, ok: false }, 'unknown', 'No data: Prometheus unreachable'],
  ['no payload', null, 'unknown', 'No data: Prometheus unreachable'],
];

for (const [name, ups, state, reason] of upsRows) {
  test(`judgeUps: ${name} → ${state}`, () => {
    const v = judgeUps(ups);
    assert.deepEqual([v.state, v.reason], [state, reason]);
  });
}

const HOUR = 3_600_000;
const jobRows = [
  // name, run, backup, state, reason
  ['succeeded', cronRun('success'), false, 'ok', 'Last run succeeded'],
  [
    'failed',
    cronRun('failure', 60_000, { error: 'exit 2' }),
    false,
    'warn',
    'Last run failed: exit 2',
  ],
  ['failed, no error text', cronRun('failure'), false, 'warn', 'Last run failed'],
  [
    'overdue',
    cronRun('success', 2 * HOUR, { expected_every_seconds: 900 }),
    false,
    'warn',
    'Overdue: no report on schedule (expected every 15 min)',
  ],
  ['no status', cronRun('weird'), false, 'unknown', 'Last report has no status'],
  ['no run', null, false, 'unknown', 'No run reported'],
  ['backup succeeded', cronRun('success'), true, 'ok', 'Last backup succeeded'],
  [
    'backup failed',
    cronRun('failure', 60_000, { error: 'disk full' }),
    true,
    'crit',
    'Last backup failed: disk full',
  ],
  [
    'backup failed and overdue',
    cronRun('failure', 3 * 24 * HOUR, { expected_every_seconds: 86_400 }),
    true,
    'crit',
    'Last backup failed · overdue',
  ],
  [
    'backup overdue',
    cronRun('success', 3 * 24 * HOUR, { expected_every_seconds: 86_400 }),
    true,
    'warn',
    'Overdue: no report on schedule (expected every 24 h)',
  ],
];

for (const [name, run, backup, state, reason] of jobRows) {
  test(`judgeJob: ${name} → ${state}`, () => {
    const v = judgeJob({ run, now: NOW, backup });
    assert.deepEqual([v.state, v.reason], [state, reason]);
  });
}

test('judgeJob: since is the run, or when it became overdue', () => {
  const run = cronRun('success', 2 * HOUR, { expected_every_seconds: 900 });
  // 15 min interval + 10 min grace after the run.
  assert.equal(judgeJob({ run, now: NOW }).sinceHint, NOW - 2 * HOUR + 25 * 60_000);
  assert.equal(judgeJob({ run: cronRun('failure', 5000), now: NOW }).sinceHint, NOW - 5000);
});

const integrationRows = [
  ['ok', { _status: { state: 'ok', since: 1 } }, 'ok', 'OK'],
  [
    'backing off',
    { _error: 'connect ECONNREFUSED', _status: { state: 'backing_off', since: 2 } },
    'warn',
    'Fetch failed: connect ECONNREFUSED',
  ],
  [
    'login refused twice',
    {
      _error: 'HTTP 403 (login refused twice; not retried until it is saved in Settings)',
      _status: { state: 'auth_failed', since: 3 },
    },
    'warn',
    'Login refused: save it in Settings to retry',
  ],
  ['no _status, an error', { _error: 'HTTP 500' }, 'warn', 'Fetch failed: HTTP 500'],
  ['no _status, no error', { Queue: '1' }, 'ok', 'OK'],
  [
    'an error carrying a credential',
    {
      _error: 'fetch https://u:hunter2@app.lan/api?apikey=abc123 failed',
      _status: { state: 'backing_off', since: 4 },
    }, // pragma: allowlist secret
    'warn',
    'Fetch failed: fetch https://u:[redacted]@app.lan/api?[redacted] failed',
  ],
];

for (const [name, entry, state, reason] of integrationRows) {
  test(`judgeIntegration: ${name} → ${state}`, () => {
    const v = judgeIntegration(entry);
    assert.deepEqual([v.state, v.reason], [state, reason]);
  });
}

const agentRows = [
  ['online', 'up', 'ok'],
  ['offline', 'down', 'warn'],
  ['no status', 'unknown', 'unknown'],
];

for (const [name, state, want] of agentRows) {
  test(`judgeAgent: ${name} → ${want}`, () => {
    assert.equal(judgeAgent({ state }).state, want);
  });
}

test('errorText and spanText: credentials out, long text cut; spans as cron words them', () => {
  assert.equal(errorText('x'.repeat(200)).length, 121);
  assert.equal(spanText(900), '15 min');
  assert.equal(spanText(3 * 3600), '3 h');
  assert.equal(spanText(3 * 86_400), '3 d');
});

// ── Each kind through the whole model ──

const modelRows = [
  // id, inputs, kind, subsystem, state
  ['nodes/n1', inputs({ nodes: { n1: node({ diskPercent: '96' }) } }), 'node', 'nodes', 'crit'],
  [
    'services/n1:a',
    inputs({ nodes: { n1: node({}, { services: [monitored('n1:a', 'down')] }) } }),
    'service',
    'services',
    'crit',
  ],
  [
    'services/n1:b',
    inputs({ nodes: { n1: node({}, { services: [missing('n1:b')] }) } }),
    'container',
    'services',
    'warn',
  ],
  [
    'power/ups',
    inputs({ ups: { status: 2, charge: 50, ok: true, configured: true } }),
    'ups',
    'power',
    'crit',
  ],
  [
    'jobs/vm:j',
    inputs({ cron: [cronNode('vm', { j: cronRun('failure') })] }),
    'job',
    'jobs',
    'warn',
  ],
  [
    'backups/vm:b',
    inputs({ cron: [cronNode('vm', { b: cronRun('failure') })], backupJobs: ['vm:b'] }),
    'backup',
    'backups',
    'crit',
  ],
  [
    'integrations/x',
    inputs({ integrations: { x: { _error: 'e', _status: { state: 'backing_off', since: NOW } } } }),
    'integration',
    'integrations',
    'warn',
  ],
  [
    'integrations/arcane:pi',
    inputs({ arcaneAgents: [{ env: 'pi', state: 'down' }] }),
    'agent',
    'integrations',
    'warn',
  ],
];

for (const [id, cycleInputs, kind, subsystem, state] of modelRows) {
  test(`model: ${kind} ${id} is in ${subsystem}, ${state}, and an issue`, () => {
    const s = once(cycleInputs);
    const e = entityOf(s, id);
    assert.deepEqual([e.kind, e.subsystem, e.state], [kind, subsystem, state]);
    assert.ok(s.issues.some((i) => i.id === id));
    for (const key of ['id', 'kind', 'state', 'reason']) assert.equal(typeof e[key], 'string', key);
    assert.ok(Number.isFinite(e.since));
  });
}

test('model: no UPS set up is no Power entity, and no NUT source', () => {
  const s = once(inputs({ ups: { status: null, ok: true, configured: false } }));
  assert.equal(entityOf(s, 'power/ups'), undefined);
  assert.equal(s.sources.nut, undefined);
  assert.equal(s.subsystems.find((x) => x.id === 'power').detail, 'None');
});

test('model: the UPS query failing alone is Prometheus failing, not NUT', () => {
  const [, s] = cycles([
    inputs(),
    inputs({ ups: { status: null, charge: null, ok: false, configured: null, model: null } }),
  ]);
  const ups = entityOf(s, 'power/ups');
  assert.deepEqual(
    [ups.state, ups.reason, ups.name],
    ['unknown', 'No data: Prometheus unreachable', 'Back-UPS']
  );
  assert.deepEqual(s.sources.prometheus, {
    state: 'failed',
    error: 'The UPS query failed',
    since: NOW + 30_000,
  });
  assert.equal(s.sources.nut.state, 'ok');
  assert.deepEqual(
    s.issues.map((i) => i.id),
    ['sources/prometheus', 'power/ups']
  );
  assert.equal(entityOf(s, 'nodes/n1').state, 'ok', 'the nodes it read are still judged');
});
