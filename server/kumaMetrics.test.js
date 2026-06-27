/**
 * Tests for the Uptime Kuma /metrics parser. Fixtures mirror REAL output from a
 * live Kuma 2.3.2 instance — including the dynamic per-monitor tag label
 * (`Infrastructure=""` etc.), `monitor_hostname="null"` literals, names with
 * double-spaces/parens, and the 1d/30d/365d uptime_ratio triple.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePromLine, parseKumaMetrics } from './kumaMetrics.js';

// ── parsePromLine ──────────────────────────────────────────────────────────

test('parsePromLine: metric name, labels, integer value', () => {
  const r = parsePromLine('monitor_status{monitor_id="2",monitor_name="Vaultwarden"} 1');
  assert.deepEqual(r, {
    name: 'monitor_status',
    labels: { monitor_id: '2', monitor_name: 'Vaultwarden' },
    value: 1,
  });
});

test('parsePromLine: float value + window label', () => {
  const r = parsePromLine('monitor_uptime_ratio{monitor_id="2",window="30d"} 0.999952767806537');
  assert.equal(r.value, 0.999952767806537);
  assert.equal(r.labels.window, '30d');
});

test('parsePromLine: leading dynamic tag label with empty value', () => {
  const line =
    'monitor_uptime_ratio{Infrastructure="",monitor_id="13",monitor_name="Uptime Kuma",monitor_type="http",monitor_url="https://kuma.jagbhandal.com",monitor_hostname="null",monitor_port="null",window="1d"} 1';
  const r = parsePromLine(line);
  assert.equal(r.labels.Infrastructure, '');
  assert.equal(r.labels.monitor_id, '13');
  assert.equal(r.labels.monitor_name, 'Uptime Kuma');
  assert.equal(r.labels.window, '1d');
  assert.equal(r.value, 1);
});

test('parsePromLine: preserves double-spaces and parens in names', () => {
  const r = parsePromLine('monitor_status{monitor_id="7",monitor_name="Dockge Pi  Primary"} 1');
  assert.equal(r.labels.monitor_name, 'Dockge Pi  Primary');
  const r2 = parsePromLine('monitor_status{monitor_id="9",monitor_name="Dockge (Staging)"} 0');
  assert.equal(r2.labels.monitor_name, 'Dockge (Staging)');
  assert.equal(r2.value, 0);
});

test('parsePromLine: unescapes \\\\ \\" \\n in label values', () => {
  const r = parsePromLine('monitor_status{monitor_id="1",monitor_name="a\\"b\\\\c\\nd"} 1');
  assert.equal(r.labels.monitor_name, 'a"b\\c\nd');
});

test('parsePromLine: a comma inside a quoted value is not a separator', () => {
  const r = parsePromLine('monitor_status{monitor_id="1",monitor_name="a, b, c"} 1');
  assert.equal(r.labels.monitor_name, 'a, b, c');
  assert.equal(r.labels.monitor_id, '1');
});

test('parsePromLine: skips comments and blank lines', () => {
  assert.equal(parsePromLine('# HELP monitor_status Monitor Status'), null);
  assert.equal(parsePromLine('# TYPE monitor_status gauge'), null);
  assert.equal(parsePromLine(''), null);
  assert.equal(parsePromLine('   '), null);
});

test('parsePromLine: NaN / +Inf / -Inf', () => {
  assert.ok(Number.isNaN(parsePromLine('monitor_response_time{monitor_id="1"} NaN').value));
  assert.equal(parsePromLine('monitor_response_time{monitor_id="1"} +Inf').value, Infinity);
  assert.equal(parsePromLine('monitor_response_time{monitor_id="1"} -Inf').value, -Infinity);
});

test('parsePromLine: metric without labels', () => {
  assert.deepEqual(parsePromLine('process_cpu_seconds_total 1.23'), {
    name: 'process_cpu_seconds_total',
    labels: {},
    value: 1.23,
  });
});

test('parsePromLine: ignores a trailing timestamp token', () => {
  const r = parsePromLine('monitor_status{monitor_id="1"} 1 1700000000000');
  assert.equal(r.value, 1);
});

// ── parseKumaMetrics ───────────────────────────────────────────────────────

const SAMPLE = `# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)
# TYPE monitor_status gauge
monitor_status{ProductionServices="",monitor_id="2",monitor_name="Vaultwarden",monitor_type="http",monitor_url="https://vault.jagbhandal.com",monitor_hostname="null",monitor_port="null"} 1
monitor_status{Infrastructure="",monitor_id="10",monitor_name="Proxmox UI",monitor_type="http",monitor_url="http://192.168.68.10:8006",monitor_hostname="null",monitor_port="null"} 0
# HELP monitor_response_time Monitor Response Time (ms)
# TYPE monitor_response_time gauge
monitor_response_time{ProductionServices="",monitor_id="2",monitor_name="Vaultwarden",monitor_type="http",monitor_url="https://vault.jagbhandal.com",monitor_hostname="null",monitor_port="null"} 137
monitor_response_time_seconds{ProductionServices="",monitor_id="2",monitor_name="Vaultwarden",monitor_type="http",monitor_url="https://vault.jagbhandal.com",monitor_hostname="null",monitor_port="null",window="1d"} 0.140
# HELP monitor_uptime_ratio Uptime ratio over the window label (0.0 - 1.0)
# TYPE monitor_uptime_ratio gauge
monitor_uptime_ratio{ProductionServices="",monitor_id="2",monitor_name="Vaultwarden",monitor_type="http",monitor_url="https://vault.jagbhandal.com",monitor_hostname="null",monitor_port="null",window="1d"} 1
monitor_uptime_ratio{ProductionServices="",monitor_id="2",monitor_name="Vaultwarden",monitor_type="http",monitor_url="https://vault.jagbhandal.com",monitor_hostname="null",monitor_port="null",window="30d"} 0.999952767806537
monitor_uptime_ratio{ProductionServices="",monitor_id="2",monitor_name="Vaultwarden",monitor_type="http",monitor_url="https://vault.jagbhandal.com",monitor_hostname="null",monitor_port="null",window="365d"} 0.9966215920528642`;

test('parseKumaMetrics: assembles the monitor map keyed by id', () => {
  const m = parseKumaMetrics(SAMPLE);
  assert.equal(m[2].id, 2);
  assert.equal(typeof m[2].id, 'number');
  assert.equal(m[2].name, 'Vaultwarden');
  assert.equal(m[2].status, 'up');
  assert.equal(m[2].ping, 137);
  assert.equal(m[2].uptime24, 1);
  assert.equal(m[2].active, true);
  assert.equal(m[2].lastBeatAt, null);
});

test('parseKumaMetrics: status 0 → down', () => {
  assert.equal(parseKumaMetrics(SAMPLE)[10].status, 'down');
});

test('parseKumaMetrics: ping uses ms response_time, NOT response_time_seconds', () => {
  assert.equal(parseKumaMetrics(SAMPLE)[2].ping, 137);
});

test('parseKumaMetrics: uptime24 takes window=1d, ignores 30d/365d', () => {
  assert.equal(parseKumaMetrics(SAMPLE)[2].uptime24, 1);
});

test('parseKumaMetrics: empty / garbage input → no monitors', () => {
  assert.equal(Object.keys(parseKumaMetrics('')).length, 0);
  assert.equal(Object.keys(parseKumaMetrics('garbage\nlines\n# comment')).length, 0);
  assert.equal(Object.keys(parseKumaMetrics(null)).length, 0);
});

test('parseKumaMetrics: series lacking monitor_id are skipped (Kuma < 2.1)', () => {
  const m = parseKumaMetrics('monitor_status{monitor_name="Grafana",monitor_type="http"} 1');
  assert.equal(Object.keys(m).length, 0);
});

test('parseKumaMetrics: pending(2)/maintenance(3) → unknown', () => {
  const m = parseKumaMetrics(
    'monitor_status{monitor_id="1",monitor_name="X"} 2\nmonitor_status{monitor_id="3",monitor_name="Y"} 3'
  );
  assert.equal(m[1].status, 'unknown');
  assert.equal(m[3].status, 'unknown');
});

test('parseKumaMetrics: NaN response_time → ping null', () => {
  const m = parseKumaMetrics(
    'monitor_status{monitor_id="1",monitor_name="X"} 1\nmonitor_response_time{monitor_id="1"} NaN'
  );
  assert.equal(m[1].ping, null);
});

test('parseKumaMetrics: a monitor_id of __proto__ cannot pollute Object.prototype', () => {
  const m = parseKumaMetrics(
    'monitor_status{monitor_id="__proto__",monitor_name="PWNED"} 1\n' +
      'monitor_response_time{monitor_id="__proto__"} 99999\n' +
      'monitor_uptime_ratio{monitor_id="__proto__",window="1d"} 0.5'
  );
  // A fresh object must inherit nothing from the crafted input.
  const probe = {};
  assert.equal(probe.status, undefined);
  assert.equal(probe.name, undefined);
  assert.equal(probe.ping, undefined);
  assert.equal(probe.uptime24, undefined);
  // And the crafted series are dropped, not stored.
  assert.equal(Object.keys(m).length, 0);
});

test('parseKumaMetrics: Number()-collision ids ("5e3", " 5000") are rejected', () => {
  const m = parseKumaMetrics(
    'monitor_status{monitor_id="5e3",monitor_name="A"} 1\n' +
      'monitor_status{monitor_id=" 5000",monitor_name="B"} 0'
  );
  assert.equal(Object.keys(m).length, 0);
});
