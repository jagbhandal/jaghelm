/**
 * A status model that keeps throwing is a failed source of its own (#440):
 * while it throws there is no status, so push has nothing to diff and every
 * other page is silent. After its second failed cycle in a row push sends one
 * "JagHelm status check failing", and one "recovered" when the model builds
 * again, through the same failing/down run and the same source_down and
 * source_recovered events as Prometheus, Kuma and NUT (push/snapshot.js
 * buildSources). Those two pushes are built from the snapshot alone, never
 * from the model's output. The rest of the snapshot does not move while the
 * model throws, so what changed meanwhile is sent once it builds, and nothing
 * twice.
 *
 * The homelab-shaped board (fixtures/liveShape.js) runs through the real
 * model and push cycle (testing/pushPipeline.js); a cycle with `modelThrows`
 * is built as refresh.js builds one whose model threw (cycleSnapshot).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildMessage } from './fcm.js';
import { STATUS_CHECK } from './differ.js';
import { pushPipeline } from '../testing/pushPipeline.js';
import { liveCaches, liveCycle } from './fixtures/liveShape.js';

// What the first cycle of a run on the board sends: its open problem, once (#448).
const FIRST = 'cron_failed nas:b2-sync';
const THROWS = Symbol('the model throws');

/**
 * Runs `cycles` through push: caches, THROWS for a cycle whose model threw,
 * or 'restart'. Returns what each cycle sent and the events.
 */
async function play(cycles, p = pushPipeline({ env: { KUMA_URL: 'http://kuma' } })) {
  try {
    const perCycle = [];
    let healthy = null;
    for (const c of cycles) {
      if (c === 'restart') {
        p.restart();
        continue;
      }
      const before = p.sent.length;
      if (c === THROWS) await p.cycle(healthy ?? liveCaches(liveCycle()), { modelThrows: true });
      else {
        healthy = c;
        await p.cycle(c);
      }
      perCycle.push(p.sent.slice(before));
    }
    return { perCycle, events: [...p.events], file: p.path, p };
  } finally {
    p.close();
  }
}

const healthy = () => liveCaches(liveCycle());

test('the model throws for 2 cycles: exactly one push; it builds again: exactly one recovery push', async () => {
  const { perCycle, events } = await play([
    healthy(),
    THROWS,
    THROWS,
    THROWS,
    THROWS,
    healthy(),
    healthy(),
  ]);
  assert.deepEqual(perCycle, [
    [FIRST],
    [],
    ['source_down status'],
    [],
    [],
    ['source_recovered status'],
    [],
  ]);
  const down = events.find((e) => e.type === 'source_down');
  const back = events.find((e) => e.type === 'source_recovered');
  assert.deepEqual(
    [down.id, down.node, down.title, down.body, down.severity, down.reason],
    [
      STATUS_CHECK,
      STATUS_CHECK,
      'JagHelm status check failing',
      "JagHelm can't work out the status, so no other alerts are sent until it can. The server log says why.",
      'critical',
      undefined,
    ]
  );
  assert.deepEqual(
    [back.title, back.body, back.severity],
    [
      'JagHelm status check recovered',
      'Alerts are on again. Anything that changed meanwhile is sent now.',
      'info',
    ]
  );
  // On a phone: the four data keys, and high priority while paging is off.
  const msg = buildMessage('phone', down);
  assert.deepEqual(msg.data, { type: 'source_down', id: 'status', node: 'status', severity: 'critical' });
  assert.equal(msg.android.priority, 'high');
});

test('a one-cycle failure sends nothing', async () => {
  const { perCycle } = await play([healthy(), THROWS, healthy(), healthy(), THROWS, healthy()]);
  assert.deepEqual(perCycle, [[FIRST], [], [], [], [], []]);
});

test('while it throws the snapshot holds the last good state; what changed meanwhile is sent once, with the recovery', async () => {
  const p = pushPipeline({ env: { KUMA_URL: 'http://kuma' } });
  const good = healthy();
  await p.cycle(good);
  const last = p.snapshot.prev();
  await p.cycle(good, { modelThrows: true });
  await p.cycle(good, { modelThrows: true });
  const held = p.snapshot.prev();
  assert.deepEqual(
    { ...held, sources: { ...held.sources, status: undefined } },
    { ...last, sources: { ...last.sources, status: undefined } },
    'nothing but the status check moved'
  );
  assert.equal(held.sources.status, 'down');
  const { history, ...filed } = JSON.parse(readFileSync(p.path, 'utf8'));
  assert.deepEqual(filed, held, 'and that is what the file holds');
  assert.ok(history, 'beside the alert history (#267)');

  // Meanwhile a node went unreachable and two services went down.
  const back = liveCycle({ status: { Gitea: 'down', 'NAS UI': 'down' } });
  back.nodes.pi1 = { ...back.nodes.pi1, reachable: false };
  const before = p.sent.length;
  await p.cycle(liveCaches(back));
  await p.cycle(liveCaches(back));
  assert.deepEqual(p.sent.slice(before), [
    'host_unreachable pi1',
    'service_down vm103:NAS UI',
    'service_down vm103:gitea',
    'source_recovered status',
  ]);
  p.close();
});

test('a restart while it throws keeps the count (it is in the push snapshot): no second push, one recovery', async () => {
  const { perCycle } = await play([
    healthy(),
    THROWS,
    THROWS,
    'restart',
    THROWS,
    THROWS,
    healthy(),
    'restart',
    healthy(),
  ]);
  assert.deepEqual(perCycle, [
    [FIRST],
    [],
    ['source_down status'],
    [],
    [],
    ['source_recovered status'],
    [],
  ]);
});

test('a restart after one failed cycle: the next failed cycle is the second in a row, and pages', async () => {
  const { perCycle } = await play([healthy(), THROWS, 'restart', THROWS, healthy()]);
  assert.deepEqual(perCycle, [[FIRST], [], ['source_down status'], ['source_recovered status']]);
});

test('no snapshot and the model throwing from the first cycle: one push after 2 cycles; once it builds, the recovery and each open problem, once', async () => {
  const { perCycle } = await play([THROWS, THROWS, THROWS, healthy(), healthy()]);
  assert.deepEqual(perCycle, [[], ['source_down status'], [], [FIRST, 'source_recovered status'], []]);
});
