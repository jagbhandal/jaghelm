/**
 * #239: the per-integration retry state the refresh loop keeps. A failing
 * integration used to be fetched every cycle, and a rejected login sent again
 * every cycle, forever. These tests drive the state machine with explicit
 * times; refresh.integrations.test.js drives it through the real refresh with a
 * mocked clock.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  backoffDelayMs,
  createIntegrationBackoff,
} from './backoff.js';

const T0 = 1_800_000_000_000;
const S = 1000;
const MIN = 60 * S;
const failed = (msg = 'HTTP 502 Bad Gateway') => ({ _error: msg, _preset: 'custom' });
const good = () => ({ Up: 'yes', _preset: 'custom' });

test('the delay doubles from 30 s per failure, up to 10 min', () => {
  assert.equal(BACKOFF_BASE_MS, 30 * S);
  assert.equal(BACKOFF_MAX_MS, 10 * MIN);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 50].map(backoffDelayMs), [
    30 * S,
    1 * MIN,
    2 * MIN,
    4 * MIN,
    8 * MIN,
    10 * MIN,
    10 * MIN,
    10 * MIN,
  ]);
});

test('an integration never seen, or ok, is attempted every cycle', () => {
  const b = createIntegrationBackoff();
  assert.equal(b.held('a', 'fp', T0), null);
  b.record('a', 'fp', good(), {}, T0);
  assert.equal(b.held('a', 'fp', T0 + 1), null);
});

test('a success carries an ok status that does not change from cycle to cycle', () => {
  const b = createIntegrationBackoff();
  const first = b.record('a', 'fp', good(), {}, T0);
  const second = b.record('a', 'fp', good(), {}, T0 + 30 * S);
  const want = { state: 'ok', since: T0, failures: 0, nextAttemptAt: null };
  assert.deepEqual(first._status, want);
  assert.deepEqual(second._status, want, 'steady state keeps the ETag: nothing in _status moves');
  assert.equal(second.Up, 'yes');
});

test('a failure holds the entry until its next attempt is due, and the held entry is the one the failure left', () => {
  const b = createIntegrationBackoff();
  const entry = b.record('a', 'fp', failed(), {}, T0);
  assert.deepEqual(entry._status, {
    state: 'backing_off',
    since: T0,
    failures: 1,
    nextAttemptAt: T0 + 30 * S,
  });
  assert.equal(entry._error, 'HTTP 502 Bad Gateway', 'the failure is still served as it is today');
  assert.equal(entry._preset, 'custom');

  assert.equal(b.held('a', 'fp', T0 + 10 * S), entry, 'not due: the same entry, nothing fetched');
  assert.equal(b.held('a', 'fp', T0 + 30 * S), null, 'due at 30 s');
});

test('a cycle that fires a moment early still makes the attempt', () => {
  const b = createIntegrationBackoff();
  b.record('a', 'fp', failed(), {}, T0);
  assert.equal(b.held('a', 'fp', T0 + 30 * S - 5), null);
});

test('consecutive failures back off 30 s, 1, 2, 4, 8, then 10 min, and since stays at the first failure', () => {
  const b = createIntegrationBackoff();
  let now = T0;
  const gaps = [];
  for (let i = 0; i < 8; i++) {
    const { _status } = b.record('a', 'fp', failed(), {}, now);
    assert.equal(_status.failures, i + 1);
    assert.equal(_status.since, T0);
    gaps.push(_status.nextAttemptAt - now);
    now = _status.nextAttemptAt;
  }
  assert.deepEqual(gaps, [
    30 * S,
    1 * MIN,
    2 * MIN,
    4 * MIN,
    8 * MIN,
    10 * MIN,
    10 * MIN,
    10 * MIN,
  ]);
});

test('a success resets the backoff: the next failure waits 30 s again', () => {
  const b = createIntegrationBackoff();
  let now = T0;
  for (let i = 0; i < 4; i++) now = b.record('a', 'fp', failed(), {}, now)._status.nextAttemptAt;
  const ok = b.record('a', 'fp', good(), {}, now);
  assert.deepEqual(ok._status, { state: 'ok', since: now, failures: 0, nextAttemptAt: null });
  assert.equal(ok._error, undefined);
  const again = b.record('a', 'fp', failed(), {}, now + 30 * S);
  assert.deepEqual(again._status, {
    state: 'backing_off',
    since: now + 30 * S,
    failures: 1,
    nextAttemptAt: now + 60 * S,
  });
});

test('a rejected login is not retried while the config is the same, however long it waits', () => {
  const b = createIntegrationBackoff();
  const entry = b.record('a', 'fp', failed('Login returned HTTP 401'), { authRejected: true }, T0);
  assert.deepEqual(entry._status, {
    state: 'auth_failed',
    since: T0,
    failures: 1,
    nextAttemptAt: null,
  });
  for (const later of [30 * S, 10 * MIN, 24 * 60 * MIN]) {
    assert.equal(b.held('a', 'fp', T0 + later), entry);
  }
});

test('a changed config retries at once, from a clean slate', () => {
  const b = createIntegrationBackoff();
  b.record('a', 'fp1', failed('Login returned HTTP 401'), { authRejected: true }, T0);
  assert.equal(b.held('a', 'fp2', T0 + 1), null, 'auth failed, new config: attempted now');
  const next = b.record('a', 'fp2', failed(), {}, T0 + 1);
  assert.deepEqual(next._status, {
    state: 'backing_off',
    since: T0 + 1,
    failures: 1,
    nextAttemptAt: T0 + 1 + 30 * S,
  });

  // Backing off with a long wait ahead, then the config changes: no wait either.
  let now = T0;
  for (let i = 0; i < 5; i++) now = b.record('b', 'x', failed(), {}, now)._status.nextAttemptAt;
  assert.notEqual(b.held('b', 'x', now - 5 * MIN), null);
  assert.equal(b.held('b', 'y', now - 5 * MIN), null);
});

test('a login rejected after a run of other failures keeps counting failures', () => {
  const b = createIntegrationBackoff();
  b.record('a', 'fp', failed(), {}, T0);
  const entry = b.record(
    'a',
    'fp',
    failed('Login returned HTTP 403'),
    { authRejected: true },
    T0 + 30 * S
  );
  assert.deepEqual(entry._status, {
    state: 'auth_failed',
    since: T0 + 30 * S,
    failures: 2,
    nextAttemptAt: null,
  });
});

test('retryNow makes the next cycle attempt it, from a clean slate; retain drops the state of integrations no longer configured', () => {
  const b = createIntegrationBackoff();
  b.record('a', 'fp', failed('Login returned HTTP 401'), { authRejected: true }, T0);
  b.record('b', 'fp', failed('Login returned HTTP 401'), { authRejected: true }, T0);
  b.retryNow('a');
  assert.equal(b.held('a', 'fp', T0 + 1), null);
  const next = b.record('a', 'fp', failed(), {}, T0 + 1);
  assert.equal(next._status.failures, 1);

  // Even for an integration whose config could not be fingerprinted.
  b.record('n', null, failed('Login returned HTTP 401'), { authRejected: true }, T0);
  assert.notEqual(b.held('n', null, T0 + 1), null);
  b.retryNow('n');
  assert.equal(b.held('n', null, T0 + 1), null);

  b.retain(['a']);
  assert.equal(b.held('b', 'fp', T0 + 1), null, 'b was removed, so a b added back starts fresh');
  assert.equal(b.record('b', 'fp', failed(), {}, T0 + 1)._status.failures, 1);
});

test('each rejected login warns; a recovery after failures logs once, a config change included', () => {
  const lines = [];
  const logger = {
    warn: (fields, msg) => lines.push(['warn', fields, msg]),
    info: (fields, msg) => lines.push(['info', fields, msg]),
  };
  const b = createIntegrationBackoff({ logger });
  b.record('a', 'fp', failed('Login returned HTTP 401'), { authRejected: true }, T0);
  b.retryNow('a'); // as a save in Settings does
  b.record('a', 'fp', failed('Login returned HTTP 401'), { authRejected: true }, T0 + 1);
  b.record('a', 'fp2', good(), {}, T0 + 2);
  b.record('a', 'fp2', good(), {}, T0 + 3);
  b.record('c', 'fp', good(), {}, T0 + 3);
  assert.deepEqual(
    lines.map(([level, , msg]) => [level, msg]),
    [
      ['warn', 'integration login rejected; not retrying until its config changes'],
      ['warn', 'integration login rejected; not retrying until its config changes'],
      ['info', 'integration recovered'],
    ]
  );
  assert.equal(lines[0][1].key, 'a');
  assert.equal(lines[0][1].error, 'Login returned HTTP 401');
  assert.deepEqual(lines[2][1], { key: 'a', failures: 1 });
});
