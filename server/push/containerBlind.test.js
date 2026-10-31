/**
 * A node with no container readings pages (#838): cAdvisor's view of a node's
 * containers is gone, so the restart-loop and Missing-container pages for it
 * are blind (they are held silently, snapshot.js buildContainerConditions).
 * That is the cAdvisor part of Grafana's Monitoring gap rule, which retires
 * with Grafana. The read (containerEvents.js) names the nodes that read
 * earlier in the hour but not now (`silentNodes`); the model lists each as a
 * source of its own, `containers-source:<node>` (status/containerBlind.js),
 * and the push snapshot steps it like any monitoring source: one source_down
 * on the second failed cycle, one source_recovered when readings return.
 *
 * Run end to end through the real model and push cycle (testing/pushPipeline.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cachesOf, pushPipeline } from '../testing/pushPipeline.js';
import { card, inputs, node, once, UPS_ONLINE } from '../testing/statusFixtures.js';
import { containerBlindNodes, CONTAINERS_SOURCE } from '../status/containerBlind.js';
import { alertKey, alertKind, categoryOf, shouldDeliver } from './dispatch.js';
import { buildSources } from './snapshot.js';
import { createAlertPolicy } from './alertPolicy.js';
import { createAlertState } from './alertState.js';
import { resolveAlerts } from './alertRules.js';
import { entityOf } from './entity.js';

const START = 1_782_345_600_000;
const OK = { prometheus: { ok: true }, kuma: { ok: true } };
const read = (extra = {}) => ({
  state: 'ok',
  events: [],
  blindNodes: [],
  silentNodes: [],
  oomCounter: true,
  ...extra,
});
const NODES = () => ({
  apps: node({}, { display_name: 'Apps', services: [card('apps:web')] }),
  pi: node({}, { display_name: 'Pi', services: [card('pi:dns')] }),
});
const board = (containerEvents) =>
  cachesOf({ services: { sources: OK, nodes: NODES() }, ups: UPS_ONLINE, containerEvents });
const sentOf = (p) => p.sent.filter((s) => s.includes(CONTAINERS_SOURCE));

test('the model lists a silent node as a warn source, in words that name the node and the blind alerts', () => {
  const status = once(inputs({ nodes: NODES(), containerEvents: read({ silentNodes: ['apps'] }) }));
  const issue = status.issues.find((i) => i.id === 'sources/containers-source:apps');
  assert.equal(issue.kind, 'source');
  assert.equal(issue.state, 'warn');
  assert.equal(issue.word, 'Failed');
  assert.equal(issue.name, 'Container readings on Apps');
  assert.equal(issue.reason, 'No container readings, so container alerts for Apps are blind');
  assert.equal(status.sources['containers-source:apps'].state, 'failed');
  assert.match(status.overall.sentence, /Container readings on Apps missing/);
  // The node's own entity and its cards are left as they were: this is a source, not the node's fault.
  assert.equal(status.entities.find((e) => e.id === 'nodes/apps').state, 'ok');
});

test('a node that never had container readings (blind, not silent) is not listed: vm-101 and MS-S1 are not covered by design', () => {
  for (const containerEvents of [read({ blindNodes: ['apps'] }), read(), null, { state: 'no-containers', events: [] }]) {
    const status = once(inputs({ nodes: NODES(), containerEvents }));
    assert.deepEqual(
      status.issues.filter((i) => i.id.includes(CONTAINERS_SOURCE)),
      [],
      JSON.stringify(containerEvents)
    );
  }
  assert.deepEqual(containerBlindNodes(read({ blindNodes: ['apps'] }), []), []);
  // A silent node that is no node of the config is left out.
  const status = once(inputs({ nodes: NODES(), containerEvents: read({ silentNodes: ['gone'] }) }));
  assert.deepEqual(status.issues.filter((i) => i.id.includes(CONTAINERS_SOURCE)), []);
});

test('pages once on the second blind cycle, never repeats while blind, and recovers once', async () => {
  const p = pushPipeline({ start: START });
  try {
    await p.cycle(board(read()));
    await p.cycle(board(read({ silentNodes: ['apps'] })));
    assert.deepEqual(sentOf(p), [], 'one failed cycle sends nothing');
    assert.equal(p.snapshot.prev().sources['containers-source:apps'], 'failing');
    await p.cycle(board(read({ silentNodes: ['apps'] })));
    assert.deepEqual(sentOf(p), ['source_down containers-source:apps']);
    const page = p.events.find((e) => e.type === 'source_down');
    assert.equal(page.severity, 'warning');
    assert.equal(page.title, 'Container readings missing');
    assert.equal(page.body, 'Container readings on Apps · No container readings, so container alerts for Apps are blind');
    assert.equal(page.node, 'apps');
    assert.equal(alertKind(page), 'page');
    assert.equal(entityOf(page), 'sources/containers-source:apps');
    assert.equal(categoryOf(page.type, page.id), 'host');
    // Blind for 20 more cycles, then past the range's hour (blind, no longer silent), and while the read fails.
    for (let i = 0; i < 20; i += 1) await p.cycle(board(read({ silentNodes: ['apps'] })));
    for (const gap of [read({ blindNodes: ['apps'] }), null, { state: 'no-containers', events: [] }]) {
      await p.cycle(board(gap));
      await p.cycle(board(gap));
    }
    assert.equal(sentOf(p).length, 1, 'no repeat');
    assert.equal(p.snapshot.prev().sources['containers-source:apps'], 'down');
    // Readings return.
    await p.cycle(board(read()));
    assert.deepEqual(sentOf(p), ['source_down containers-source:apps', 'source_recovered containers-source:apps']);
    const back = p.events.at(-1);
    assert.equal(back.severity, 'info');
    assert.equal(back.title, 'Container readings recovered');
    assert.equal(back.body, 'Container readings are back on Apps');
    assert.equal(alertKey(back), alertKey(page), 'a page and its recovery share Snooze and Ack');
    assert.equal(alertKind(back), 'recovery');
    await p.cycle(board(read()));
    await p.cycle(board(read()));
    assert.equal(sentOf(p).length, 2);
    assert.equal(p.snapshot.prev().sources['containers-source:apps'], undefined, 'forgotten after its ok cycle');
  } finally {
    p.close();
  }
});

test('a blip of one cycle, a node that never read, and a restart mid-episode page nothing extra', async () => {
  const p = pushPipeline({ start: START });
  try {
    await p.cycle(board(read()));
    await p.cycle(board(read({ silentNodes: ['apps'] })));
    await p.cycle(board(read()));
    for (let i = 0; i < 5; i += 1) await p.cycle(board(read({ blindNodes: ['pi'] })));
    assert.deepEqual(sentOf(p), [], 'a blip, and a node cAdvisor never covered');
    await p.cycle(board(read({ silentNodes: ['apps'] })));
    await p.cycle(board(read({ silentNodes: ['apps'] })));
    assert.equal(sentOf(p).length, 1);
    // JagHelm restarts while blind past the hour: the model has forgotten the node, the snapshot has not.
    p.restart();
    await p.cycle(board(read({ blindNodes: ['apps'] })));
    await p.cycle(board(read({ blindNodes: ['apps'] })));
    assert.equal(sentOf(p).length, 1, 'no recovery and no second page');
    assert.equal(p.snapshot.prev().sources['containers-source:apps'], 'down');
    await p.cycle(board(read()));
    assert.equal(sentOf(p).length, 2, 'the recovery, when readings return');
  } finally {
    p.close();
  }
});

test('buildSources: stepped like a monitoring source, held while the read cannot say, recovered only on a real reading', () => {
  const listed = (names) => ({
    sources: Object.fromEntries(names.map((n) => [`containers-source:${n}`, { state: 'failed' }])),
  });
  const has = (v) => ({ 'containers-source:apps': v });
  assert.deepEqual(buildSources(listed(['apps']), {}, read({ silentNodes: ['apps'] })), has('failing'));
  assert.deepEqual(buildSources(listed(['apps']), has('failing'), read({ silentNodes: ['apps'] })), has('down'));
  assert.deepEqual(buildSources(listed(['apps']), has('down'), read({ silentNodes: ['apps'] })), has('down'));
  // Not listed, and not reading (the model's memory is gone): carried on.
  assert.deepEqual(buildSources({ sources: {} }, has('failing'), read({ blindNodes: ['apps'] })), has('down'));
  // Not listed, and the read cannot say: held as it is.
  assert.deepEqual(buildSources({ sources: {} }, has('down'), null), has('down'));
  assert.deepEqual(buildSources({ sources: {} }, has('failing'), { state: 'no-containers' }), has('failing'));
  // Not listed and reading: a page that was sent recovers; one that was not is dropped.
  assert.deepEqual(buildSources({ sources: {} }, has('down'), read()), has('ok'));
  assert.deepEqual(buildSources({ sources: {} }, has('failing'), read()), {});
  assert.deepEqual(buildSources({ sources: {} }, has('ok'), read()), {});
});

test('it follows the other warnings: the host switch and the recovery switch apply', () => {
  const prefs = (extra) => ({
    enabled: true,
    notifyRecoveries: true,
    categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
    ...extra,
  });
  const down = { type: 'source_down', id: 'containers-source:apps' };
  const up = { type: 'source_recovered', id: 'containers-source:apps' };
  assert.equal(shouldDeliver(down, prefs({})), true);
  assert.equal(shouldDeliver(down, prefs({ categories: { host: false } })), false);
  assert.equal(shouldDeliver(up, prefs({ notifyRecoveries: false })), false);
});

test('quiet hours: a warning page, so it waits for the morning like a restart loop; critical mode lets only critical ring', () => {
  const NIGHT = Date.parse('2026-10-24T03:00:00Z'); // 23:00 on Oct 23 in Toronto
  const rules = resolveAlerts({
    groupWindowSeconds: 0,
    quietHours: { enabled: true, start: '22:00', end: '07:00', mode: 'critical' },
    timezone: 'America/Toronto',
  });
  const state = createAlertState({ initial: () => undefined, save() {}, now: () => NIGHT });
  const policy = createAlertPolicy({ rules: () => rules, state, now: () => NIGHT });
  const entry = (event) => ({ event, queuedAt: NIGHT, tag: event.id });
  const unitOf = (event) => policy.plan([entry(event)])[0];
  const blind = { type: 'source_down', id: 'containers-source:apps', severity: 'warning', body: 'x' };
  const loop = { type: 'container_restart_loop', id: 'apps:web', severity: 'warning', body: 'x' };
  // Held to the end of the quiet hours (07:00 Toronto), as a restart loop is.
  for (const event of [blind, loop]) {
    const unit = unitOf(event);
    assert.equal(unit.ready, false, event.type);
    assert.equal(unit.until, Date.parse('2026-10-24T11:00:00Z'), event.type);
  }
  const critical = { ...blind, severity: 'critical' };
  assert.equal(unitOf(critical).ready, true, 'only a critical page rings');
});
