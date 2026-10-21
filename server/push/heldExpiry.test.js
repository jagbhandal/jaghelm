/**
 * #469: a held reading that never returns ends after 24 h, in the status model
 * and in push's snapshot on the same cycle.
 *
 * Since #462 a reading with no value holds its level, and since #468 so does a
 * storage pool whose Proxmox read failed. Before this, nothing ended such a
 * hold but the reading being read again or its node leaving services.yaml, so
 * a sensor removed while over its line kept its node at warn for good. Now a
 * hold lasts 24 h from its first cycle. The snapshot keeps when it began
 * (`heldSince`), so a restart doesn't restart the clock, and the model and the
 * snapshot forget the reading on the same cycle, silently: nothing was read,
 * so there is nothing to clear. Back over its line after that, it is new.
 *
 * These run the real model and the real push cycle over a snapshot file
 * (testing/pushPipeline.js, as refresh.js wires them), on the pipeline's clock.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import { CYCLE_MS, cachesOf, pushPipeline } from '../testing/pushPipeline.js';
import { node, UPS_ONLINE } from '../testing/statusFixtures.js';
import { HOLD_LIMIT_MS } from '../status/rules.js';

const OK = { prometheus: { ok: true }, kuma: { ok: true } };
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** One cycle's caches: host h with its hottest sensor at `celsius` (null: no reading). */
function temperature(celsius) {
  return cachesOf({
    services: {
      sources: OK,
      nodes: { h: node({ temp: celsius === null ? null : String(celsius) }) },
    },
    ups: UPS_ONLINE,
  });
}

/** What the snapshot file holds for host h. */
const filed = (p, node = 'h') => JSON.parse(readFileSync(p.path, 'utf8')).hosts[node];

/** Host h's node entity in the pipeline's last status. */
const board = (p, node = 'h') => p.status.entities.find((e) => e.id === `nodes/${node}`);

/** Runs one cycle; returns what it sent. */
async function cycle(p, caches) {
  const before = p.sent.length;
  await p.cycle(caches);
  return p.sent.slice(before);
}

/** Moves the pipeline's clock so its next cycle runs at `at`. */
function nextCycleAt(p, at) {
  assert.ok(at >= p.now, 'the clock only moves forward');
  p.advance(at - p.now);
}

/** 45 °C, then 78 °C (one alert), then the first cycle with no reading. Returns when it began. */
async function heldAtWarn(p) {
  await cycle(p, temperature(45));
  assert.deepEqual(await cycle(p, temperature(78)), ['host_threshold h:temp']);
  const began = p.now;
  assert.deepEqual(await cycle(p, temperature(null)), [], 'no reading: held at warn');
  return began;
}

test('#469: a hold lasts 24 h', () => {
  assert.equal(HOLD_LIMIT_MS, DAY);
});

test('#469: a reading held at warn with no value for 24 h drops off the board and the snapshot in the same cycle, sending nothing', async () => {
  const p = pushPipeline();
  try {
    const began = await heldAtWarn(p);
    assert.deepEqual(filed(p), {
      reachable: true,
      levels: { cpu: 'ok', disk: 'ok', mem: 'ok', temp: 'warn' },
      heldSince: { temp: began },
    });

    // One cycle short of 24 h: still held, on the board and in the file.
    nextCycleAt(p, began + DAY - CYCLE_MS);
    assert.deepEqual(await cycle(p, temperature(null)), []);
    assert.deepEqual(
      [board(p).state, board(p).conditions.temp, board(p).reason],
      ['warn', 'unknown', 'Temperature: no reading (warning held until below 70 °C)']
    );
    assert.equal(filed(p).levels.temp, 'warn');

    // 24 h: gone from both, on this cycle, and nothing is sent.
    assert.deepEqual(await cycle(p, temperature(null)), [], 'no clear: nothing was read');
    assert.deepEqual(
      [board(p).state, board(p).reason, Object.hasOwn(board(p).conditions, 'temp')],
      ['ok', 'Healthy', false]
    );
    assert.deepEqual(filed(p), {
      reachable: true,
      levels: { cpu: 'ok', disk: 'ok', mem: 'ok' },
    });

    // Still no reading: nothing more, and nothing comes back.
    assert.deepEqual(await cycle(p, temperature(null)), []);
    assert.equal(board(p).state, 'ok');
    assert.equal(Object.hasOwn(filed(p).levels, 'temp'), false);
  } finally {
    p.close();
  }
});

test('#469: after its hold ran out, the reading back over its line pages once', async () => {
  const p = pushPipeline();
  try {
    const began = await heldAtWarn(p);
    nextCycleAt(p, began + DAY);
    assert.deepEqual(await cycle(p, temperature(null)), []);

    // Back hot: it is a new reading (#448), so it pages, once.
    assert.deepEqual(await cycle(p, temperature(76)), ['host_threshold h:temp']);
    assert.deepEqual(await cycle(p, temperature(76)), []);
    assert.equal(p.events.at(-1).prev, null, 'diffed from no previous state');
    assert.deepEqual([board(p).state, filed(p).levels.temp], ['warn', 'warn']);
    // And it ends as any reading does.
    assert.deepEqual(await cycle(p, temperature(69)), ['host_threshold_cleared h:temp']);
  } finally {
    p.close();
  }
});

test('#469: after its hold ran out, the reading back inside its old band is ok and sends nothing', async () => {
  const p = pushPipeline();
  try {
    const began = await heldAtWarn(p);
    nextCycleAt(p, began + DAY);
    await cycle(p, temperature(null));
    // 73 °C would still be warn inside the band of a held warning; forgotten, it is ok.
    assert.deepEqual(await cycle(p, temperature(73)), []);
    assert.deepEqual([board(p).state, filed(p).levels.temp], ['ok', 'ok']);
  } finally {
    p.close();
  }
});

test('#469: a restart in the middle of the 24 h keeps when the hold began: it still ends at its first cycle + 24 h', async () => {
  const p = pushPipeline();
  try {
    const began = await heldAtWarn(p);
    nextCycleAt(p, began + 12 * HOUR);
    await cycle(p, temperature(null));
    p.restart();

    // The restarted model is seeded with the hold's start, not this cycle.
    nextCycleAt(p, began + DAY - CYCLE_MS);
    assert.deepEqual(await cycle(p, temperature(null)), []);
    assert.equal(board(p).state, 'warn');
    assert.deepEqual(filed(p).heldSince, { temp: began }, 'the start survives the restart');

    assert.deepEqual(await cycle(p, temperature(null)), [], 'ends silently at the original 24 h');
    assert.equal(board(p).state, 'ok');
    assert.equal(Object.hasOwn(filed(p).levels, 'temp'), false);
    // Back hot, one page.
    assert.deepEqual(await cycle(p, temperature(78)), ['host_threshold h:temp']);
  } finally {
    p.close();
  }
});

test('#469: a restart just before the 24 h, then a cycle after it: both forget the reading on that first cycle', async () => {
  const p = pushPipeline();
  try {
    const began = await heldAtWarn(p);
    nextCycleAt(p, began + DAY - CYCLE_MS);
    await cycle(p, temperature(null));
    p.restart();
    // JagHelm was down across the 24 h mark: the first cycle back is past it.
    nextCycleAt(p, began + DAY + 2 * HOUR);
    assert.deepEqual(await cycle(p, temperature(null)), []);
    assert.equal(board(p).state, 'ok');
    assert.deepEqual(Object.keys(filed(p).levels), ['cpu', 'disk', 'mem']);
  } finally {
    p.close();
  }
});

test('#469: a snapshot written before #469 (a held level with no heldSince) starts the clock on the first cycle that reads it: no drop then, 24 h later it ends', async () => {
  const old = pushPipeline();
  const p = pushPipeline({ path: old.path });
  try {
    writeFileSync(
      old.path,
      JSON.stringify({
        services: {},
        monitorOf: {},
        hosts: { h: { reachable: true, levels: { cpu: 'ok', disk: 'ok', mem: 'ok', temp: 'warn' } } },
        ups: { state: 'online' },
        cron: {},
        sources: { prometheus: 'ok' },
      })
    );
    const first = p.now;
    assert.deepEqual(await cycle(p, temperature(null)), [], 'no clear, no alert');
    assert.equal(board(p).state, 'warn', 'still held: the file gives no start, so it starts now');
    assert.deepEqual(filed(p).heldSince, { temp: first });

    nextCycleAt(p, first + DAY - CYCLE_MS);
    assert.deepEqual(await cycle(p, temperature(null)), []);
    assert.equal(board(p).state, 'warn');
    assert.deepEqual(await cycle(p, temperature(null)), []);
    assert.equal(board(p).state, 'ok');
    assert.equal(Object.hasOwn(filed(p).levels, 'temp'), false);
  } finally {
    p.close();
    old.close();
  }
});

test('#469: a reading read again ends its hold; the next gap starts a new 24 h', async () => {
  const p = pushPipeline();
  try {
    const began = await heldAtWarn(p);
    // Read again at 20 h, still over its line: the same episode, nothing sent.
    nextCycleAt(p, began + 20 * HOUR);
    assert.deepEqual(await cycle(p, temperature(76)), []);
    assert.deepEqual(filed(p), {
      reachable: true,
      levels: { cpu: 'ok', disk: 'ok', mem: 'ok', temp: 'warn' },
    });
    // No reading again: a new hold, from this cycle.
    const again = p.now;
    assert.deepEqual(await cycle(p, temperature(null)), []);
    assert.deepEqual(filed(p).heldSince, { temp: again });

    // The first hold's 24 h pass: still held.
    nextCycleAt(p, began + DAY + HOUR);
    assert.deepEqual(await cycle(p, temperature(null)), []);
    assert.equal(board(p).state, 'warn');
    // The second's: it ends.
    nextCycleAt(p, again + DAY);
    assert.deepEqual(await cycle(p, temperature(null)), []);
    assert.equal(board(p).state, 'ok');
  } finally {
    p.close();
  }
});

test('#469: a reading held at ok is forgotten after 24 h too, sending nothing; back over its line it pages once', async () => {
  const p = pushPipeline();
  try {
    await cycle(p, temperature(45));
    const began = p.now;
    await cycle(p, temperature(null));
    assert.deepEqual(filed(p).heldSince, { temp: began });
    nextCycleAt(p, began + DAY);
    assert.deepEqual(await cycle(p, temperature(null)), []);
    assert.equal(Object.hasOwn(filed(p).levels, 'temp'), false);
    assert.equal(filed(p).heldSince, undefined);
    assert.deepEqual(await cycle(p, temperature(80)), ['host_threshold h:temp']);
  } finally {
    p.close();
  }
});

// ── #468: a storage pool whose Proxmox read fails ────────────────────────

const POOL = 'pool:local-lvm';

/** One cycle's caches: node pve, calm, its Proxmox read listing local-lvm at `percent`, or failing (null). */
function pveWith(percent) {
  const entry =
    percent === null
      ? { _error: 'HTTP 500 Internal Server Error' }
      : {
          Running: '2/2',
          _vms: [],
          _storagePools: [
            {
              name: 'local-lvm',
              type: 'lvmthin',
              usedGB: String(percent),
              totalGB: '100.0',
              percent,
              status: 'available',
            },
          ],
        };
  return cachesOf({
    services: { sources: OK, nodes: { pve: node({}, { display_name: 'pve' }) } },
    ups: UPS_ONLINE,
    integrations: {
      proxmox: { _target: 'pve:pve', _preset: 'proxmox', _status: { state: 'ok' }, ...entry },
    },
  });
}

test('#469: a storage pool held while its Proxmox read fails ends after 24 h the same way: no clear; back over its line, one page', async () => {
  const p = pushPipeline();
  try {
    await cycle(p, pveWith(50));
    assert.deepEqual(await cycle(p, pveWith(93)), [`host_threshold pve:${POOL}`]);
    const began = p.now;
    assert.deepEqual(await cycle(p, pveWith(null)), []);
    assert.deepEqual(filed(p, 'pve').heldSince, { [POOL]: began });

    nextCycleAt(p, began + DAY - CYCLE_MS);
    assert.deepEqual(await cycle(p, pveWith(null)), []);
    assert.equal(board(p, 'pve').state, 'warn');
    assert.equal(filed(p, 'pve').levels[POOL], 'warn');

    assert.deepEqual(await cycle(p, pveWith(null)), [], 'no clear: nothing was read');
    assert.equal(board(p, 'pve').state, 'ok');
    assert.equal(Object.hasOwn(filed(p, 'pve').levels, POOL), false);
    assert.equal(filed(p, 'pve').heldSince, undefined);

    assert.deepEqual(await cycle(p, pveWith(93)), [`host_threshold pve:${POOL}`]);
    assert.deepEqual(await cycle(p, pveWith(93)), []);
  } finally {
    p.close();
  }
});

test('#469: a held pool that a read which succeeds no longer lists, inside the 24 h, still sends its clear (#468)', async () => {
  const p = pushPipeline();
  try {
    await cycle(p, pveWith(50));
    await cycle(p, pveWith(93));
    const began = p.now;
    await cycle(p, pveWith(null));
    nextCycleAt(p, began + 23 * HOUR);
    const gone = cachesOf({
      services: { sources: OK, nodes: { pve: node({}, { display_name: 'pve' }) } },
      ups: UPS_ONLINE,
      integrations: {
        proxmox: {
          Running: '2/2',
          _vms: [],
          _storagePools: [],
          _target: 'pve:pve',
          _preset: 'proxmox',
          _status: { state: 'ok' },
        },
      },
    });
    assert.deepEqual(await cycle(p, gone), [`host_threshold_cleared pve:${POOL}`]);
    assert.equal(Object.hasOwn(filed(p, 'pve').levels, POOL), false);
  } finally {
    p.close();
  }
});
