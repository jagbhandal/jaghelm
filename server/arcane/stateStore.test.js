// server/arcane/stateStore.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, statSync, utimesSync } from 'fs';
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
