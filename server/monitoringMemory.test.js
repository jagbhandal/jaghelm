/**
 * The memory chart's read (#757, monitoringMemory.js): a cell per visible node,
 * memory and swap as two series, the warn line in force, a node with no swap
 * without a swap line, and a failing swap read as its own sentence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MONITORING_CHARTS, createMonitoringCache } from './monitoring.js';
import { HISTORY_SERIES } from './promHistory.js';
import { DEFAULT_THRESHOLDS } from './status/thresholds.js';
import { FOCUS } from './monitoringFocus.js';

const CONFIG = { nodes: { pve: {}, nas: { prometheus_node: 'storage-box' }, old: { visible: false } } };
const NOW = Date.UTC(2026, 9, 20, 9, 0, 30);
const quiet = { info() {}, warn() {} };
const MEMORY_ONLY = { memory: MONITORING_CHARTS.memory };

/** A cache over a stub: `answers` maps a query's series to what it returns; `fail` makes a series throw. */
function setup({ fail = {} } = {}) {
  const asked = [];
  const queryRange = async (query, span) => {
    asked.push(query);
    const series = query.includes('SwapFree') ? 'swap' : 'memory';
    if (fail[series]) throw fail[series];
    return series === 'swap'
      ? [{ metric: { node: 'pve' }, values: [[span.start, '4.5']] }]
      : [
          { metric: { node: 'pve' }, values: [[span.start, '40']] },
          { metric: { node: 'storage-box' }, values: [[span.start, '20']] },
        ];
  };
  const cache = createMonitoringCache({
    queryRange,
    now: () => NOW,
    logger: quiet,
    charts: MEMORY_ONLY,
    thresholds: () => DEFAULT_THRESHOLDS,
  });
  return { asked, cache };
}

test('memory is in the table, in Resources, under the id the banner opens', () => {
  assert.equal(MONITORING_CHARTS.memory.section, 'resources');
  assert.equal(FOCUS.memory, 'memory');
  assert.ok(Object.hasOwn(MONITORING_CHARTS, FOCUS.memory));
});

test('node.swap is a whitelisted node series: used share, from SwapTotal and SwapFree, no line without swap', () => {
  const { kind, unit, query } = HISTORY_SERIES['node.swap'];
  assert.deepEqual([kind, unit], ['node', '%']);
  const q = query('node=~"pve"', '5m');
  assert.match(q, /node_memory_SwapFree_bytes\{node=~"pve"\}\[5m\]/);
  assert.match(q, /node_memory_SwapTotal_bytes\{node=~"pve"\}\[5m\]\) > 0\)/, 'a node with 0 swap is dropped, not 0 / 0');
  assert.match(q, /by \(node\)/);
});

test('memory: a cell per visible node, the memory lines, the swap lines and the warn line', async () => {
  const { asked, cache } = setup();
  const [chart] = (await cache.answer('1h', CONFIG)).charts;
  assert.deepEqual(
    [chart.id, chart.ok, chart.unit, chart.nodes],
    ['memory', true, '%', ['pve', 'nas']]
  );
  assert.deepEqual(chart.lines.map((l) => l.entity).sort(), ['nas', 'pve']);
  // Only pve has swap: nas has no swap line, not a line of zeros.
  assert.equal(chart.swap.ok, true);
  assert.deepEqual(chart.swap.lines.map((l) => [l.entity, l.values[0]]), [['pve', 4.5]]);
  assert.deepEqual(chart.thresholds, { mem: { warn: 90 } });
  assert.equal(asked.length, 2);
  assert.doesNotMatch(asked.join(' '), /old/);
});

test('memory: a failing swap read is its own sentence and leaves the memory lines', async () => {
  const { cache } = setup({ fail: { swap: Object.assign(new Error('bad'), { status: 400 }) } });
  const [chart] = (await cache.answer('1h', CONFIG)).charts;
  assert.equal(chart.ok, true);
  assert.equal(chart.lines.length, 2);
  assert.deepEqual(chart.swap, { ok: false, error: 'Prometheus refused the swap query (HTTP 400)' });
});

test('memory: a failing memory read fails the chart with the memory sentence', async () => {
  const { cache } = setup({ fail: { memory: Object.assign(new Error('bad'), { status: 400 }) } });
  const [chart] = (await cache.answer('1h', CONFIG)).charts;
  assert.deepEqual([chart.ok, chart.error], [false, 'Prometheus refused the memory query (HTTP 400)']);
});

test('memory: no visible node asks nothing and answers no cells', async () => {
  const { asked, cache } = setup();
  const [chart] = (await cache.answer('1h', { nodes: {} })).charts;
  assert.deepEqual([chart.ok, chart.nodes, chart.lines, chart.swap.lines], [true, [], [], []]);
  assert.equal(asked.length, 0);
});

test('memory: no warn line set leaves the thresholds empty', async () => {
  const cache = createMonitoringCache({
    queryRange: async () => [],
    now: () => NOW,
    logger: quiet,
    charts: MEMORY_ONLY,
    thresholds: () => ({}),
  });
  const [chart] = (await cache.answer('1h', CONFIG)).charts;
  assert.deepEqual(chart.thresholds, { mem: {} });
});
