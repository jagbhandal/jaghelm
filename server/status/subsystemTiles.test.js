/**
 * A subsystem's tile, as the model gives it (#541): a short `value` for the
 * strip's big line ("31 / 32", the UPS's "On mains") and the `sub` under it
 * ("up · 1 in maintenance", "64 % charge"), from the same counts that build
 * `detail`. `detail` stays as it was: the header sentence, push and an older
 * Android app read it. No client splits a string.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cronNode,
  cronRun,
  cycles,
  inputs,
  monitored,
  node,
  NO_UPS,
  once,
} from '../testing/statusFixtures.js';
import { STATUS_SCENARIOS, scenarioStatus } from '../testing/statusScenarios.js';
import { subsystemsOf } from './summary.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');

const tile = (s) => [s.value, s.sub];
const byId = (status, id) => status.subsystems.find((s) => s.id === id);

// The UPS as the model judges it (rules.js judgeUps), on its own in Power.
const ups = (state, word, reason, metric) => ({
  id: 'power/ups',
  kind: 'ups',
  subsystem: 'power',
  state,
  word,
  reason,
  ...(metric ? { metric } : {}),
});
const charge = (value) => ({ name: 'charge', value, unit: '%' });
const one = (subsystem, state, i = 0, word = undefined) => ({
  id: `${subsystem}/${i}`,
  subsystem,
  state,
  ...(word ? { word } : {}),
});

// [what, the entities, the subsystem, its value, its sub, its detail]
const ROWS = [
  ['empty', [], 'services', 'None', '', 'None'],
  [
    'services up',
    [one('services', 'ok'), one('services', 'ok', 1)],
    'services',
    '2 / 2',
    'up',
    '2 / 2 up',
  ],
  // A problem: the sub names it, worst first, in the words the sentence
  // uses, and never says the OK word; the detail is as it was.
  [
    'a service down',
    [one('services', 'ok'), one('services', 'crit', 1, 'Down')],
    'services',
    '1 / 2',
    '1 down',
    '1 / 2 up',
  ],
  [
    'a container missing',
    [one('services', 'ok'), one('services', 'warn', 1, 'Missing')],
    'services',
    '1 / 2',
    '1 missing',
    '1 / 2 up',
  ],
  [
    'a job failed',
    [one('jobs', 'ok'), one('jobs', 'warn', 1, 'Failed')],
    'jobs',
    '1 / 2',
    '1 failed',
    '1 / 2 OK',
  ],
  [
    'a backup overdue',
    [one('backups', 'warn', 0, 'Overdue')],
    'backups',
    '0 / 1',
    '1 overdue',
    '0 / 1 OK',
  ],
  [
    'a node in warning',
    [one('nodes', 'ok'), one('nodes', 'warn', 1, 'Warning')],
    'nodes',
    '1 / 2',
    '1 in warning',
    '1 / 2 healthy',
  ],
  [
    'an integration refusing its login',
    [one('integrations', 'warn', 0, 'Login refused')],
    'integrations',
    '0 / 1',
    '1 with a refused login',
    '0 / 1 OK',
  ],
  [
    'a mix, worst first, then maintenance and no signal',
    [
      one('services', 'warn', 0, 'Missing'),
      one('services', 'crit', 1, 'Down'),
      one('services', 'crit', 2, 'Down'),
      one('services', 'maintenance', 3),
      one('services', 'unknown', 4),
      one('services', 'ok', 5),
    ],
    'services',
    '1 / 6',
    '2 down · 1 missing · 1 in maintenance · 1 no signal',
    '1 / 6 up · 1 in maintenance · 1 no signal',
  ],
  [
    'a service in maintenance',
    [one('services', 'ok'), one('services', 'maintenance', 1)],
    'services',
    '1 / 2',
    'up · 1 in maintenance',
    '1 / 2 up · 1 in maintenance',
  ],
  [
    'all in maintenance',
    [one('services', 'maintenance')],
    'services',
    '0 / 1',
    'up · 1 in maintenance',
    '0 / 1 up · 1 in maintenance',
  ],
  [
    'maintenance and no signal',
    [one('services', 'ok'), one('services', 'maintenance', 1), one('services', 'unknown', 2)],
    'services',
    '1 / 3',
    'up · 1 in maintenance · 1 no signal',
    '1 / 3 up · 1 in maintenance · 1 no signal',
  ],
  ['nodes healthy', [one('nodes', 'ok')], 'nodes', '1 / 1', 'healthy', '1 / 1 healthy'],
  [
    'a node in warning, one no signal',
    [one('nodes', 'warn', 0, 'Warning'), one('nodes', 'unknown', 1)],
    'nodes',
    '0 / 2',
    '1 in warning · 1 no signal',
    '0 / 2 healthy · 1 no signal',
  ],
  ['jobs', [one('jobs', 'ok'), one('jobs', 'ok', 1)], 'jobs', '2 / 2', 'OK', '2 / 2 OK'],
  ['backups', [one('backups', 'ok')], 'backups', '1 / 1', 'OK', '1 / 1 OK'],
  [
    'integrations',
    [one('integrations', 'ok'), one('integrations', 'unknown', 1)],
    'integrations',
    '1 / 2',
    'OK · 1 no signal',
    '1 / 2 OK · 1 no signal',
  ],
  [
    'on mains',
    [ups('ok', 'On mains', 'On mains', charge(92))],
    'power',
    'On mains',
    '92 % charge',
    'On mains',
  ],
  [
    'on mains, no charge reading',
    [ups('ok', 'On mains', 'On mains')],
    'power',
    'On mains',
    '',
    'On mains',
  ],
  [
    'on battery',
    [ups('crit', 'On battery', 'On battery (64 % charge)', charge(64))],
    'power',
    'On battery',
    '64 % charge',
    'On battery (64 % charge)',
  ],
  [
    'low battery',
    [ups('crit', 'Low battery', 'Low battery (9 % charge)', charge(9))],
    'power',
    'Low battery',
    '9 % charge',
    'Low battery (9 % charge)',
  ],
  [
    'the UPS no signal',
    [ups('unknown', 'No signal', 'No data: Prometheus unreachable')],
    'power',
    'No signal',
    'No data: Prometheus unreachable',
    'No data: Prometheus unreachable',
  ],
  [
    'two power entities count as any other',
    [one('power', 'ok'), one('power', 'crit', 1, 'On battery')],
    'power',
    '1 / 2',
    '1 on battery',
    '1 / 2 OK',
  ],
  [
    // The detail, built from the tile, says the no signal count too (push, older APKs).
    'two power entities, one no signal',
    [one('power', 'ok'), one('power', 'unknown', 1)],
    'power',
    '1 / 2',
    'OK · 1 no signal',
    '1 / 2 OK · 1 no signal',
  ],
];

for (const [what, entities, id, value, sub, detail] of ROWS) {
  test(`subsystem tile: ${what} → "${value}" over "${sub}"`, () => {
    const s = subsystemsOf(entities).find((x) => x.id === id);
    assert.deepEqual([s.value, s.sub, s.detail], [value, sub, detail]);
  });
}

test('subsystem tile: every subsystem of an empty board is "None", with no sub', () => {
  assert.deepEqual(
    subsystemsOf([]).map(tile),
    Array.from({ length: 6 }, () => ['None', ''])
  );
});

test('subsystem tile: the model gives the UPS its charge on mains too, as the sub', () => {
  const s = once(inputs());
  assert.deepEqual(tile(byId(s, 'power')), ['On mains', '100 % charge']);
  assert.equal(byId(s, 'power').detail, 'On mains', 'detail is unchanged');
});

test('subsystem tile: maintenance, through the model', () => {
  const s = once(
    inputs({
      nodes: { n1: node({}, { services: [monitored('n1:app'), monitored('n1:wiki')] }) },
      internal: { kumaStatusOf: { 'n1:app': 'up', 'n1:wiki': 'maintenance' } },
      ups: NO_UPS,
    })
  );
  assert.deepEqual(tile(byId(s, 'services')), ['1 / 2', 'up · 1 in maintenance']);
  assert.deepEqual(tile(byId(s, 'power')), ['None', '']);
});

test('subsystem tile: stale readings, a source down, keep the count and say no signal', () => {
  const healthy = inputs({
    nodes: { n1: node({}, { services: [monitored('n1:app')] }) },
    internal: { kumaStatusOf: { 'n1:app': 'up' } },
    cron: [cronNode('n1', { nightly: cronRun('success') })],
  });
  // Prometheus fails: the node, its container card and the UPS are kept as no signal.
  const down = inputs({
    services: null,
    ups: { ...NO_UPS, ok: false },
    cron: [cronNode('n1', { nightly: cronRun('success') })],
  });
  const [, s] = cycles([healthy, down]);
  assert.deepEqual(tile(byId(s, 'services')), ['0 / 1', 'up · 1 no signal']);
  assert.deepEqual(tile(byId(s, 'nodes')), ['0 / 1', 'healthy · 1 no signal']);
  assert.deepEqual(tile(byId(s, 'power')), ['No signal', 'No data: Prometheus unreachable']);
  assert.deepEqual(tile(byId(s, 'jobs')), ['1 / 1', 'OK']);
});

for (const name of STATUS_SCENARIOS) {
  test(`subsystem tile, ${name}: every subsystem has a value and a sub, from its counts`, () => {
    const status = JSON.parse(JSON.stringify(scenarioStatus(name, { now: NOW })));
    for (const s of status.subsystems) {
      const at = `${name} ${s.id}`;
      assert.equal(typeof s.value, 'string', at);
      assert.equal(typeof s.sub, 'string', at);
      assert.ok(s.value.length > 0, `${at}: a value`);
      assert.ok(!s.value.includes(' · '), `${at}: one short value, "${s.value}"`);
      const ups = status.entities.find((e) => e.subsystem === 'power');
      if (s.counts.total === 0) assert.deepEqual(tile(s), ['None', ''], at);
      else if (s.id === 'power' && s.counts.total === 1) {
        assert.equal(s.value, ups.word, `${at}: the UPS's word`);
        assert.equal(s.detail, ups.reason, `${at}: detail is the reason, as before`);
      } else {
        const loud = status.entities.some(
          (e) => e.subsystem === s.id && (e.state === 'crit' || e.state === 'warn')
        );
        const [okPart, ...quiet] = s.detail.split(' · ');
        const okWord = okPart.slice(`${s.value} `.length);
        const parts = s.sub.split(' · ');
        if (!loud) assert.equal(`${s.value} ${s.sub}`, s.detail, `${at}: the detail, split`);
        else {
          assert.ok(!parts.includes(okWord), `${at}: no "${okWord}" beside a problem: "${s.sub}"`);
          assert.match(parts[0], /^\d+ \S/, `${at}: the problem first: "${s.sub}"`);
          assert.deepEqual(
            parts.slice(-quiet.length || parts.length),
            quiet.length ? quiet : [],
            at
          );
        }
      }
    }
  });
}
