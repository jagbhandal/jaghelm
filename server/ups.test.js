/**
 * Which UPS the panel reads (#249): the one JAGHELM_UPS_NAME names (NUT's name
 * for it, the exporter's `ups` label), or, unset, the one the exporter
 * reports, the first by name with a reading when it reports several. No name
 * is built in: the homelab's `apcups` reads as before with nothing set.
 *
 * Against a mock Prometheus that evaluates the query (testing/mockPrometheus.js).
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createMockPrometheus } from './testing/mockPrometheus.js';

delete process.env.JAGHELM_UPS_NAME;
const { initDiscovery } = await import('./discovery.js');
const { refreshUPS, upsQuery } = await import('./refresh.js');

const realFetch = globalThis.fetch;
process.on('exit', () => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  delete process.env.JAGHELM_UPS_NAME;
});

/**
 * The series a NUT exporter gives for the UPS `ups`: its four readings (none
 * when `quiet`: the exporter stopped reporting it this week) and its info.
 */
function nut(ups, { status = 1, charge = 1, runtime = 2100, load = 0.25, model = `${ups} model`, quiet = false } = {}) {
  const target = { ups, instance: 'nut:9199', job: 'nut' };
  const out = quiet
    ? []
    : [
        ['nut_status', status],
        ['nut_battery_charge', charge],
        ['nut_battery_runtime_seconds', runtime],
        ['nut_load', load],
      ].map(([name, value]) => ({ labels: { __name__: name, ...target }, value }));
  out.push({ labels: { __name__: 'nut_ups_info', ...target, description: model }, value: 1, quiet });
  return out;
}

/** refreshUPS against `series`; its payload, the queries it sent and the log lines. */
async function readUps(series) {
  const mock = createMockPrometheus(series);
  initDiscovery(mock.url);
  globalThis.fetch = mock.fetch;
  const lines = [];
  const orig = process.stdout.write;
  process.stdout.write = function (chunk, ...rest) {
    try {
      const obj = JSON.parse(String(chunk));
      if (obj?.module === 'refresh') return lines.push(obj) > 0;
    } catch {
      // not a log line
    }
    return orig.call(this, chunk, ...rest);
  };
  let ups;
  try {
    ups = await refreshUPS();
  } finally {
    process.stdout.write = orig;
  }
  assert.deepEqual(mock.parseErrors, []);
  return { ups, queries: mock.queries, lines };
}

const APCUPS = {
  status: 1,
  charge: 100,
  runtime: 2100,
  load: 25,
  ok: true,
  configured: true,
  model: 'apcups model',
};

test("the homelab's UPS, apcups, with nothing set: the same payload as before, in one query", async () => {
  const { ups, queries } = await readUps(nut('apcups'));
  assert.deepEqual(ups, APCUPS);
  assert.equal(queries.length, 1);
});

test('JAGHELM_UPS_NAME=apcups asks the very query JagHelm asked before #249', async () => {
  process.env.JAGHELM_UPS_NAME = 'apcups';
  const { ups, queries } = await readUps(nut('apcups'));
  assert.deepEqual(ups, APCUPS);
  assert.deepEqual(queries, [
    '{__name__=~"nut_status|nut_battery_charge|nut_battery_runtime_seconds|nut_load",ups="apcups"}' +
      ' or last_over_time(nut_ups_info{ups="apcups"}[7d])',
  ]);
});

test('a UPS with another name shows with nothing set: no name is built in', async () => {
  const { ups } = await readUps(nut('rack-ups', { charge: 0.5 }));
  assert.equal(ups.configured, true);
  assert.equal(ups.charge, 50);
  assert.equal(ups.model, 'rack-ups model');
});

test('JAGHELM_UPS_NAME picks its UPS out of several', async () => {
  process.env.JAGHELM_UPS_NAME = 'office';
  const { ups, lines } = await readUps([...nut('apcups'), ...nut('office', { status: 2, charge: 0.4 })]);
  assert.deepEqual([ups.status, ups.charge, ups.model], [2, 40, 'office model']);
  assert.deepEqual(lines, [], 'chosen, so nothing to say');
});

test('JAGHELM_UPS_NAME naming a UPS NUT does not report: no UPS', async () => {
  process.env.JAGHELM_UPS_NAME = 'gone';
  const { ups } = await readUps(nut('apcups'));
  assert.equal(ups.configured, false);
  assert.equal(ups.status, null);
});

test('several UPSes and none named: the first by name with a reading, said once', async () => {
  const series = [
    ...nut('attic', { quiet: true }), // seen this week, no reading now
    ...nut('rack', { charge: 0.9 }),
    ...nut('office', { charge: 0.6 }),
  ];
  const first = await readUps(series);
  assert.deepEqual([first.ups.charge, first.ups.model], [60, 'office model']);
  assert.deepEqual(
    first.lines.map((l) => [l.level, l.msg, l.ups, l.found]),
    [['info', 'NUT reports several UPSes: the UPS panel shows one; set JAGHELM_UPS_NAME to choose', 'office', ['attic', 'office', 'rack']]]
  );
  const again = await readUps(series);
  assert.deepEqual(again.lines, [], 'not again while NUT reports the same');
});

test('a quiet UPS alone is still the one set up, as before', async () => {
  const { ups } = await readUps(nut('apcups', { quiet: true }));
  assert.deepEqual([ups.configured, ups.status, ups.model], [true, null, 'apcups model']);
});

test('a name with a quote or a backslash is a PromQL string, never part of the query', () => {
  assert.equal(
    upsQuery('a"b\\c'),
    '{__name__=~"nut_status|nut_battery_charge|nut_battery_runtime_seconds|nut_load",ups="a\\"b\\\\c"}' +
      ' or last_over_time(nut_ups_info{ups="a\\"b\\\\c"}[7d])'
  );
});

test('the name is read as NUT has it: a name with a quote finds its UPS', async () => {
  process.env.JAGHELM_UPS_NAME = 'odd"name';
  const { ups } = await readUps(nut('odd"name'));
  assert.equal(ups.model, 'odd"name model');
});
