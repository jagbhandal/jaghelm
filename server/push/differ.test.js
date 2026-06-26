import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffSnapshots, RECOVERY_TYPES, SEVERITY } from './differ.js';

const EMPTY = { services: {}, hosts: {}, ups: { state: 'unknown' }, cron: {} };
const THRESHOLDS = { cpu: 0.9, mem: 0.9, disk: 0.9, hysteresis: 0.05 };

test('exports SEVERITY map covering all event types', () => {
  assert.equal(SEVERITY.service_down, 'critical');
  assert.equal(SEVERITY.service_recovered, 'info');
  assert.equal(SEVERITY.host_unreachable, 'critical');
  assert.equal(SEVERITY.host_recovered, 'info');
  assert.equal(SEVERITY.host_threshold, 'warning');
  assert.equal(SEVERITY.host_threshold_cleared, 'info');
  assert.equal(SEVERITY.ups_on_battery, 'critical');
  assert.equal(SEVERITY.ups_restored, 'info');
  assert.equal(SEVERITY.cron_failed, 'warning');
  assert.equal(SEVERITY.cron_recovered, 'info');
});

test('RECOVERY_TYPES is exactly the info-severity types', () => {
  assert.ok(RECOVERY_TYPES instanceof Set);
  const expected = [
    'service_recovered',
    'host_recovered',
    'host_threshold_cleared',
    'ups_restored',
    'cron_recovered',
  ].sort();
  assert.deepEqual([...RECOVERY_TYPES].sort(), expected);
  for (const [type, sev] of Object.entries(SEVERITY)) {
    assert.equal(RECOVERY_TYPES.has(type), sev === 'info');
  }
});

test('baseline: prev=null returns [] regardless of next', () => {
  assert.deepEqual(diffSnapshots(null, EMPTY, THRESHOLDS), []);
  const populated = {
    services: { 'n1:web': 'down' },
    hosts: { n1: { reachable: false, cpu: 0.99, mem: 0.99, disk: 0.99 } },
    ups: { state: 'on_battery' },
    cron: { 'n1:backup': 'failure' },
  };
  assert.deepEqual(diffSnapshots(null, populated, THRESHOLDS), []);
});

test('no change: identical prev/next returns []', () => {
  const snap = {
    services: { 'n1:web': 'up' },
    hosts: { n1: { reachable: true, cpu: 0.1, mem: 0.1, disk: 0.1 } },
    ups: { state: 'online' },
    cron: { 'n1:backup': 'success' },
  };
  assert.deepEqual(diffSnapshots(snap, snap, THRESHOLDS), []);
});

function svc(map) {
  return { services: map, hosts: {}, ups: { state: 'unknown' }, cron: {} };
}

test('service up->down emits service_down(critical)', () => {
  const prev = svc({ 'n1:web': 'up' });
  const next = svc({ 'n1:web': 'down' });
  const events = diffSnapshots(prev, next, THRESHOLDS);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'service_down',
    id: 'n1:web',
    node: 'n1',
    title: 'Service down',
    body: 'web on n1 is down',
    severity: 'critical',
    prev: 'up',
    next: 'down',
  });
});

test('service unknown->down emits service_down', () => {
  const events = diffSnapshots(svc({ 'n1:web': 'unknown' }), svc({ 'n1:web': 'down' }), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'service_down');
  assert.equal(events[0].prev, 'unknown');
});

test('service down->up emits service_recovered(info)', () => {
  const events = diffSnapshots(svc({ 'n1:web': 'down' }), svc({ 'n1:web': 'up' }), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'service_recovered',
    id: 'n1:web',
    node: 'n1',
    title: 'Service recovered',
    body: 'web on n1 is back up',
    severity: 'info',
    prev: 'down',
    next: 'up',
  });
});

test('service down->unknown emits nothing (unknown never emits)', () => {
  assert.deepEqual(diffSnapshots(svc({ 'n1:web': 'down' }), svc({ 'n1:web': 'unknown' }), THRESHOLDS), []);
});

test('service up->up and down->down emit nothing', () => {
  assert.deepEqual(diffSnapshots(svc({ 'n1:web': 'up' }), svc({ 'n1:web': 'up' }), THRESHOLDS), []);
  assert.deepEqual(diffSnapshots(svc({ 'n1:web': 'down' }), svc({ 'n1:web': 'down' }), THRESHOLDS), []);
});

test('service new key in next (no prev entry) treated as prev=unknown', () => {
  // absent in prev => undefined => treated as "unknown"; unknown->down emits
  const events = diffSnapshots(svc({}), svc({ 'n1:web': 'down' }), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'service_down');
  assert.equal(events[0].prev, 'unknown');
});

function host(map) {
  return { services: {}, hosts: map, ups: { state: 'unknown' }, cron: {} };
}
const OK = { reachable: true, cpu: 0.1, mem: 0.1, disk: 0.1 };
const DOWN = { reachable: false, cpu: 0, mem: 0, disk: 0 };

test('host reachable true->false emits host_unreachable(critical)', () => {
  const events = diffSnapshots(host({ n1: OK }), host({ n1: DOWN }), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'host_unreachable',
    id: 'n1',
    node: 'n1',
    title: 'Host unreachable',
    body: 'n1 is unreachable',
    severity: 'critical',
    prev: true,
    next: false,
  });
});

test('host reachable false->true emits host_recovered(info)', () => {
  const events = diffSnapshots(host({ n1: DOWN }), host({ n1: OK }), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'host_recovered',
    id: 'n1',
    node: 'n1',
    title: 'Host recovered',
    body: 'n1 is reachable again',
    severity: 'info',
    prev: false,
    next: true,
  });
});

test('host reachable unchanged emits nothing', () => {
  assert.deepEqual(diffSnapshots(host({ n1: OK }), host({ n1: OK }), THRESHOLDS), []);
  assert.deepEqual(diffSnapshots(host({ n1: DOWN }), host({ n1: DOWN }), THRESHOLDS), []);
});

test('host absent in prev defaults to reachable:false (no false unreachable)', () => {
  // prev missing host => reachable:false; next OK => false->true => host_recovered
  const events = diffSnapshots(host({}), host({ n1: OK }), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'host_recovered');
});

function hostM(prevM, nextM) {
  const p = { reachable: true, cpu: 0.1, mem: 0.1, disk: 0.1, ...prevM };
  const n = { reachable: true, cpu: 0.1, mem: 0.1, disk: 0.1, ...nextM };
  return [host({ n1: p }), host({ n1: n })];
}

test('cpu rises below->above threshold emits host_threshold(warning)', () => {
  const [prev, next] = hostM({ cpu: 0.5 }, { cpu: 0.95 });
  const events = diffSnapshots(prev, next, THRESHOLDS);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'host_threshold',
    id: 'n1:cpu',
    node: 'n1',
    title: 'Host cpu high',
    body: 'n1 cpu at 95% (threshold 90%)',
    severity: 'warning',
    prev: 0.5,
    next: 0.95,
  });
});

test('cpu exactly at threshold (0.90) counts as crossed (>=)', () => {
  const [prev, next] = hostM({ cpu: 0.5 }, { cpu: 0.9 });
  const events = diffSnapshots(prev, next, THRESHOLDS);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'host_threshold');
});

test('cpu falls below (threshold - hysteresis) clears => host_threshold_cleared(info)', () => {
  // already above, drop to 0.84 (< 0.90-0.05=0.85)
  const [prev, next] = hostM({ cpu: 0.95 }, { cpu: 0.84 });
  const events = diffSnapshots(prev, next, THRESHOLDS);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'host_threshold_cleared',
    id: 'n1:cpu',
    node: 'n1',
    title: 'Host cpu normal',
    body: 'n1 cpu back to 84% (threshold 90%)',
    severity: 'info',
    prev: 0.95,
    next: 0.84,
  });
});

test('hysteresis band: above, drops to 0.87 (between 0.85 and 0.90) emits nothing', () => {
  const [prev, next] = hostM({ cpu: 0.95 }, { cpu: 0.87 });
  assert.deepEqual(diffSnapshots(prev, next, THRESHOLDS), []);
});

test('hysteresis band: below, rises to 0.87 (between 0.85 and 0.90) emits nothing', () => {
  const [prev, next] = hostM({ cpu: 0.5 }, { cpu: 0.87 });
  assert.deepEqual(diffSnapshots(prev, next, THRESHOLDS), []);
});

test('clear at exactly threshold-hysteresis (0.85) does NOT clear (must be below)', () => {
  const [prev, next] = hostM({ cpu: 0.95 }, { cpu: 0.85 });
  assert.deepEqual(diffSnapshots(prev, next, THRESHOLDS), []);
});

test('mem and disk crossings are independent events with NODE:METRIC ids', () => {
  const [prev, next] = hostM({ mem: 0.5, disk: 0.5 }, { mem: 0.95, disk: 0.99 });
  const events = diffSnapshots(prev, next, THRESHOLDS);
  assert.equal(events.length, 2);
  // canonically sorted by (type,id): both host_threshold, id mem < disk? "n1:disk" < "n1:mem"
  assert.deepEqual(events.map((e) => e.id), ['n1:disk', 'n1:mem']);
});

test('threshold crossings skipped when host not reachable in next', () => {
  const [prev] = hostM({ cpu: 0.5 }, {});
  const next = host({ n1: { reachable: false, cpu: 0.99, mem: 0.99, disk: 0.99 } });
  const events = diffSnapshots(prev, next, THRESHOLDS);
  // only host_unreachable, no host_threshold despite high cpu
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'host_unreachable');
});

function ups(state) {
  return { services: {}, hosts: {}, ups: { state }, cron: {} };
}

test('ups online->on_battery emits ups_on_battery(critical)', () => {
  const events = diffSnapshots(ups('online'), ups('on_battery'), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'ups_on_battery',
    id: 'ups',
    node: 'ups',
    title: 'UPS on battery',
    body: 'UPS switched to battery power',
    severity: 'critical',
    prev: 'online',
    next: 'on_battery',
  });
});

test('ups on_battery->online emits ups_restored(info)', () => {
  const events = diffSnapshots(ups('on_battery'), ups('online'), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'ups_restored',
    id: 'ups',
    node: 'ups',
    title: 'UPS restored',
    body: 'UPS back on line power',
    severity: 'info',
    prev: 'on_battery',
    next: 'online',
  });
});

test('ups transitions to/from unknown emit nothing', () => {
  assert.deepEqual(diffSnapshots(ups('unknown'), ups('on_battery'), THRESHOLDS), []);
  assert.deepEqual(diffSnapshots(ups('online'), ups('unknown'), THRESHOLDS), []);
  assert.deepEqual(diffSnapshots(ups('unknown'), ups('online'), THRESHOLDS), []);
});

test('ups unchanged emits nothing', () => {
  assert.deepEqual(diffSnapshots(ups('online'), ups('online'), THRESHOLDS), []);
  assert.deepEqual(diffSnapshots(ups('on_battery'), ups('on_battery'), THRESHOLDS), []);
});

function cron(map) {
  return { services: {}, hosts: {}, ups: { state: 'unknown' }, cron: map };
}

test('cron success->failure emits cron_failed(warning)', () => {
  const events = diffSnapshots(cron({ 'n1:backup': 'success' }), cron({ 'n1:backup': 'failure' }), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'cron_failed',
    id: 'n1:backup',
    node: 'n1',
    title: 'Cron job failed',
    body: 'backup on n1 failed',
    severity: 'warning',
    prev: 'success',
    next: 'failure',
  });
});

test('cron new (no prev) ->failure emits cron_failed with prev=unknown', () => {
  const events = diffSnapshots(cron({}), cron({ 'n1:backup': 'failure' }), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'cron_failed');
  assert.equal(events[0].prev, 'unknown');
});

test('cron failure->success emits cron_recovered(info)', () => {
  const events = diffSnapshots(cron({ 'n1:backup': 'failure' }), cron({ 'n1:backup': 'success' }), THRESHOLDS);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'cron_recovered',
    id: 'n1:backup',
    node: 'n1',
    title: 'Cron job recovered',
    body: 'backup on n1 succeeded',
    severity: 'info',
    prev: 'failure',
    next: 'success',
  });
});

test('cron failure->unknown and unchanged emit nothing', () => {
  assert.deepEqual(diffSnapshots(cron({ 'n1:backup': 'failure' }), cron({ 'n1:backup': 'unknown' }), THRESHOLDS), []);
  assert.deepEqual(diffSnapshots(cron({ 'n1:backup': 'success' }), cron({ 'n1:backup': 'success' }), THRESHOLDS), []);
  assert.deepEqual(diffSnapshots(cron({ 'n1:backup': 'failure' }), cron({ 'n1:backup': 'failure' }), THRESHOLDS), []);
});

test('canonical sort: two insertion-order permutations produce byte-identical arrays', () => {
  // Same logical changes, keys inserted in different order in `next`.
  const prevA = {
    services: { 'n1:web': 'up', 'n2:db': 'up' },
    hosts: { n1: { reachable: true, cpu: 0.1, mem: 0.1, disk: 0.1 } },
    ups: { state: 'online' },
    cron: { 'n1:backup': 'success' },
  };
  const nextA = {
    services: { 'n1:web': 'down', 'n2:db': 'down' },
    hosts: { n1: { reachable: false, cpu: 0.1, mem: 0.1, disk: 0.1 } },
    ups: { state: 'on_battery' },
    cron: { 'n1:backup': 'failure' },
  };
  // Permutation: same data, different object key insertion order.
  const prevB = {
    cron: { 'n1:backup': 'success' },
    ups: { state: 'online' },
    services: { 'n2:db': 'up', 'n1:web': 'up' },
    hosts: { n1: { disk: 0.1, mem: 0.1, cpu: 0.1, reachable: true } },
  };
  const nextB = {
    cron: { 'n1:backup': 'failure' },
    ups: { state: 'on_battery' },
    services: { 'n2:db': 'down', 'n1:web': 'down' },
    hosts: { n1: { disk: 0.1, mem: 0.1, cpu: 0.1, reachable: false } },
  };
  const a = diffSnapshots(prevA, nextA, THRESHOLDS);
  const b = diffSnapshots(prevB, nextB, THRESHOLDS);
  assert.equal(JSON.stringify(a), JSON.stringify(b)); // byte-identical
});

test('canonical sort: ascending by (type, id) with id tiebreak', () => {
  const prev = {
    services: { 'n1:a': 'up', 'n2:z': 'up' },
    hosts: {},
    ups: { state: 'online' },
    cron: { 'n1:job': 'success' },
  };
  const next = {
    services: { 'n1:a': 'down', 'n2:z': 'down' },
    hosts: {},
    ups: { state: 'on_battery' },
    cron: { 'n1:job': 'failure' },
  };
  const events = diffSnapshots(prev, next, THRESHOLDS);
  // types: cron_failed, service_down, service_down, ups_on_battery
  // sorted by type then id: cron_failed(n1:job) < service_down(n1:a) < service_down(n2:z) < ups_on_battery(ups)
  assert.deepEqual(
    events.map((e) => [e.type, e.id]),
    [
      ['cron_failed', 'n1:job'],
      ['service_down', 'n1:a'],
      ['service_down', 'n2:z'],
      ['ups_on_battery', 'ups'],
    ],
  );
  // explicit determinism guard: re-running yields byte-identical output
  assert.equal(JSON.stringify(diffSnapshots(prev, next, THRESHOLDS)), JSON.stringify(events));
});

test('canonical sort: same type, id ordering uses string compare (n1:cpu < n1:disk < n1:mem)', () => {
  const base = { reachable: true, cpu: 0.5, mem: 0.5, disk: 0.5 };
  const hot = { reachable: true, cpu: 0.95, mem: 0.95, disk: 0.95 };
  const events = diffSnapshots(host({ n1: base }), host({ n1: hot }), THRESHOLDS);
  assert.deepEqual(events.map((e) => e.id), ['n1:cpu', 'n1:disk', 'n1:mem']);
});
