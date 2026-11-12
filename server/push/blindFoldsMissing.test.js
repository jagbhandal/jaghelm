/**
 * A node with no container readings folds its Missing containers into the one
 * source warning (D1): they are unknown, not missing, so no Missing row is
 * drawn and no container_missing is pushed for them. When the readings return
 * the normal Missing logic resumes. Another node is never affected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cachesOf, pushPipeline } from '../testing/pushPipeline.js';
import { card, inputs, missing, node, once, UPS_ONLINE } from '../testing/statusFixtures.js';

const START = 1_782_345_600_000;
const HOUR = 3_600_000;
const OK = { prometheus: { ok: true }, kuma: { ok: true } };
const read = (extra = {}) => ({ state: 'ok', events: [], blindNodes: [], silentNodes: [], oomCounter: true, ...extra });
const NODES = (t = START) => ({
  apps: node({}, { display_name: 'Apps', services: [missing('apps:web', t - HOUR), missing('apps:db', t - HOUR), card('apps:up')] }),
  pi: node({}, { display_name: 'Pi', services: [missing('pi:dns', t - HOUR)] }),
});
const rows = (status) => status.issues.filter((i) => i.word === 'Missing');
const sourceOf = (status) => status.issues.find((i) => i.id === 'sources/containers-source:apps');

test('model: a blind node is one warning and no Missing rows; the other node still shows its own', () => {
  const status = once(inputs({ nodes: NODES(), containerEvents: read({ silentNodes: ['apps'] }) }));
  assert.deepEqual(rows(status).map((i) => i.id), ['services/pi:dns']);
  // Kept as unknown "Not checked" entities, left out of the issues.
  for (const id of ['services/apps:web', 'services/apps:db']) {
    const e = status.entities.find((x) => x.id === id);
    assert.equal(e.word, 'Not checked');
    assert.equal(e.state, 'unknown');
  }
  assert.equal(status.entities.find((e) => e.id === 'services/apps:up').state, 'ok');
  assert.equal(
    sourceOf(status).reason,
    'No container readings, so container alerts for Apps are blind (2 containers not checked)'
  );
});

test('model: after the readings return the Missing rows are back, as before', () => {
  const status = once(inputs({ nodes: NODES(), containerEvents: read() }));
  assert.deepEqual(rows(status).map((i) => i.id).sort(), ['services/apps:db', 'services/apps:web', 'services/pi:dns']);
  assert.equal(sourceOf(status), undefined);
});

test('push: a blind node pages its source once and never container_missing; recovery resumes the Missing page for what is really gone', async () => {
  const p = pushPipeline({ start: START });
  const board = (containerEvents) =>
    cachesOf({ services: { sources: OK, nodes: NODES(p.now) }, ups: UPS_ONLINE, containerEvents });
  const sent = () => p.sent.filter((s) => s.startsWith('container_') || s.includes('containers-source'));
  try {
    for (let i = 0; i < 30; i += 1) await p.cycle(board(read({ silentNodes: ['apps'] }))); // 15 min, past the 10 min hold
    assert.deepEqual(sent().sort(), ['container_missing pi:dns', 'source_down containers-source:apps']);
    await p.cycle(board(read()));
    assert.ok(sent().includes('container_missing apps:web'), 'really missing once readings return');
  } finally {
    p.close();
  }
});

test('push: a container already paged Missing is held through the blind spell, not paged again when readings return', async () => {
  const p = pushPipeline({ start: START });
  const board = (containerEvents) =>
    cachesOf({ services: { sources: OK, nodes: NODES(p.now) }, ups: UPS_ONLINE, containerEvents });
  const pages = () => p.sent.filter((s) => s === 'container_missing apps:web');
  try {
    for (let i = 0; i < 4; i += 1) await p.cycle(board(read()));
    assert.equal(pages().length, 1);
    for (let i = 0; i < 6; i += 1) await p.cycle(board(read({ silentNodes: ['apps'] })));
    assert.equal(p.snapshot.prev().missing['apps:web'], 'warn', 'held while blind');
    await p.cycle(board(read()));
    await p.cycle(board(read()));
    assert.equal(pages().length, 1, 'no second page');
  } finally {
    p.close();
  }
});

test('push: a JagHelm restart while blind past the hour (the model has forgotten the node) pages no container_missing', async () => {
  const p = pushPipeline({ start: START });
  const board = (containerEvents) =>
    cachesOf({ services: { sources: OK, nodes: NODES(p.now) }, ups: UPS_ONLINE, containerEvents });
  try {
    for (let i = 0; i < 4; i += 1) await p.cycle(board(read({ silentNodes: ['apps'] })));
    p.restart();
    for (let i = 0; i < 30; i += 1) await p.cycle(board(read({ blindNodes: ['apps'] })));
    assert.deepEqual(
      p.sent.filter((s) => s.includes('apps')),
      ['source_down containers-source:apps']
    );
  } finally {
    p.close();
  }
});
