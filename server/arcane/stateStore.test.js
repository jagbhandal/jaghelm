// server/arcane/stateStore.test.js
// The store lives in memory; since #581 its toFile() is persisted in
// push-snapshot.json with the poll's notices (notices.test.js), and a restart
// opens a new store from it (`initial`). `reopen` is that round trip, through
// JSON as the file holds it; `fromFile` opens what a file (or an old
// arcane-state.json) holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArcaneStateStore } from './stateStore.js';

const fromFile = (text) => createArcaneStateStore({ initial: JSON.parse(text) });
const reopen = (s) => fromFile(JSON.stringify(s.toFile()));
const onDisk = (s) => JSON.parse(JSON.stringify(s.toFile()));

test('round-trips through a fresh instance', () => {
  const a = createArcaneStateStore();
  a.markKnownEnv('vm-103');
  a.setAgent('pi-1', { downPolls: 2, alerted: true });
  a.addActivity('vm-103', 'act-1');
  a.setReleaseNotified('v2.17.0');
  const b = reopen(a);
  assert.equal(b.isKnownEnv('vm-103'), true);
  assert.equal(b.isKnownEnv('vm-101'), false);
  assert.deepEqual(b.getAgent('pi-1'), { downPolls: 2, alerted: true });
  assert.equal(b.getAgent('nope'), null);
  assert.equal(b.hasActivity('vm-103', 'act-1'), true);
  assert.equal(b.hasActivity('vm-103', 'act-2'), false);
  assert.equal(b.getReleaseNotified(), 'v2.17.0');
});

test('anything but the state loads as empty', () => {
  for (const initial of [undefined, null, 'junk', 7, [], { envs: 'nope', release: [] }]) {
    const s = createArcaneStateStore({ initial });
    assert.equal(s.isKnownEnv('x'), false);
    assert.equal(s.getReleaseNotified(), null);
    s.markKnownEnv('x');
    assert.equal(reopen(s).isKnownEnv('x'), true);
  }
});

test('__proto__ as a name does not pollute Object.prototype', () => {
  const s = createArcaneStateStore();
  s.markKnownEnv('__proto__');
  s.setAgent('__proto__', { downPolls: 1, alerted: false });
  s.addActivity('__proto__', 'a');
  assert.equal({}.known, undefined);
  assert.equal({}.agent, undefined);
  assert.equal(Object.prototype.known, undefined);
  const b = reopen(s);
  assert.equal(b.isKnownEnv('__proto__'), true);
  assert.equal(b.hasActivity('__proto__', 'a'), true);
  assert.equal(createArcaneStateStore().isKnownEnv('toString'), false);
});

test('the 201st activity id evicts the oldest', () => {
  const s = createArcaneStateStore();
  for (let i = 0; i < 201; i++) s.addActivity('vm-103', `id-${i}`);
  assert.equal(s.hasActivity('vm-103', 'id-0'), false);
  assert.equal(s.hasActivity('vm-103', 'id-1'), true);
  assert.equal(s.hasActivity('vm-103', 'id-200'), true);
  const b = reopen(s);
  assert.equal(b.hasActivity('vm-103', 'id-0'), false);
  assert.equal(b.hasActivity('vm-103', 'id-200'), true);
});

test('at most 50 environments are kept', () => {
  const s = createArcaneStateStore();
  for (let i = 0; i < 55; i++) s.markKnownEnv(`env-${i}`);
  assert.equal(s.isKnownEnv('env-0'), false);
  assert.equal(s.isKnownEnv('env-4'), false);
  assert.equal(s.isKnownEnv('env-5'), true);
  assert.equal(s.isKnownEnv('env-54'), true);
  const b = reopen(s);
  assert.equal(b.isKnownEnv('env-4'), false);
  assert.equal(b.isKnownEnv('env-54'), true);
});

test('a change moves revision(); the same values again do not, so a poll that changed nothing writes nothing', () => {
  const s = createArcaneStateStore();
  assert.equal(s.revision(), 0);
  s.markKnownEnv('vm-103');
  s.setAgent('pi-1', { downPolls: 1, alerted: false });
  s.addActivity('vm-103', 'a');
  s.setReleaseNotified('v1');
  const before = s.revision();
  assert.equal(before, 4);
  s.markKnownEnv('vm-103');
  s.setAgent('pi-1', { downPolls: 1, alerted: false });
  s.addActivity('vm-103', 'a');
  s.setReleaseNotified('v1');
  assert.equal(s.revision(), before);
});

test('crafted file with __proto__ and constructor env keys is safe and readable', () => {
  const s = fromFile('{"envs":{"__proto__":{"known":true,"agent":{"downPolls":3,"alerted":true},"activities":["a"]},"constructor":{"known":true,"activities":[]}},"release":{"notified":"v1"}}');
  assert.equal(s.isKnownEnv('__proto__'), true);
  assert.equal(s.isKnownEnv('constructor'), true);
  assert.deepEqual(s.getAgent('__proto__'), { downPolls: 3, alerted: true });
  assert.equal(s.hasActivity('__proto__', 'a'), true);
  assert.equal({}.known, undefined);
  assert.equal({}.activities, undefined);
  assert.equal(s.getReleaseNotified(), 'v1');
});

test('wrong-typed file content is sanitised', () => {
  const s = fromFile(JSON.stringify({
    envs: {
      a: { known: 'yes', agent: { downPolls: '5', alerted: 1 }, activities: ['x', 5, null, 'x', 'y', ''] },
      b: { known: true, agent: [1, 2], activities: 'nope' },
      c: { known: true, agent: { downPolls: -1, alerted: true } },
      d: { known: true, agent: { downPolls: 1.5, alerted: true } },
      e: 'junk',
    },
    release: { notified: 42 },
  }));
  assert.equal(s.isKnownEnv('a'), false);
  assert.deepEqual(s.getAgent('a'), { downPolls: 0, alerted: false });
  assert.equal(s.hasActivity('a', 'x'), true);
  assert.equal(s.hasActivity('a', '5'), false);
  assert.equal(s.hasActivity('a', 'null'), false);
  assert.equal(s.getAgent('b'), null);
  assert.equal(s.isKnownEnv('b'), true);
  assert.equal(s.getAgent('c').downPolls, 0);
  assert.equal(s.getAgent('d').downPolls, 0);
  assert.equal(s.isKnownEnv('e'), false);
  assert.equal(s.getReleaseNotified(), null);
  s.addActivity('a', 'z');
  assert.deepEqual(onDisk(s).envs.a.activities, ['x', 'y', 'z']);
});

test('non-string / empty inputs are ignored', () => {
  const s = createArcaneStateStore();
  s.addActivity('e', undefined);
  s.addActivity('e', null);
  s.addActivity('e', 5);
  s.addActivity('e', '');
  s.setReleaseNotified(undefined);
  s.setReleaseNotified('');
  s.setAgent('e', [1]);
  s.setAgent('e', null);
  assert.equal(s.hasActivity('e', 'undefined'), false);
  assert.equal(s.hasActivity('e', 'null'), false);
  assert.equal(s.getReleaseNotified(), null);
  assert.equal(s.getAgent('e'), null);
  s.setAgent('e', { downPolls: '5', alerted: true }); // string count sanitises to 0
  assert.deepEqual(s.getAgent('e'), { downPolls: 0, alerted: true });
});

test('persisted contents have the documented shape (the old arcane-state.json\'s)', () => {
  const s = createArcaneStateStore();
  s.markKnownEnv('vm-103');
  s.setAgent('vm-103', { downPolls: 2, alerted: true });
  s.addActivity('vm-103', 'a1');
  s.setReleaseNotified('v2');
  const j = onDisk(s);
  assert.deepEqual(Object.keys(j), ['envs', 'release', 'order']);
  assert.deepEqual(j.order, ['vm-103']);
  assert.deepEqual(j.envs, { 'vm-103': { known: true, agent: { downPolls: 2, alerted: true }, activities: ['a1'] } });
  assert.deepEqual(j.release, { notified: 'v2' });
});

test('a long activity id round-trips', () => {
  const long = 'x'.repeat(300);
  const s = createArcaneStateStore();
  s.addActivity('e', long);
  assert.equal(s.hasActivity('e', long), true);
  assert.equal(reopen(s).hasActivity('e', long), true);
});

test('exactly 200 activities evict nothing', () => {
  const s = createArcaneStateStore();
  for (let i = 0; i < 200; i++) s.addActivity('e', `id-${i}`);
  assert.equal(s.hasActivity('e', 'id-0'), true);
  s.addActivity('e', 'id-200');
  assert.equal(s.hasActivity('e', 'id-0'), false);
  assert.equal(s.hasActivity('e', 'id-1'), true);
});

test('integer-like names evict in true insertion order and the written env survives', () => {
  const s = createArcaneStateStore();
  s.markKnownEnv('zeta');
  for (let i = 1; i <= 50; i++) s.markKnownEnv(String(i)); // 51 total: evicts 'zeta'
  assert.equal(s.isKnownEnv('zeta'), false);
  assert.equal(s.isKnownEnv('1'), true);
  s.markKnownEnv('51'); // evicts '1', the oldest inserted
  assert.equal(s.isKnownEnv('1'), false);
  assert.equal(s.isKnownEnv('2'), true);
  assert.equal(s.isKnownEnv('51'), true);
  const b = reopen(s);
  assert.equal(b.isKnownEnv('1'), false);
  assert.equal(b.isKnownEnv('2'), true);
  b.markKnownEnv('52'); // order survived the reload: evicts '2'
  assert.equal(b.isKnownEnv('2'), false);
  assert.equal(b.isKnownEnv('3'), true);
  assert.equal(Object.keys(onDisk(b).envs).length, 50);
});

test('pending map round-trips; a file without one loads as "no pending map"', () => {
  const s = createArcaneStateStore();
  s.markKnownEnv('vm-103');
  assert.equal(s.getPending('vm-103'), null, 'never recorded');
  s.setPending('vm-103', new Map([['gitea', '1.22.4'], ['immich-server', 'v1.131.0']]));
  s.setPending('pi-1', new Map());
  const b = reopen(s);
  assert.deepEqual([...b.getPending('vm-103')], [['gitea', '1.22.4'], ['immich-server', 'v1.131.0']]);
  assert.deepEqual([...b.getPending('pi-1')], [], 'an empty map is not "no map"');
  assert.equal(b.getPending('vm-101'), null);
  // A defensive copy: mutating it changes nothing stored.
  b.getPending('vm-103').set('x', 'y');
  assert.equal(b.getPending('vm-103').has('x'), false);

  // An old file (no `pending` key) keeps every other field and has no map.
  const j = onDisk(b);
  delete j.envs['vm-103'].pending;
  const c = fromFile(JSON.stringify(j));
  assert.equal(c.isKnownEnv('vm-103'), true);
  assert.equal(c.getPending('vm-103'), null);
});

test('pending map is sanitised, bounded and prototype-safe', () => {
  const big = {};
  for (let i = 0; i < 600; i++) big[`c-${String(i).padStart(3, '0')}`] = 'v';
  const s = fromFile(JSON.stringify({
    envs: {
      a: { known: true, activities: [], pending: { ok: 'v2', n: 5, z: null, ['x'.repeat(300)]: 'l'.repeat(300) } },
      b: { known: true, activities: [], pending: ['nope'] },
      c: { known: true, activities: [], pending: 'junk' },
      d: { known: true, activities: [], pending: big },
    },
  }).replace('"ok":"v2"', '"__proto__":"p1","ok":"v2"'));
  const a = s.getPending('a');
  assert.deepEqual([...a.keys()].sort(), ['__proto__', 'ok', 'x'.repeat(256)]);
  assert.equal(a.get('x'.repeat(256)), 'l'.repeat(256));
  assert.equal(a.get('__proto__'), 'p1');
  assert.equal({}.p1, undefined);
  assert.equal(s.getPending('b'), null);
  assert.equal(s.getPending('c'), null);
  assert.equal(s.getPending('d').size, 500, 'bounded per environment');
  assert.equal(s.getPending('d').has('c-000'), true, 'keeps the first by name');
  assert.equal(s.getPending('d').has('c-599'), false);

  // Writes are sanitised the same way, and a no-op write is no change.
  s.setPending('e', new Map([['__proto__', 'v1'], ['', 'skip'], ['k', 7], ['ok', 'v']]));
  assert.deepEqual([...s.getPending('e')].sort(), [['__proto__', 'v1'], ['ok', 'v']]);
  assert.equal(Object.prototype.v1, undefined);
  const before = s.revision();
  s.setPending('e', new Map([['ok', 'v'], ['__proto__', 'v1']]));
  assert.equal(s.revision(), before, 'same map: no write');
  assert.deepEqual([...reopen(s).getPending('e')].sort(), [['__proto__', 'v1'], ['ok', 'v']]);
});

test('awaiting runs round-trip; a file without them loads as none', () => {
  const s = createArcaneStateStore();
  const rec = {
    id: 'act-1', batchId: 'run-1', job: 'arcane-update', cronStatus: 'failure',
    error: 'boom', startedMs: 1760000000000, firstSeenMs: 1760000060000,
  };
  assert.deepEqual(s.getAwaiting('vm-103'), []);
  s.setAwaiting('vm-103', [rec]);
  const b = reopen(s);
  assert.deepEqual(b.getAwaiting('vm-103'), [rec]);
  b.getAwaiting('vm-103')[0].id = 'changed';
  assert.equal(b.getAwaiting('vm-103')[0].id, 'act-1', 'a copy');
  b.setAwaiting('vm-103', []);
  const j = onDisk(b);
  assert.equal('awaiting' in j.envs['vm-103'], false, 'left out when empty');
  assert.deepEqual(reopen(b).getAwaiting('vm-103'), []);
});

test('awaiting runs are sanitised and bounded', () => {
  const ok = (i) => ({
    id: `a-${i}`, batchId: '', job: 'arcane-prune', cronStatus: 'success', error: '',
    startedMs: 1000 + i, firstSeenMs: 2000 + i,
  });
  const s = fromFile(JSON.stringify({
    envs: {
      a: {
        known: true,
        activities: [],
        awaiting: [
          ok(1),
          { ...ok(2), job: 'other' },
          { ...ok(3), cronStatus: 'maybe' },
          { ...ok(4), id: '' },
          { ...ok(5), firstSeenMs: 'x' },
          { ...ok(6), startedMs: null },
          { ...ok(7), error: 'e'.repeat(3000), id: 'i'.repeat(300), batchId: 7 },
          'junk',
          null,
        ],
      },
      b: { known: true, activities: [], awaiting: { not: 'a list' } },
      c: { known: true, activities: [], awaiting: Array.from({ length: 70 }, (_, i) => ok(i)) },
    },
  }));
  const a = s.getAwaiting('a');
  assert.deepEqual(a.map((r) => r.id.slice(0, 3)), ['a-1', 'iii']);
  assert.equal(a[1].id.length, 256);
  assert.equal(a[1].error.length, 2048);
  assert.equal(a[1].batchId, '');
  assert.deepEqual(s.getAwaiting('b'), []);
  const c = s.getAwaiting('c');
  assert.equal(c.length, 50, 'bounded per environment');
  assert.equal(c[0].id, 'a-20', 'keeps the newest');
  // No change when nothing changed.
  s.setAwaiting('a', a);
  const before = s.revision();
  s.setAwaiting('a', s.getAwaiting('a'));
  assert.equal(s.revision(), before);
});

test('image checks: silent baseline, then seen ids, kept apart from activities', () => {
  const a = createArcaneStateStore();
  assert.equal(a.isChecksKnown('pi-1'), false);
  a.addCheck('pi-1', 'c0'); // before the baseline: nothing to add to
  assert.equal(a.isChecksKnown('pi-1'), false);
  assert.equal(a.hasCheck('pi-1', 'c0'), false);
  a.baselineChecks('pi-1', ['c1', 'c2', 'c1', '', 5]);
  a.addCheck('pi-1', 'c3');
  a.baselineChecks('vm-101', []);
  const b = reopen(a);
  assert.equal(b.isChecksKnown('pi-1'), true);
  assert.equal(b.isChecksKnown('vm-101'), true, 'an empty baseline still counts');
  for (const id of ['c1', 'c2', 'c3']) assert.equal(b.hasCheck('pi-1', id), true, id);
  assert.equal(b.hasActivity('pi-1', 'c1'), false, 'checks are not activities');
  assert.equal(b.hasCheck('pi-2', 'c1'), false);
  const j = onDisk(b);
  assert.deepEqual(j.envs['pi-1'].checks, ['c1', 'c2', 'c3']);
  assert.deepEqual(j.envs['vm-101'].checks, []);
});

test('image checks: a file without them is not baselined; the list is bounded and sanitised', () => {
  const s = fromFile(JSON.stringify({ envs: {
    'vm-103': { known: true, agent: null, activities: ['a1'] },
    'pi-1': { known: true, agent: null, activities: [], checks: 'nope' },
    'pi-2': { known: true, agent: null, activities: [], checks: [1, '', 'ok', 'ok'] },
  } }));
  assert.equal(s.isKnownEnv('vm-103'), true);
  assert.equal(s.isChecksKnown('vm-103'), false, 'a 2.1.0 state file');
  assert.equal(s.isChecksKnown('pi-1'), false);
  assert.equal(s.isChecksKnown('pi-2'), true);
  assert.equal(s.hasCheck('pi-2', 'ok'), true);
  s.baselineChecks('vm-103', []);
  for (let i = 0; i < 105; i++) s.addCheck('vm-103', `c${i}`);
  assert.equal(s.hasCheck('vm-103', 'c4'), false, 'oldest evicted past 100');
  assert.equal(s.hasCheck('vm-103', 'c5'), true);
  assert.equal(s.hasActivity('vm-103', 'a1'), true, 'activities untouched');
  const j = onDisk(s);
  assert.equal(j.envs['vm-103'].checks.length, 100);
  assert.deepEqual(j.envs['pi-2'].checks, ['ok']);
  assert.equal('checks' in j.envs['pi-1'], false);
});

test('image checks: an unchanged baseline is no change', () => {
  const s = createArcaneStateStore();
  s.baselineChecks('pi-1', ['c1']);
  const before = JSON.stringify(s.toFile());
  const revision = s.revision();
  s.baselineChecks('pi-1', ['c1']);
  s.addCheck('pi-1', 'c1');
  assert.equal(s.revision(), revision);
  assert.equal(JSON.stringify(s.toFile()), before);
});
