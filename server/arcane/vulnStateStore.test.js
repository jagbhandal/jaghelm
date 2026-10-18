// server/arcane/vulnStateStore.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createVulnStateStore, MAX_KEYS } from './vulnStateStore.js';
import { findingKey } from './vulnDerive.js';

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'arcane-vuln-state-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'arcane-vuln-state.json');
}
const e = (repo, id, pkg, sev) => ({ repo, id, pkg, sev });
const keysOf = (...entries) => new Map(entries.map((x) => [findingKey(x.repo, x.id, x.pkg), x]));

test('round-trips environments and the last run through a fresh instance', (t) => {
  const path = tmp(t);
  const a = createVulnStateStore({ path });
  assert.equal(a.getLastRun(), null);
  assert.equal(a.knownCount(), 0);
  a.setEnv('vm-103', {
    keys: keysOf(e('db', 'CVE-2', 'q', 'H'), e('app', 'CVE-1', 'p', 'C')),
    kev: 2,
    atMs: 1000,
  });
  a.setLastRun(5000);
  const b = createVulnStateStore({ path });
  assert.equal(b.isKnown('vm-103'), true);
  assert.equal(b.isKnown('vm-101'), false);
  assert.equal(b.knownCount(), 1);
  assert.equal(b.getLastRun(), 5000);
  const got = b.getEnv('vm-103');
  assert.equal(got.kev, 2);
  assert.equal(got.atMs, 1000);
  // Sorted by key on the way in.
  assert.deepEqual(
    [...got.keys.values()],
    [e('app', 'CVE-1', 'p', 'C'), e('db', 'CVE-2', 'q', 'H')]
  );
  assert.equal(b.getEnv('nope'), null);
});

test('the file has the documented, compact shape', (t) => {
  const path = tmp(t);
  const s = createVulnStateStore({ path });
  s.setEnv('vm-103', { keys: keysOf(e('app', 'CVE-1', 'p', 'C')), kev: null, atMs: 7 });
  s.setLastRun(9);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {
    lastRunMs: 9,
    envs: { 'vm-103': { kev: null, atMs: 7, keys: [['app', 'CVE-1', 'p', 'C']] } },
    order: ['vm-103'],
  });
});

test('a corrupt or wrong-typed file loads as empty', (t) => {
  const path = tmp(t);
  for (const content of ['{not json', '[]', '"x"', '{"envs":[],"lastRunMs":"5"}']) {
    writeFileSync(path, content);
    const s = createVulnStateStore({ path });
    assert.equal(s.knownCount(), 0, content);
    assert.equal(s.getLastRun(), null, content);
  }
});

test('keys are sanitised: bad entries dropped, fields capped, duplicates merged', (t) => {
  const path = tmp(t);
  const long = 'x'.repeat(400);
  writeFileSync(
    path,
    JSON.stringify({
      lastRunMs: -1,
      envs: {
        'vm-103': {
          kev: 1.5,
          atMs: 'x',
          keys: [
            ['app', 'CVE-1', 'p', 'C'],
            ['app', 'CVE-1', 'p', 'H'], // same key again
            ['app', 'CVE-2', 'p', 'M'], // not critical or high
            ['app', '', 'p', 'H'],
            ['app', 'CVE-3', 'p'],
            'app',
            null,
            [long, 'CVE-4', 'p', 'H'],
          ],
        },
      },
    })
  );
  const s = createVulnStateStore({ path });
  assert.equal(s.getLastRun(), null);
  const got = s.getEnv('vm-103');
  assert.equal(got.kev, null);
  assert.equal(got.atMs, null);
  assert.deepEqual(
    [...got.keys.values()].map((x) => [x.repo.length, x.id, x.sev]),
    [
      [3, 'CVE-1', 'C'],
      [256, 'CVE-4', 'H'],
    ]
  );
  // The map is keyed exactly as vulnDerive keys a finding.
  assert.ok(got.keys.has(findingKey('app', 'CVE-1', 'p')));
});

test(`at most MAX_KEYS (${MAX_KEYS}) keys per environment are kept`, (t) => {
  const path = tmp(t);
  const many = Array.from({ length: MAX_KEYS + 5 }, (_, i) =>
    e('app', `CVE-${String(i).padStart(6, '0')}`, 'p', 'H')
  );
  const s = createVulnStateStore({ path });
  s.setEnv('vm-103', { keys: keysOf(...many), kev: 0, atMs: 1 });
  assert.equal(createVulnStateStore({ path }).getEnv('vm-103').keys.size, MAX_KEYS);
});

test('at most 50 environments are kept, oldest-inserted evicted, never the one written', (t) => {
  const path = tmp(t);
  const s = createVulnStateStore({ path });
  for (let i = 0; i < 52; i++) s.setEnv(`env-${i}`, { keys: new Map(), kev: 0, atMs: i });
  const b = createVulnStateStore({ path });
  assert.equal(b.knownCount(), 50);
  assert.equal(b.isKnown('env-0'), false);
  assert.equal(b.isKnown('env-1'), false);
  assert.equal(b.isKnown('env-51'), true);
});

test('__proto__ and constructor as names are plain environments', (t) => {
  const path = tmp(t);
  const s = createVulnStateStore({ path });
  s.setEnv('__proto__', { keys: keysOf(e('a', 'CVE-1', 'p', 'H')), kev: 1, atMs: 1 });
  s.setEnv('constructor', { keys: new Map(), kev: 0, atMs: 1 });
  assert.equal({}.kev, undefined);
  const b = createVulnStateStore({ path });
  assert.equal(b.isKnown('__proto__'), true);
  assert.equal(b.getEnv('__proto__').keys.size, 1);
  assert.equal(b.isKnown('constructor'), true);
  assert.equal(b.isKnown('toString'), false);
});

test('invalid input is ignored; unchanged state is not rewritten', (t) => {
  const path = tmp(t);
  const s = createVulnStateStore({ path });
  s.setEnv('', { keys: new Map(), kev: 0, atMs: 1 });
  s.setEnv('vm-103', null);
  s.setLastRun(-5);
  s.setLastRun(1.5);
  assert.equal(s.knownCount(), 0);
  assert.equal(s.getLastRun(), null);
  s.setEnv('vm-103', { keys: keysOf(e('a', 'CVE-1', 'p', 'H')), kev: 1, atMs: 1 });
  s.setLastRun(10);
  const old = new Date('2020-01-01T00:00:00Z');
  utimesSync(path, old, old);
  s.setEnv('vm-103', { keys: keysOf(e('a', 'CVE-1', 'p', 'H')), kev: 1, atMs: 1 });
  s.setLastRun(10);
  assert.equal(statSync(path).mtimeMs, old.getTime());
});

test('getEnv returns a copy', (t) => {
  const path = tmp(t);
  const s = createVulnStateStore({ path });
  s.setEnv('vm-103', { keys: keysOf(e('a', 'CVE-1', 'p', 'H')), kev: 1, atMs: 1 });
  s.getEnv('vm-103').keys.clear();
  assert.equal(s.getEnv('vm-103').keys.size, 1);
});

test('knownNames lists the digested environments in insertion order', (t) => {
  const path = tmp(t);
  const s = createVulnStateStore({ path });
  assert.deepEqual(s.knownNames(), []);
  s.setEnv('vm-103', { keys: new Map(), kev: 0, atMs: 1 });
  s.setEnv('2', { keys: new Map(), kev: 0, atMs: 1 });
  assert.deepEqual(createVulnStateStore({ path }).knownNames(), ['vm-103', '2']);
});
