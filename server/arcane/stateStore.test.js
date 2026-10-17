// server/arcane/stateStore.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createArcaneStateStore } from './stateStore.js';

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'arcane-state-'));
  return { path: join(dir, 'arcane-state.json'), dir };
}

test('round-trips through a fresh instance', () => {
  const { path, dir } = tmp();
  try {
    const a = createArcaneStateStore({ path });
    a.markKnownEnv('vm-103');
    a.setAgent('pi-1', { downPolls: 2, alerted: true });
    a.addActivity('vm-103', 'act-1');
    a.setReleaseNotified('v2.17.0');
    const b = createArcaneStateStore({ path });
    assert.equal(b.isKnownEnv('vm-103'), true);
    assert.equal(b.isKnownEnv('vm-101'), false);
    assert.deepEqual(b.getAgent('pi-1'), { downPolls: 2, alerted: true });
    assert.equal(b.getAgent('nope'), null);
    assert.equal(b.hasActivity('vm-103', 'act-1'), true);
    assert.equal(b.hasActivity('vm-103', 'act-2'), false);
    assert.equal(b.getReleaseNotified(), 'v2.17.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt file loads as empty', () => {
  const { path, dir } = tmp();
  try {
    writeFileSync(path, '{not json');
    const s = createArcaneStateStore({ path });
    assert.equal(s.isKnownEnv('x'), false);
    assert.equal(s.getReleaseNotified(), null);
    s.markKnownEnv('x');
    assert.equal(createArcaneStateStore({ path }).isKnownEnv('x'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('__proto__ as a name does not pollute Object.prototype', () => {
  const { path, dir } = tmp();
  try {
    const s = createArcaneStateStore({ path });
    s.markKnownEnv('__proto__');
    s.setAgent('__proto__', { downPolls: 1, alerted: false });
    s.addActivity('__proto__', 'a');
    assert.equal({}.known, undefined);
    assert.equal({}.agent, undefined);
    assert.equal(Object.prototype.known, undefined);
    const b = createArcaneStateStore({ path });
    assert.equal(b.isKnownEnv('__proto__'), true);
    assert.equal(b.hasActivity('__proto__', 'a'), true);
    assert.equal(createArcaneStateStore({ path: join(dir, 'none.json') }).isKnownEnv('toString'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the 201st activity id evicts the oldest', () => {
  const { path, dir } = tmp();
  try {
    const s = createArcaneStateStore({ path });
    for (let i = 0; i < 201; i++) s.addActivity('vm-103', `id-${i}`);
    assert.equal(s.hasActivity('vm-103', 'id-0'), false);
    assert.equal(s.hasActivity('vm-103', 'id-1'), true);
    assert.equal(s.hasActivity('vm-103', 'id-200'), true);
    const b = createArcaneStateStore({ path });
    assert.equal(b.hasActivity('vm-103', 'id-0'), false);
    assert.equal(b.hasActivity('vm-103', 'id-200'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('at most 50 environments are kept', () => {
  const { path, dir } = tmp();
  try {
    const s = createArcaneStateStore({ path });
    for (let i = 0; i < 55; i++) s.markKnownEnv(`env-${i}`);
    assert.equal(s.isKnownEnv('env-0'), false);
    assert.equal(s.isKnownEnv('env-4'), false);
    assert.equal(s.isKnownEnv('env-5'), true);
    assert.equal(s.isKnownEnv('env-54'), true);
    const b = createArcaneStateStore({ path });
    assert.equal(b.isKnownEnv('env-4'), false);
    assert.equal(b.isKnownEnv('env-54'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no write happens when nothing changed', () => {
  const { path, dir } = tmp();
  try {
    const s = createArcaneStateStore({ path });
    s.markKnownEnv('vm-103');
    s.setAgent('pi-1', { downPolls: 1, alerted: false });
    s.addActivity('vm-103', 'a');
    s.setReleaseNotified('v1');
    const old = new Date(2020, 0, 1);
    utimesSync(path, old, old);
    const before = statSync(path).mtimeMs;
    s.markKnownEnv('vm-103');
    s.setAgent('pi-1', { downPolls: 1, alerted: false });
    s.addActivity('vm-103', 'a');
    s.setReleaseNotified('v1');
    assert.equal(statSync(path).mtimeMs, before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('crafted file with __proto__ and constructor env keys is safe and readable', () => {
  const { path, dir } = tmp();
  try {
    writeFileSync(path, '{"envs":{"__proto__":{"known":true,"agent":{"downPolls":3,"alerted":true},"activities":["a"]},"constructor":{"known":true,"activities":[]}},"release":{"notified":"v1"}}');
    const s = createArcaneStateStore({ path });
    assert.equal(s.isKnownEnv('__proto__'), true);
    assert.equal(s.isKnownEnv('constructor'), true);
    assert.deepEqual(s.getAgent('__proto__'), { downPolls: 3, alerted: true });
    assert.equal(s.hasActivity('__proto__', 'a'), true);
    assert.equal({}.known, undefined);
    assert.equal({}.activities, undefined);
    assert.equal(s.getReleaseNotified(), 'v1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('wrong-typed file content is sanitised', () => {
  const { path, dir } = tmp();
  try {
    writeFileSync(path, JSON.stringify({
      envs: {
        a: { known: 'yes', agent: { downPolls: '5', alerted: 1 }, activities: ['x', 5, null, 'x', 'y', ''] },
        b: { known: true, agent: [1, 2], activities: 'nope' },
        c: { known: true, agent: { downPolls: -1, alerted: true } },
        d: { known: true, agent: { downPolls: 1.5, alerted: true } },
        e: 'junk',
      },
      release: { notified: 42 },
    }));
    const s = createArcaneStateStore({ path });
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
    const onDisk = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(onDisk.envs.a.activities, ['x', 'y', 'z']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('non-string / empty inputs are ignored', () => {
  const { path, dir } = tmp();
  try {
    const s = createArcaneStateStore({ path });
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('persisted file contents have the documented shape', () => {
  const { path, dir } = tmp();
  try {
    const s = createArcaneStateStore({ path });
    s.markKnownEnv('vm-103');
    s.setAgent('vm-103', { downPolls: 2, alerted: true });
    s.addActivity('vm-103', 'a1');
    s.setReleaseNotified('v2');
    const j = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(j.envs, { 'vm-103': { known: true, agent: { downPolls: 2, alerted: true }, activities: ['a1'] } });
    assert.deepEqual(j.release, { notified: 'v2' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a long activity id round-trips', () => {
  const { path, dir } = tmp();
  try {
    const long = 'x'.repeat(300);
    const s = createArcaneStateStore({ path });
    s.addActivity('e', long);
    assert.equal(s.hasActivity('e', long), true);
    assert.equal(createArcaneStateStore({ path }).hasActivity('e', long), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exactly 200 activities evict nothing', () => {
  const { path, dir } = tmp();
  try {
    const s = createArcaneStateStore({ path });
    for (let i = 0; i < 200; i++) s.addActivity('e', `id-${i}`);
    assert.equal(s.hasActivity('e', 'id-0'), true);
    s.addActivity('e', 'id-200');
    assert.equal(s.hasActivity('e', 'id-0'), false);
    assert.equal(s.hasActivity('e', 'id-1'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('integer-like names evict in true insertion order and the written env survives', () => {
  const { path, dir } = tmp();
  try {
    const s = createArcaneStateStore({ path });
    s.markKnownEnv('zeta');
    for (let i = 1; i <= 50; i++) s.markKnownEnv(String(i)); // 51 total: evicts 'zeta'
    assert.equal(s.isKnownEnv('zeta'), false);
    assert.equal(s.isKnownEnv('1'), true);
    s.markKnownEnv('51'); // evicts '1', the oldest inserted
    assert.equal(s.isKnownEnv('1'), false);
    assert.equal(s.isKnownEnv('2'), true);
    assert.equal(s.isKnownEnv('51'), true);
    const b = createArcaneStateStore({ path });
    assert.equal(b.isKnownEnv('1'), false);
    assert.equal(b.isKnownEnv('2'), true);
    b.markKnownEnv('52'); // order survived the reload: evicts '2'
    assert.equal(b.isKnownEnv('2'), false);
    assert.equal(b.isKnownEnv('3'), true);
    assert.equal(Object.keys(JSON.parse(readFileSync(path, 'utf8')).envs).length, 50);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pending map round-trips; a file without one loads as "no pending map"', () => {
  const { path, dir } = tmp();
  try {
    const s = createArcaneStateStore({ path });
    s.markKnownEnv('vm-103');
    assert.equal(s.getPending('vm-103'), null, 'never recorded');
    s.setPending('vm-103', new Map([['gitea', '1.22.4'], ['immich-server', 'v1.131.0']]));
    s.setPending('pi-1', new Map());
    const b = createArcaneStateStore({ path });
    assert.deepEqual([...b.getPending('vm-103')], [['gitea', '1.22.4'], ['immich-server', 'v1.131.0']]);
    assert.deepEqual([...b.getPending('pi-1')], [], 'an empty map is not "no map"');
    assert.equal(b.getPending('vm-101'), null);
    // A defensive copy: mutating it changes nothing stored.
    b.getPending('vm-103').set('x', 'y');
    assert.equal(b.getPending('vm-103').has('x'), false);

    // An old file (no `pending` key) keeps every other field and has no map.
    const j = JSON.parse(readFileSync(path, 'utf8'));
    delete j.envs['vm-103'].pending;
    writeFileSync(path, JSON.stringify(j));
    const c = createArcaneStateStore({ path });
    assert.equal(c.isKnownEnv('vm-103'), true);
    assert.equal(c.getPending('vm-103'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pending map is sanitised, bounded and prototype-safe', () => {
  const { path, dir } = tmp();
  try {
    const big = {};
    for (let i = 0; i < 600; i++) big[`c-${String(i).padStart(3, '0')}`] = 'v';
    writeFileSync(path, JSON.stringify({
      envs: {
        a: { known: true, activities: [], pending: { ok: 'v2', n: 5, z: null, ['x'.repeat(300)]: 'l'.repeat(300) } },
        b: { known: true, activities: [], pending: ['nope'] },
        c: { known: true, activities: [], pending: 'junk' },
        d: { known: true, activities: [], pending: big },
      },
    }).replace('"ok":"v2"', '"__proto__":"p1","ok":"v2"'));
    const s = createArcaneStateStore({ path });
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

    // Writes are sanitised the same way, and a no-op write does not touch the file.
    s.setPending('e', new Map([['__proto__', 'v1'], ['', 'skip'], ['k', 7], ['ok', 'v']]));
    assert.deepEqual([...s.getPending('e')].sort(), [['__proto__', 'v1'], ['ok', 'v']]);
    assert.equal(Object.prototype.v1, undefined);
    const old = new Date(2020, 0, 1);
    utimesSync(path, old, old);
    const before = statSync(path).mtimeMs;
    s.setPending('e', new Map([['ok', 'v'], ['__proto__', 'v1']]));
    assert.equal(statSync(path).mtimeMs, before, 'same map: no write');
    assert.deepEqual([...createArcaneStateStore({ path }).getPending('e')].sort(), [['__proto__', 'v1'], ['ok', 'v']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
