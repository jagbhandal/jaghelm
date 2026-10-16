import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseExpectedEvery, graceSeconds, isOverdue, decorateStatuses,
  MIN_EXPECTED_EVERY_SECONDS, MAX_EXPECTED_EVERY_SECONDS,
} from './cron-overdue.js';

test('bounds constants', () => {
  assert.equal(MIN_EXPECTED_EVERY_SECONDS, 60);
  assert.equal(MAX_EXPECTED_EVERY_SECONDS, 2678400);
});

test('parseExpectedEvery accepts integers and digit strings in range', () => {
  for (const [input, n] of [[86400, 86400], ['86400', 86400], [60, 60], [2678400, 2678400]]) {
    assert.deepEqual(parseExpectedEvery(input), { ok: true, value: n });
  }
});

test('parseExpectedEvery treats null/undefined as absent', () => {
  assert.deepEqual(parseExpectedEvery(undefined), { ok: true, value: undefined });
  assert.deepEqual(parseExpectedEvery(null), { ok: true, value: undefined });
});

test('parseExpectedEvery rejects everything else', () => {
  for (const bad of [59, 2678401, 86400.5, '24h', '', true, -1, '59', '-1', '1.5', ' 86400', {}, NaN]) {
    assert.deepEqual(parseExpectedEvery(bad), { ok: false }, String(bad));
  }
});

test('graceSeconds is max(25% of interval, 600)', () => {
  assert.equal(graceSeconds(86400), 21600);
  assert.equal(graceSeconds(900), 600);
});

test('isOverdue: daily job boundary', () => {
  const run = { timestamp: '2026-10-16T02:00:00.000Z', expected_every_seconds: 86400 };
  const edge = Date.parse('2026-10-17T08:00:00.000Z');
  assert.equal(isOverdue(run, edge), false);
  assert.equal(isOverdue(run, edge + 1), true);
});

test('isOverdue: short job uses the 600 s grace floor', () => {
  const ts = '2026-10-16T02:00:00.000Z';
  const run = { timestamp: ts, expected_every_seconds: 900 };
  const edge = Date.parse(ts) + 1500 * 1000;
  assert.equal(isOverdue(run, edge), false);
  assert.equal(isOverdue(run, edge + 1), true);
});

test('isOverdue: false without a clock, run, interval or valid timestamp', () => {
  const run = { timestamp: '2026-10-16T02:00:00.000Z', expected_every_seconds: 900 };
  assert.equal(isOverdue(run, null), false);
  assert.equal(isOverdue(undefined, Date.now()), false);
  assert.equal(isOverdue({ timestamp: run.timestamp }, Date.now() + 1e12), false);
  assert.equal(isOverdue({ timestamp: 'nope', expected_every_seconds: 900 }, Date.now()), false);
});

test('decorateStatuses adds fields without mutating input', () => {
  const now = Date.parse('2026-10-16T02:10:00.500Z');
  const statuses = [{
    node: 'n',
    jobs: [
      { job: 'a', runs: [{ status: 'success', timestamp: '2026-10-16T02:00:00.000Z', expected_every_seconds: 900 }] },
      { job: 'b', runs: [{ status: 'success', timestamp: '2026-10-16T02:00:00.000Z' }] },
    ],
  }];
  const snapshot = JSON.parse(JSON.stringify(statuses));
  const out = decorateStatuses(statuses, now);
  assert.deepEqual(statuses, snapshot);
  assert.notEqual(out, statuses);
  assert.deepEqual(out[0].jobs[0], { ...snapshot[0].jobs[0], overdue: false, seconds_since_report: 600, expected_every_seconds: 900 });
  assert.equal(out[0].jobs[1].overdue, false);
  assert.equal(out[0].jobs[1].seconds_since_report, 600);
  assert.equal('expected_every_seconds' in out[0].jobs[1], false);
});
