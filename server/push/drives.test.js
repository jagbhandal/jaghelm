/**
 * Drive health through the real model and the real push cycle (drive-health
 * design §6; testing/pushPipeline.js, as refresh.js wires them): a drive
 * alerts on its own key, a second failing drive pushes independently, a
 * drive's words are "<device> on <node>", and a node that goes blind to its
 * drives is one source alert, in its own words, that recovers by itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cachesOf, pushPipeline } from '../testing/pushPipeline.js';
import { entityOf } from './entity.js';
import { node, UPS_ONLINE } from '../testing/statusFixtures.js';

const OK = { prometheus: { ok: true }, kuma: { ok: true } };
const zero = { count: 0, grew: false };

const hdd = (device, over = {}) => ({
  device,
  model: 'ST8000VN004',
  type: 'hdd',
  smartPassed: true,
  criticalWarning: null,
  availableSpare: null,
  spareThreshold: null,
  percentageUsed: null,
  temperature: 40,
  powerOnSeconds: 1,
  exitStatus: 0,
  mediaErrors: null,
  sectors: { reallocated: zero, pending: zero, uncorrectable: zero },
  ...over,
});
const failed = (device) => hdd(device, { smartPassed: false });
const warn = (device) => hdd(device, { sectors: { reallocated: { count: 3, grew: true }, pending: zero, uncorrectable: zero } });

/** The caches of one cycle: node `nas` and its drives read (`drives`: a list, or a whole read). */
function cycle(drives, { nodes = { nas: node() } } = {}) {
  const read =
    drives === null || !Array.isArray(drives)
      ? drives
      : { enabled: true, nodes: { nas: { devices: drives.length, scrapeUp: true, drives } } };
  return cachesOf({ services: { sources: OK, nodes }, ups: UPS_ONLINE, drives: read });
}

/** What a cycle sent: the events' type, id, title and body. */
async function play(p, caches, opts) {
  const before = p.events.length;
  await p.cycle(caches, opts);
  return p.events.slice(before).map((e) => ({ type: e.type, id: e.id, title: e.title, body: e.body, severity: e.severity }));
}

test('a drive failing its health check is a critical alert of its own, in its own words', async () => {
  const p = pushPipeline();
  try {
    assert.deepEqual(await play(p, cycle([hdd('sda'), hdd('sdb')])), []);
    const sent = await play(p, cycle([hdd('sda'), failed('sdb')]));
    assert.deepEqual(sent, [
      {
        type: 'host_threshold',
        id: 'nas:drive:nas:sdb',
        title: 'Drive sdb critical',
        body: 'sdb on nas · drive sdb failed its health check',
        severity: 'critical',
      },
    ]);
    // Steady: nothing more.
    assert.deepEqual(await play(p, cycle([hdd('sda'), failed('sdb')])), []);
  } finally {
    p.close();
  }
});

test('a second failing drive pushes independently, and one drive’s recovery does not mask the other', async () => {
  const p = pushPipeline();
  try {
    await play(p, cycle([hdd('sda'), hdd('sdb'), hdd('sdc')]));
    assert.deepEqual((await play(p, cycle([failed('sda'), hdd('sdb'), hdd('sdc')]))).map((e) => e.id), ['nas:drive:nas:sda']);
    // A second drive fails while the first still does: its own alert.
    const second = await play(p, cycle([failed('sda'), warn('sdb'), hdd('sdc')]));
    assert.deepEqual(second.map((e) => [e.id, e.severity]), [['nas:drive:nas:sdb', 'warning']]);
    assert.equal(second[0].title, 'Drive sdb warning');
    assert.match(second[0].body, /^sdb on nas · drive sdb has 3 reallocated sectors \(grew in the last 7 days\)$/);
    // The first recovers: its clear, and the second is untouched.
    const cleared = await play(p, cycle([hdd('sda'), warn('sdb'), hdd('sdc')]));
    assert.deepEqual(cleared.map((e) => [e.type, e.id, e.title]), [
      ['host_threshold_cleared', 'nas:drive:nas:sda', 'Drive sda normal'],
    ]);
    assert.equal(p.status.entities.find((e) => e.id === 'nodes/nas').state, 'warn');
    // And the second's clear arrives on its own.
    assert.deepEqual((await play(p, cycle([hdd('sda'), hdd('sdb'), hdd('sdc')]))).map((e) => e.id), ['nas:drive:nas:sdb']);
  } finally {
    p.close();
  }
});

test('a drive’s alert is not the node’s: a hot disk and a failing drive page separately', async () => {
  const p = pushPipeline();
  try {
    await play(p, cycle([hdd('sda')]));
    const sent = await play(p, cycle([failed('sda')], { nodes: { nas: node({ diskPercent: '96.0' }) } }));
    assert.deepEqual(sent.map((e) => e.id).sort(), ['nas:disk', 'nas:drive:nas:sda']);
  } finally {
    p.close();
  }
});

test('a restart keeps a held drive level: no repeat alert, no false clear', async () => {
  const p = pushPipeline();
  try {
    await play(p, cycle([hdd('sda', { temperature: 40 })]));
    assert.equal((await play(p, cycle([hdd('sda', { temperature: 56 })]))).length, 1);
    p.restart();
    // Inside the band (warn until below 50): still warn after the restart, nothing sent.
    assert.deepEqual(await play(p, cycle([hdd('sda', { temperature: 52 })])), []);
    assert.equal(p.status.entities.find((e) => e.id === 'nodes/nas').conditions['drive:nas:sda'], 'warn');
    const cleared = await play(p, cycle([hdd('sda', { temperature: 49 })]));
    assert.deepEqual(cleared.map((e) => e.type), ['host_threshold_cleared']);
  } finally {
    p.close();
  }
});

test('a missed read neither ends an episode nor starts one', async () => {
  const p = pushPipeline();
  try {
    await play(p, cycle([failed('sda')]));
    assert.deepEqual(await play(p, cycle(null)), [], 'the read failed');
    assert.deepEqual(await play(p, cycle(null)), []);
    assert.deepEqual(await play(p, cycle([failed('sda')])), [], 'and it is the same episode');
  } finally {
    p.close();
  }
});

// ── Blind ────────────────────────────────────────────────────────────────

test('a node blind to its drives pages once, in the unknown state, and recovers by itself', async () => {
  const p = pushPipeline();
  try {
    await play(p, cycle([hdd('sda')]));
    const gone = { enabled: true, nodes: {} };
    // The first blind cycle is a source failing; the second is down, and sends.
    assert.deepEqual(await play(p, cycle(gone)), []);
    const sent = await play(p, cycle(gone));
    assert.deepEqual(sent, [
      {
        type: 'source_down',
        id: 'drives-source:nas',
        title: 'Drive monitoring has no signal',
        body: 'Drive monitoring has no signal on Node',
        severity: 'warning',
      },
    ]);
    const nas = p.status.entities.find((e) => e.id === 'nodes/nas');
    assert.equal(nas.state, 'ok', 'the node is not amber');
    assert.equal(p.status.issues.find((i) => i.id === 'sources/drives-source:nas').state, 'unknown');
    // Still blind: nothing more.
    assert.deepEqual(await play(p, cycle(gone)), []);
    // The drives are back.
    const back = await play(p, cycle([hdd('sda')]));
    assert.deepEqual(back.map((e) => [e.type, e.id, e.title, e.body, e.severity]), [
      ['source_recovered', 'drives-source:nas', 'Drive monitoring recovered', 'Drive monitoring is reporting again on nas', 'info'],
    ]);
  } finally {
    p.close();
  }
});

test('one blind cycle sends nothing', async () => {
  const p = pushPipeline();
  try {
    await play(p, cycle([hdd('sda')]));
    assert.deepEqual(await play(p, cycle({ enabled: true, nodes: {} })), []);
    assert.deepEqual(await play(p, cycle([hdd('sda')])), []);
  } finally {
    p.close();
  }
});

test('blind does not clear a failed drive’s episode', async () => {
  const p = pushPipeline();
  try {
    await play(p, cycle([failed('sda')]));
    const gone = { enabled: true, nodes: {} };
    await play(p, cycle(gone));
    const sent = await play(p, cycle(gone));
    assert.deepEqual(sent.map((e) => e.type), ['source_down']);
    const back = await play(p, cycle([failed('sda')]));
    assert.deepEqual(back.map((e) => e.type), ['source_recovered'], 'the drive is still failed: no second page');
  } finally {
    p.close();
  }
});

test('a node that never had drive data pages nothing, with the module off, empty or unread', async () => {
  const p = pushPipeline();
  try {
    for (const drives of [null, { enabled: false }, { enabled: true, nodes: {} }]) {
      for (let i = 0; i < 3; i++) assert.deepEqual(await play(p, cycle(drives)), []);
    }
  } finally {
    p.close();
  }
});

test('the module turned off clears what it had paged, once', async () => {
  const p = pushPipeline();
  try {
    await play(p, cycle([failed('sda')]));
    const sent = await play(p, cycle({ enabled: false }));
    assert.deepEqual(sent.map((e) => [e.type, e.id]), [['host_threshold_cleared', 'nas:drive:nas:sda']]);
  } finally {
    p.close();
  }
});

test('a tap opens the node for a drive and the source for a blind node, and Snooze keys follow the episode', async () => {
  const p = pushPipeline();
  try {
    await play(p, cycle([hdd('sda')]));
    await play(p, cycle([failed('sda')]));
    const gone = { enabled: true, nodes: {} };
    await play(p, cycle(gone));
    await play(p, cycle(gone));
    const by = Object.fromEntries(p.events.map((e) => [e.type, entityOf(e)]));
    assert.equal(by.host_threshold, 'nodes/nas');
    assert.equal(by.source_down, 'sources/drives-source:nas');
  } finally {
    p.close();
  }
});
