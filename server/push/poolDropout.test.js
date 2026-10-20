/**
 * #468: a Proxmox storage pool whose read fails holds its level, as #462 holds
 * a reading with no value. A failed fetch used to leave the node with no pool
 * list, so every pool dropped out of the model for that cycle: a pool over its
 * line lost its level, and when the fetch came back with the pool inside its
 * hysteresis band the model sent a false clear, then paged again once it
 * crossed. Now a pool's episode ends only when a fetch that succeeded no
 * longer lists it.
 *
 * These run the real model and the real push cycle over a snapshot file
 * (testing/pushPipeline.js, as refresh.js wires them), cycle by cycle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { cachesOf, pushPipeline } from '../testing/pushPipeline.js';
import { node, UPS_ONLINE } from '../testing/statusFixtures.js';

const OK = { prometheus: { ok: true }, kuma: { ok: true } };
const KEY = 'pool:local-lvm';
const SENT_THRESHOLD = `host_threshold pve:${KEY}`;
const SENT_CLEARED = `host_threshold_cleared pve:${KEY}`;

/** A pool as the Proxmox preset lists it, `percent` full of 100 GB. */
const pool = (percent, extra = {}) => ({
  name: 'local-lvm',
  type: 'lvmthin',
  usedGB: percent.toFixed(1),
  totalGB: '100.0',
  percent,
  status: 'available',
  ...extra,
});

/** A pool with no size: storage Proxmox lists but can't read (inactive), at 0. */
const INACTIVE = pool(0, { usedGB: '0.0', totalGB: '0.0', status: 'unknown' });

/** The integrations payload after a Proxmox fetch that succeeded, listing `pools`. */
const listed = (pools) => ({
  proxmox: {
    Running: '2/2',
    _vms: [],
    _storagePools: pools,
    _target: 'pve:pve',
    _preset: 'proxmox',
    _status: { state: 'ok', since: 0, failures: 0, nextAttemptAt: null },
  },
});

// The ways a Proxmox read fails, as the integrations refresh leaves them.
const FAILURES = {
  'the fetch failed (_error)': {
    proxmox: {
      _error: 'HTTP 500 Internal Server Error',
      _target: 'pve:pve',
      _preset: 'proxmox',
      _status: { state: 'backing_off', since: 0, failures: 1, nextAttemptAt: 0 },
    },
  },
  'the integrations refresh left no payload': null,
  'the storage read failed (no pool list)': {
    proxmox: {
      Running: '2/2',
      _vms: [],
      _target: 'pve:pve',
      _preset: 'proxmox',
      _status: { state: 'ok', since: 0, failures: 0, nextAttemptAt: null },
    },
  },
  'the fetch threw before it was known as Proxmox': {
    proxmox: { _error: 'boom', _status: { state: 'backing_off', since: 0, failures: 1 } },
  },
};

/** One cycle's caches: node pve, calm, with `integrations` as the refresh left them. */
function board(integrations) {
  return cachesOf({
    services: { sources: OK, nodes: { pve: node({}, { display_name: 'pve' }) } },
    ups: UPS_ONLINE,
    integrations,
  });
}

/** The cycles a value stands for: a pool percent, a failure's name, or a payload. */
function cachesFor(step) {
  if (typeof step === 'number') return board(listed([pool(step)]));
  if (typeof step === 'string') return board(FAILURES[step]);
  return board(step);
}

/** Runs `steps` through `p`; returns what each cycle sent, and the pve node each cycle. */
async function play(steps, p) {
  const sent = [];
  const nodes = [];
  for (const step of steps) {
    if (step === 'restart') {
      p.restart();
      continue;
    }
    const before = p.sent.length;
    const status = await p.cycle(cachesFor(step));
    sent.push(p.sent.slice(before));
    nodes.push(status.entities.find((e) => e.id === 'nodes/pve'));
  }
  return { sent, nodes };
}

/** The pool's level in the snapshot file, or undefined when it has none. */
const filed = (p) => JSON.parse(readFileSync(p.path, 'utf8')).hosts.pve.levels[KEY];

for (const failure of Object.keys(FAILURES)) {
  test(`#468: pool at warn, ${failure}, back inside the band: no clear, no re-page`, async () => {
    const p = pushPipeline();
    try {
      const { sent, nodes } = await play([50, 93, failure, failure, 88, 93, 80], p);
      assert.deepEqual(sent, [
        [], // the baseline
        [SENT_THRESHOLD],
        [], // the read failed: held at warn
        [],
        [], // back inside the band: still warn (was: host_threshold_cleared)
        [], // over the line again: the same episode (was: a second host_threshold)
        [SENT_CLEARED], // below 85 %: it ends
      ]);
      // The model holds it too: the node stays warn, one episode, and claims no number.
      assert.deepEqual(
        nodes.slice(1, 6).map((n) => [n.state, n.conditions[KEY], n.since]),
        [
          ['warn', 'warn', nodes[1].since],
          ['warn', 'unknown', nodes[1].since],
          ['warn', 'unknown', nodes[1].since],
          ['warn', 'warn', nodes[1].since],
          ['warn', 'warn', nodes[1].since],
        ]
      );
      assert.equal(
        nodes[2].reason,
        'Storage pool local-lvm: no reading (warning held until below 85 %)'
      );
      assert.equal(nodes[2].metric, undefined, 'no metric: there is no reading');
      assert.equal(nodes[6].state, 'ok');
    } finally {
      p.close();
    }
  });

  test(`#468: pool at warn, ${failure}, JagHelm restarts, back inside the band: nothing is sent`, async () => {
    const p = pushPipeline();
    try {
      const { sent, nodes } = await play(
        [50, 93, failure, 'restart', failure, 88, 'restart', 93, 80],
        p
      );
      assert.deepEqual(sent, [[], [SENT_THRESHOLD], [], [], [], [], [SENT_CLEARED]]);
      assert.deepEqual(
        nodes.slice(2, 5).map((n) => n.state),
        ['warn', 'warn', 'warn'],
        'held at warn on both sides of the restart'
      );
    } finally {
      p.close();
    }
  });
}

test('#468: the snapshot holds what the model holds while the read fails', async () => {
  const p = pushPipeline();
  try {
    await play([50, 97, 'the fetch failed (_error)'], p);
    assert.equal(filed(p), 'crit');
    p.restart();
    const { sent, nodes } = await play(['the integrations refresh left no payload', 92], p);
    assert.equal(filed(p), 'crit', 'inside crit’s band after the restart: still crit');
    assert.deepEqual(sent, [[], []]);
    assert.deepEqual(
      nodes.map((n) => n.state),
      ['crit', 'crit']
    );
  } finally {
    p.close();
  }
});

// ── A pool that a read no longer lists ───────────────────────────────────

test('#468: a fetch that succeeds and no longer lists a pool at warn ends its episode: one clear', async () => {
  const p = pushPipeline();
  try {
    const gone = listed([pool(40, { name: 'tank' })]);
    const { sent, nodes } = await play([50, 93, gone, gone, 88, 93], p);
    assert.deepEqual(sent, [
      [],
      [SENT_THRESHOLD],
      [SENT_CLEARED], // gone from a read that succeeded: its episode ends
      [],
      [], // listed again inside the old band: new, and ok (#448)
      [SENT_THRESHOLD], // over its line: a new episode
    ]);
    assert.deepEqual(
      [nodes[2].state, nodes[2].reason, Object.hasOwn(nodes[2].conditions, KEY)],
      ['ok', 'Healthy', false]
    );
    assert.equal(p.events[1].severity, 'info');
  } finally {
    p.close();
  }
});

test('#468: a pool gone at crit sends one clear; one gone at ok sends nothing', async () => {
  const crit = pushPipeline();
  try {
    const { sent } = await play([50, 97, listed([]), listed([])], crit);
    assert.deepEqual(sent, [[], [`${SENT_THRESHOLD}`], [SENT_CLEARED], []]);
    assert.equal(crit.events[0].severity, 'critical');
  } finally {
    crit.close();
  }
  const calm = pushPipeline();
  try {
    const { sent } = await play([50, listed([]), 93], calm);
    assert.deepEqual(sent, [[], [], [SENT_THRESHOLD]]);
  } finally {
    calm.close();
  }
});

test('#468: a pool gone while JagHelm was stopped ends on the first read that succeeds', async () => {
  const p = pushPipeline();
  try {
    await play([50, 93, 'the fetch failed (_error)'], p);
    p.restart();
    const { sent } = await play(['the fetch failed (_error)', listed([]), listed([])], p);
    assert.deepEqual(sent, [[], [SENT_CLEARED], []]);
    assert.equal(filed(p), undefined, 'it leaves the snapshot');
  } finally {
    p.close();
  }
});

// ── An inactive pool (no size) ───────────────────────────────────────────

test('#468: an inactive pool never reads as 0 % and never clears a held level', async () => {
  const p = pushPipeline();
  try {
    const inactive = listed([INACTIVE]);
    const { sent, nodes } = await play([50, 93, inactive, inactive, inactive, 88, 80], p);
    assert.deepEqual(sent, [[], [SENT_THRESHOLD], [], [], [], [], [SENT_CLEARED]]);
    assert.deepEqual(
      [nodes[2].state, nodes[2].reason, nodes[2].conditions[KEY]],
      ['warn', 'Storage pool local-lvm: no reading (warning held until below 85 %)', 'unknown']
    );
    assert.equal(filed(p), 'ok');
  } finally {
    p.close();
  }
});

test('#468: an inactive pool with no level held is left out: no 0 %, nothing sent', async () => {
  const p = pushPipeline();
  try {
    const { sent, nodes } = await play([listed([INACTIVE]), listed([INACTIVE])], p);
    assert.deepEqual(sent, [[], []]);
    assert.equal(Object.hasOwn(nodes[0].conditions, KEY), false, 'no condition: nothing to colour');
    assert.equal(nodes[0].state, 'ok');
  } finally {
    p.close();
  }
});
