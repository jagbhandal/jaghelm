/**
 * The Drives chart (#762, monitoringDrives.js): the status model's lamps passed
 * through as they are, the thresholds the model judged by, a temperature line
 * per drive, and the arrays' members against how many they need. A missing
 * reading is words, never a healthy lamp.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createMonitoringCache, MONITORING_CHARTS } from './monitoring.js';
import { arraysOf, drivesAnswer, judgeArray } from './monitoringDrives.js';

const CONFIG = { nodes: { pve: {}, nas: { prometheus_node: 'storage-box' } } };
const NOW = Date.UTC(2026, 9, 29, 12, 0, 30);
const quiet = { info() {}, warn() {} };
const DRIVES_ONLY = { drives: MONITORING_CHARTS.drives };
const THRESHOLDS = { driveTemp: { nvme: { warn: 70, crit: 80 }, sata: { warn: 55, crit: 60 } } };

const drive = (device, over = {}) => ({
  key: `drive:nas:${device}`,
  device,
  model: 'ST8000',
  type: 'hdd',
  state: 'ok',
  word: 'Healthy',
  reason: 'Healthy',
  temperature: 40,
  ...over,
});
const node = (over = {}) => ({ kind: 'node', node: 'nas', name: 'NAS', drives: [drive('sda'), drive('nvme0', { type: 'nvme' })], ...over });
const statusOf = (entities, sources = {}) => ({ entities, sources, thresholds: THRESHOLDS });

const sample = (labels, value) => ({ metric: labels, value: [0, String(value)] });
const MD = (state, n) => sample({ node: 'storage-box', device: 'md0', state }, n);
const REQUIRED = (n) => sample({ node: 'storage-box', device: 'md0' }, n);

function setup({ status, drivesRead = { enabled: true, nodes: { nas: {} } }, md = [[MD('active', 3), MD('failed', 0)], [REQUIRED(3)]], failQuery = null } = {}) {
  const state = { range: [], instant: [], status, drivesRead };
  const queryRange = async (query, span) => {
    state.range.push(query);
    if (failQuery) throw failQuery;
    return [{ metric: { node: 'storage-box', device: 'sda' }, values: [[span.start, '41.2'], [span.start + span.step, '42']] }];
  };
  let call = 0;
  const query = async (q) => {
    state.instant.push(q);
    return md[call++ % 2];
  };
  const cache = createMonitoringCache({
    queryRange,
    query,
    now: () => NOW,
    logger: quiet,
    charts: DRIVES_ONLY,
    status: () => state.status,
    drives: () => state.drivesRead,
  });
  return { state, cache, ask: async (range = '1h') => (await cache.answer(range, CONFIG)).charts[0] };
}

test('the chart is live and sits in the Drives section', () => {
  assert.deepEqual(
    [MONITORING_CHARTS.drives.section, MONITORING_CHARTS.drives.live],
    ['drives', true]
  );
});

test('the chart\'s title is not its section\'s: two landmarks of one name are not told apart', async () => {
  const { MONITORING_SECTIONS } = await import('./monitoringSections.js');
  for (const chart of Object.values(MONITORING_CHARTS)) {
    const section = MONITORING_SECTIONS.find((s) => s.id === chart.section);
    assert.notEqual(chart.title, section.title);
  }
});

test("each drive's lamp, word and reason are the model's, passed through; the lines are the kind's warn and critical", async () => {
  const crit = drive('sda', { state: 'crit', word: 'Critical', reason: 'drive sda failed its health check' });
  const { ask } = setup({ status: statusOf([node({ drives: [crit, drive('nvme0', { type: 'nvme' })] })]) });
  const chart = await ask();
  assert.equal(chart.ok, true);
  assert.equal(chart.smart, 'ok');
  const [n] = chart.nodes;
  assert.deepEqual([n.key, n.name, n.blind], ['nas', 'NAS', null]);
  const [sda, nvme] = n.drives;
  assert.deepEqual([sda.state, sda.word, sda.reason], ['crit', 'Critical', 'drive sda failed its health check']);
  assert.deepEqual(sda.lines, { warn: 55, crit: 60 });
  assert.deepEqual(nvme.lines, { warn: 70, crit: 80 });
  assert.deepEqual(sda.values.slice(0, 2), [41.2, 42]);
  assert.equal(nvme.values, null, 'a drive with no line has none, not zeros');
});

test('the temperature query is for the visible nodes; the arrays come from node_md_disks against node_md_disks_required', async () => {
  const { state, ask } = setup({ status: statusOf([node()]) });
  const chart = await ask();
  assert.match(state.range[0], /smartctl_device_temperature/);
  assert.match(state.range[0], /node=~"pve\|storage-box"/);
  assert.match(state.instant[0], /node_md_disks\{/);
  assert.match(state.instant[1], /node_md_disks_required\{/);
  assert.deepEqual(chart.nodes[0].raid.map((a) => [a.device, a.active, a.required, a.state]), [['md0', 3, 3, 'ok']]);
});

test('a degraded array is critical, a failed member with enough active a warning, an unknown requirement no signal', () => {
  assert.deepEqual(
    judgeArray('md0', { active: 2, required: 3, failed: 0, spare: 0 }),
    { device: 'md0', active: 2, required: 3, failed: 0, spare: 0, state: 'crit', word: 'Critical', reason: 'degraded: 2 of 3 members active, 1 member missing' }
  );
  assert.equal(judgeArray('md0', { active: 3, required: 3, failed: 1, spare: 0 }).state, 'warn');
  assert.equal(judgeArray('md0', { active: 3, required: 3, failed: 0, spare: 0 }).state, 'ok');
  const unknown = judgeArray('md0', { active: 3, required: null, failed: 0, spare: 0 });
  assert.deepEqual([unknown.state, unknown.word], ['unknown', 'No signal']);
  assert.equal(judgeArray('md0', { active: 0, required: 2, failed: 0, spare: 0 }).reason, 'degraded: 0 of 2 members active, 2 members missing');
});

test('arrays group by node and device, and ignore a series no node owns', () => {
  const lineOf = (m) => (m.node === 'storage-box' ? ['nas'] : []);
  const out = arraysOf(
    [MD('active', 1), sample({ node: 'storage-box', device: 'md1', state: 'active' }, 2), sample({ node: 'other', device: 'md9', state: 'active' }, 2)],
    [REQUIRED(2), sample({ node: 'storage-box', device: 'md1' }, 2)],
    lineOf
  );
  assert.deepEqual(Object.keys(out), ['nas']);
  assert.deepEqual(out.nas.map((a) => [a.device, a.state]), [['md0', 'crit'], ['md1', 'ok']]);
});

test('an array alone is shown even when no node reports drives', async () => {
  const { ask } = setup({ status: statusOf([{ kind: 'node', node: 'nas', name: 'NAS' }]) });
  const chart = await ask();
  assert.equal(chart.smart, 'none');
  assert.equal(chart.nodes.length, 1);
  assert.deepEqual([chart.nodes[0].drives, chart.nodes[0].raid.length], [[], 1]);
});

test('no smartctl exporter, module off and not read yet are three different words, never ok', async () => {
  const out = async (drivesRead) => {
    const { ask } = setup({ status: statusOf([]), drivesRead, md: [[], []] });
    return ask();
  };
  assert.deepEqual([(await out({ enabled: true, nodes: {} })).smart, (await out({ enabled: false })).smart, (await out(null)).smart], ['none', 'off', 'unread']);
  assert.deepEqual((await out(null)).nodes, []);
});

test('a node that can no longer see its drives is blind with the model\'s sentence, and draws no lamps', async () => {
  const sources = { 'drives-source:nas': { state: 'failed', error: 'Drive monitoring has no signal on NAS' } };
  const { ask } = setup({ status: statusOf([{ kind: 'node', node: 'nas', name: 'NAS' }], sources), md: [[], []] });
  const chart = await ask();
  assert.equal(chart.smart, 'ok');
  assert.deepEqual([chart.nodes[0].blind, chart.nodes[0].drives], ['Drive monitoring has no signal on NAS', []]);
});

test('no status yet is "unread", not healthy', () => {
  const answer = drivesAnswer({ status: null, drivesRead: null, temps: {}, raid: {}, head: {} });
  assert.deepEqual([answer.smart, answer.nodes], ['unread', []]);
});

test('Prometheus failing is the chart\'s own sentence, and the lamps are not drawn as healthy', async () => {
  const { ask } = setup({ status: statusOf([node()]), failQuery: Object.assign(new Error('boom'), { failure: 'rejected', status: 400 }) });
  const chart = await ask();
  assert.equal(chart.ok, false);
  assert.match(chart.error, /Prometheus/);
  assert.equal(chart.nodes, undefined);
});

test('the lamps follow the model on every read, while Prometheus is asked once per step', async () => {
  const { state, ask } = setup({ status: statusOf([node()]) });
  assert.equal((await ask()).nodes[0].drives[0].state, 'ok');
  state.status = statusOf([node({ drives: [drive('sda', { state: 'warn', word: 'Warning', reason: 'x' })] })]);
  assert.equal((await ask()).nodes[0].drives[0].state, 'warn');
  assert.equal(state.range.length, 1);
});
