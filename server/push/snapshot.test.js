import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeServiceStatus,
  normalizeCronStatus,
  normalizeUpsStatus,
  coerceFraction,
  buildServices,
  buildCron,
  buildHosts,
  buildUps,
  buildSnapshot,
} from './snapshot.js';

test('normalizeServiceStatus: up/down recognized, everything else unknown', () => {
  assert.equal(normalizeServiceStatus('up'), 'up');
  assert.equal(normalizeServiceStatus('down'), 'down');
  assert.equal(normalizeServiceStatus('UP'), 'up'); // case-insensitive
  assert.equal(normalizeServiceStatus('running'), 'unknown');
  assert.equal(normalizeServiceStatus('unknown'), 'unknown');
  assert.equal(normalizeServiceStatus(null), 'unknown');
  assert.equal(normalizeServiceStatus(undefined), 'unknown');
  assert.equal(normalizeServiceStatus(''), 'unknown');
});

test('normalizeCronStatus: success/failure recognized, else unknown', () => {
  assert.equal(normalizeCronStatus('success'), 'success');
  assert.equal(normalizeCronStatus('failure'), 'failure');
  assert.equal(normalizeCronStatus('FAILURE'), 'failure');
  assert.equal(normalizeCronStatus('pending'), 'unknown');
  assert.equal(normalizeCronStatus(null), 'unknown');
  assert.equal(normalizeCronStatus(undefined), 'unknown');
});

test('normalizeUpsStatus: numeric nut_status mapped, else unknown', () => {
  // Canonical NUT decode (matches src/components/Widgets.jsx:22):
  // 0=Unknown, 1=Online (OL), 2=On Battery (OB), 3=Low Battery (LB).
  assert.equal(normalizeUpsStatus(1), 'online'); // OL
  assert.equal(normalizeUpsStatus(2), 'on_battery'); // OB
  assert.equal(normalizeUpsStatus(0), 'unknown'); // Unknown
  assert.equal(normalizeUpsStatus(3), 'on_battery'); // Low Battery folds into on_battery
  assert.equal(normalizeUpsStatus('online'), 'online'); // string passthrough
  assert.equal(normalizeUpsStatus('on_battery'), 'on_battery');
  assert.equal(normalizeUpsStatus(7), 'unknown'); // unrecognized code
  assert.equal(normalizeUpsStatus(null), 'unknown');
  assert.equal(normalizeUpsStatus(undefined), 'unknown');
  assert.equal(normalizeUpsStatus('garbage'), 'unknown');
});

test('coerceFraction: percent-string 0..100 -> 0..1 fraction, clamped, junk -> 0', () => {
  assert.equal(coerceFraction('45.6'), 0.456);
  assert.equal(coerceFraction('100'), 1);
  assert.equal(coerceFraction('0'), 0);
  assert.equal(coerceFraction(90), 0.9); // bare number percent
  assert.equal(coerceFraction(null), 0);
  assert.equal(coerceFraction(undefined), 0);
  assert.equal(coerceFraction('NaN'), 0);
  assert.equal(coerceFraction('150'), 1); // clamp high
  assert.equal(coerceFraction('-5'), 0); // clamp low
});

// ── Task 2: buildServices + buildCron ────────────────────────────────────────

test('buildServices: flattens nodes->services to NODE:ID map, sorted, normalized', () => {
  const cache = {
    nodes: {
      vm103: {
        services: [
          { uid: 'vm103:zoo', status: 'up' },
          { uid: 'vm103:abc', status: 'down' },
        ],
      },
      pi2: {
        services: [{ uid: 'pi2:ntp', status: 'running' }], // unrecognized -> unknown
      },
    },
  };
  const out = buildServices(cache);
  assert.deepEqual(out, {
    'pi2:ntp': 'unknown',
    'vm103:abc': 'down',
    'vm103:zoo': 'up',
  });
  // canonical ascending key order
  assert.deepEqual(Object.keys(out), ['pi2:ntp', 'vm103:abc', 'vm103:zoo']);
});

test('buildServices: missing/empty cache -> empty map', () => {
  assert.deepEqual(buildServices(null), {});
  assert.deepEqual(buildServices({}), {});
  assert.deepEqual(buildServices({ nodes: {} }), {});
  assert.deepEqual(buildServices({ nodes: { pi: {} } }), {});
});

test('buildServices: byte-identical regardless of insertion order', () => {
  const a = { nodes: { pi: { services: [{ uid: 'pi:b', status: 'up' }, { uid: 'pi:a', status: 'down' }] } } };
  const b = { nodes: { pi: { services: [{ uid: 'pi:a', status: 'down' }, { uid: 'pi:b', status: 'up' }] } } };
  assert.equal(JSON.stringify(buildServices(a)), JSON.stringify(buildServices(b)));
});

test('buildCron: latest run per NODE:JOB, sorted, normalized', () => {
  const statuses = [
    {
      node: 'vm103',
      jobs: [
        { job: 'sync', runs: [{ status: 'failure' }, { status: 'success' }] }, // latest = failure
        { job: 'backup', runs: [{ status: 'success' }] },
      ],
    },
    { node: 'pi2', jobs: [{ job: 'prune', runs: [{ status: 'weird' }] }] }, // -> unknown
  ];
  const out = buildCron(statuses);
  assert.deepEqual(out, {
    'pi2:prune': 'unknown',
    'vm103:backup': 'success',
    'vm103:sync': 'failure',
  });
  assert.deepEqual(Object.keys(out), ['pi2:prune', 'vm103:backup', 'vm103:sync']);
});

test('buildCron: empty runs / empty input -> unknown or empty map', () => {
  assert.deepEqual(buildCron([]), {});
  assert.deepEqual(buildCron(null), {});
  assert.deepEqual(buildCron([{ node: 'pi', jobs: [{ job: 'j', runs: [] }] }]), { 'pi:j': 'unknown' });
});
