/**
 * Which Monitoring chart an issue opens (#752, monitoringFocus.js): spec §4's
 * table, read off the model's own issue fields.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FOCUS, FOCUS_PARAM, chartOfIssue, focusHref } from './monitoringFocus.js';
import { MONITORING_CHARTS } from './monitoring.js';

const node = (metricName, extra = {}) => ({
  kind: 'node',
  state: 'warn',
  metric: metricName ? { name: metricName } : undefined,
  ...extra,
});

test('a node reading opens its chart: CPU and temperature the CPU chart, memory, disk and pools theirs', () => {
  assert.equal(chartOfIssue(node('cpu')), FOCUS.cpu);
  assert.equal(chartOfIssue(node('temp')), FOCUS.cpu);
  assert.equal(chartOfIssue(node('mem')), FOCUS.memory);
  assert.equal(chartOfIssue(node('disk')), FOCUS.runway);
  assert.equal(chartOfIssue(node('pool:local-lvm')), FOCUS.runway);
});

test('a node amber or red for a drive opens Drives; one that is not does not', () => {
  const drives = [
    { device: 'sda', state: 'ok' },
    { device: 'sdb', state: 'warn' },
  ];
  assert.equal(chartOfIssue(node(undefined, { drives })), FOCUS.drives);
  assert.equal(chartOfIssue(node(undefined, { drives: [{ device: 'sda', state: 'ok' }] })), null);
  // Its own reading wins over a drive.
  assert.equal(chartOfIssue(node('cpu', { drives })), FOCUS.cpu);
});

test('the UPS on battery opens Power draw; one with no signal does not', () => {
  assert.equal(chartOfIssue({ kind: 'ups', state: 'crit' }), FOCUS.power);
  assert.equal(chartOfIssue({ kind: 'ups', state: 'unknown' }), null);
});

test('a node down, a service, a source, a job and an integration open nothing', () => {
  assert.equal(chartOfIssue({ kind: 'node', state: 'crit' }), null);
  for (const kind of ['service', 'source', 'job', 'backup', 'integration', 'agent']) {
    assert.equal(chartOfIssue({ kind, state: 'crit', metric: { name: 'cpu' } }), null, kind);
  }
  assert.equal(chartOfIssue(null), null);
  assert.equal(chartOfIssue(undefined), null);
});

test('the link is the page with the chart id in `focus`', () => {
  assert.equal(FOCUS_PARAM, 'focus');
  assert.equal(focusHref('cpu-overview'), '/monitoring?focus=cpu-overview');
  assert.equal(
    focusHref('cpu-overview', 'nodes/pi-2'),
    '/monitoring?focus=cpu-overview&issue=nodes%2Fpi-2'
  );
  assert.equal(Object.keys(FOCUS).length, 9);
});

test('every chart the server serves is one the table can name', () => {
  const named = new Set(Object.values(FOCUS));
  for (const id of Object.keys(MONITORING_CHARTS)) assert.ok(named.has(id), id);
});
