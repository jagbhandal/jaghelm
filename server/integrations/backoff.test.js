/**
 * #239: the per-integration retry state the refresh loop keeps. A failing
 * integration used to be fetched every cycle, and a refused login sent again
 * every cycle, forever. These tests drive the state machine with explicit
 * times; refresh.integrations.test.js drives it through the real refresh with a
 * mocked clock.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  PARKED_HINT,
  REJECTIONS_TO_PARK,
  backoffDelayMs,
  createIntegrationBackoff,
} from './backoff.js';

const T0 = 1_800_000_000_000;
const S = 1000;
const MIN = 60 * S;
/** A cycle `ms` after the first: both clocks moved on by `ms`, unless `wall` says otherwise. */
const at = (ms, wall = T0 + ms) => ({ wall, mono: ms });
const failed = (msg = 'HTTP 502 Bad Gateway') => ({ _error: msg, _preset: 'custom' });
const good = () => ({ Up: 'yes', _preset: 'custom' });
const REFUSED = { authRejected: true };

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
  assert.equal(b.held('a', 'fp', at(0)), null);
  b.record('a', 'fp', good(), {}, at(0));
  assert.equal(b.held('a', 'fp', at(1)), null);
});

test('a success carries an ok status that does not change from cycle to cycle', () => {
  const b = createIntegrationBackoff();
  const first = b.record('a', 'fp', good(), {}, at(0));
  const second = b.record('a', 'fp', good(), {}, at(30 * S));
  const want = { state: 'ok', since: T0, failures: 0, nextAttemptAt: null };
  assert.deepEqual(first._status, want);
  assert.deepEqual(second._status, want, 'steady state keeps the ETag: nothing in _status moves');
  assert.equal(second.Up, 'yes');
});

test('a failure holds the entry until its next attempt is due, and the held entry is the one the failure left', () => {
  const b = createIntegrationBackoff();
  const entry = b.record('a', 'fp', failed(), {}, at(0));
  assert.deepEqual(entry._status, {
    state: 'backing_off',
    since: T0,
    failures: 1,
    nextAttemptAt: T0 + 30 * S,
  });
  assert.equal(entry._error, 'HTTP 502 Bad Gateway', 'the failure is still served as it is today');
  assert.equal(entry._preset, 'custom');

  assert.equal(b.held('a', 'fp', at(10 * S)), entry, 'not due: the same entry, nothing fetched');
  assert.equal(b.held('a', 'fp', at(30 * S)), null, 'due at 30 s');
});

test('a cycle up to 1 s early still makes the attempt; one 1.5 s early waits', () => {
  const b = createIntegrationBackoff();
  const entry = b.record('a', 'fp', failed(), {}, at(0));
  assert.equal(b.held('a', 'fp', at(30 * S - 5)), null);
  assert.equal(b.held('a', 'fp', at(30 * S - 1 * S)), null);
  assert.equal(b.held('a', 'fp', at(30 * S - 1.5 * S)), entry);
});

test('consecutive failures back off 30 s, 1, 2, 4, 8, then 10 min, and since stays at the first failure', () => {
  const b = createIntegrationBackoff();
  let t = 0;
  const gaps = [];
  for (let i = 0; i < 8; i++) {
    const { _status } = b.record('a', 'fp', failed(), {}, at(t));
    assert.equal(_status.failures, i + 1);
    assert.equal(_status.since, T0);
    gaps.push(_status.nextAttemptAt - (T0 + t));
    t = _status.nextAttemptAt - T0;
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

test('with a 45 s refresh interval, each wait is the delay rounded up to whole cycles', () => {
  const b = createIntegrationBackoff();
  const attempts = [];
  for (let t = 0; t <= 1700 * S; t += 45 * S) {
    if (b.held('a', 'fp', at(t))) continue;
    attempts.push(t / S);
    b.record('a', 'fp', failed(), {}, at(t));
  }
  // 30 s, 1, 2, 4, 8 and 10 min, each rounded up to a multiple of 45 s.
  assert.deepEqual(attempts, [0, 45, 135, 270, 540, 1035, 1665]);
});

test('a success resets the backoff: the next failure waits 30 s again', () => {
  const b = createIntegrationBackoff();
  let t = 0;
  for (let i = 0; i < 4; i++)
    t = b.record('a', 'fp', failed(), {}, at(t))._status.nextAttemptAt - T0;
  const ok = b.record('a', 'fp', good(), {}, at(t));
  assert.deepEqual(ok._status, { state: 'ok', since: T0 + t, failures: 0, nextAttemptAt: null });
  assert.equal(ok._error, undefined);
  const again = b.record('a', 'fp', failed(), {}, at(t + 30 * S));
  assert.deepEqual(again._status, {
    state: 'backing_off',
    since: T0 + t + 30 * S,
    failures: 1,
    nextAttemptAt: T0 + t + 60 * S,
  });
});

test('a first refused login backs off like any failure; the second in a row parks it with a hint, however long it waits', () => {
  assert.equal(REJECTIONS_TO_PARK, 2);
  const b = createIntegrationBackoff();
  const first = b.record('a', 'fp', failed('HTTP 401'), REFUSED, at(0));
  assert.deepEqual(first._status, {
    state: 'backing_off',
    since: T0,
    failures: 1,
    nextAttemptAt: T0 + 30 * S,
  });
  assert.equal(first._error, 'HTTP 401', 'no hint: it is retried on its own');
  assert.equal(b.held('a', 'fp', at(30 * S)), null, 'retried 30 s on, as any failure is');

  const parked = b.record('a', 'fp', failed('HTTP 401'), REFUSED, at(30 * S));
  assert.deepEqual(parked._status, {
    state: 'auth_failed',
    since: T0 + 30 * S,
    failures: 2,
    nextAttemptAt: null,
  });
  assert.equal(parked._error, `HTTP 401 (${PARKED_HINT.file})`);
  for (const later of [1 * MIN, 10 * MIN, 24 * 60 * MIN]) {
    assert.equal(b.held('a', 'fp', at(later)), parked);
  }
});

test('the hint says how to retry: a save in Settings for an entry Settings wrote, the file or a restart otherwise', () => {
  assert.equal(
    PARKED_HINT.settings,
    'login refused twice; not retried until it is saved in Settings'
  );
  assert.equal(
    PARKED_HINT.file,
    'login refused twice; not retried until services.yaml changes or JagHelm restarts'
  );
  const b = createIntegrationBackoff();
  const outcome = { authRejected: true, savedFromSettings: true };
  b.record('g', 'fp', failed('All session auth methods failed'), outcome, at(0));
  const parked = b.record(
    'g',
    'fp',
    failed('All session auth methods failed'),
    outcome,
    at(30 * S)
  );
  assert.equal(
    parked._error,
    'All session auth methods failed (login refused twice; not retried until it is saved in Settings)'
  );
});

test('any other outcome between two refused logins starts the count again', () => {
  const b = createIntegrationBackoff();
  // Refused, then a timeout, then refused: the second refusal is the first in a row.
  b.record('a', 'fp', failed('HTTP 403'), REFUSED, at(0));
  b.record('a', 'fp', failed('connect ETIMEDOUT'), {}, at(30 * S));
  const third = b.record('a', 'fp', failed('HTTP 403'), REFUSED, at(90 * S));
  assert.equal(third._status.state, 'backing_off');
  assert.equal(third._status.failures, 3, 'the failures still count toward the backoff');
  assert.equal(third._status.nextAttemptAt, T0 + 90 * S + 2 * MIN);
  const fourth = b.record('a', 'fp', failed('HTTP 403'), REFUSED, at(210 * S));
  assert.equal(fourth._status.state, 'auth_failed');
  assert.equal(fourth._status.failures, 4);

  // Refused, then a success, then refused: backing off again, not parked.
  b.record('b', 'fp', failed('HTTP 401'), REFUSED, at(0));
  b.record('b', 'fp', good(), {}, at(30 * S));
  const after = b.record('b', 'fp', failed('HTTP 401'), REFUSED, at(60 * S));
  assert.deepEqual(after._status, {
    state: 'backing_off',
    since: T0 + 60 * S,
    failures: 1,
    nextAttemptAt: T0 + 90 * S,
  });
});

test('a changed config retries at once, from a clean slate', () => {
  const b = createIntegrationBackoff();
  b.record('a', 'fp1', failed('HTTP 401'), REFUSED, at(0));
  b.record('a', 'fp1', failed('HTTP 401'), REFUSED, at(30 * S));
  assert.equal(b.held('a', 'fp2', at(31 * S)), null, 'auth failed, new config: attempted now');
  const next = b.record('a', 'fp2', failed('HTTP 401'), REFUSED, at(31 * S));
  assert.deepEqual(
    next._status,
    { state: 'backing_off', since: T0 + 31 * S, failures: 1, nextAttemptAt: T0 + 61 * S },
    'the new config gets its own two attempts'
  );

  // Backing off with a long wait ahead, then the config changes: no wait either.
  let t = 0;
  for (let i = 0; i < 5; i++)
    t = b.record('b', 'x', failed(), {}, at(t))._status.nextAttemptAt - T0;
  assert.notEqual(b.held('b', 'x', at(t - 5 * MIN)), null);
  assert.equal(b.held('b', 'y', at(t - 5 * MIN)), null);
});

test('retryNow makes the next cycle attempt it, from a clean slate; retain drops the state of integrations no longer configured', () => {
  const b = createIntegrationBackoff();
  const park = (key, fp) => {
    b.record(key, fp, failed('HTTP 401'), REFUSED, at(0));
    return b.record(key, fp, failed('HTTP 401'), REFUSED, at(30 * S));
  };
  park('a', 'fp');
  park('b', 'fp');
  b.retryNow('a', 40 * S);
  assert.equal(b.held('a', 'fp', at(41 * S)), null);
  const next = b.record('a', 'fp', failed('HTTP 401'), REFUSED, at(41 * S));
  assert.equal(next._status.state, 'backing_off', 'a fresh pair of attempts');
  assert.equal(next._status.failures, 1);
  assert.equal(
    b.record('a', 'fp', failed('HTTP 401'), REFUSED, at(71 * S))._status.state,
    'auth_failed'
  );

  // Even for an integration whose config could not be fingerprinted.
  const n = park('n', null);
  assert.equal(b.held('n', null, at(41 * S)), n);
  b.retryNow('n', 41 * S);
  assert.equal(b.held('n', null, at(42 * S)), null);

  b.retain(['a']);
  assert.equal(
    b.held('b', 'fp', at(42 * S)),
    null,
    'b was removed, so a b added back starts fresh'
  );
  assert.equal(b.record('b', 'fp', failed(), {}, at(42 * S))._status.failures, 1);
});

test('a retryNow while the attempt is in flight is not lost when that attempt is refused', () => {
  const b = createIntegrationBackoff();
  // The first refusal: backing off, retried at 30 s.
  b.record('a', 'fp', failed('HTTP 401'), REFUSED, at(0));
  // The cycle at 30 s makes the attempt; while its login is in flight the user
  // saves in Settings (after fixing the password on the app's side).
  const cycle = at(30 * S);
  assert.equal(b.held('a', 'fp', cycle), null);
  b.retryNow('a', 30 * S + 500);
  const parked = b.record('a', 'fp', failed('HTTP 401'), REFUSED, cycle);
  assert.equal(parked._status.state, 'auth_failed', 'the attempt in flight still counts');
  // The save asked for another attempt: the next cycle makes it.
  assert.equal(b.held('a', 'fp', at(60 * S)), null);
  const retried = b.record('a', 'fp', good(), {}, at(60 * S));
  assert.equal(retried._status.state, 'ok');
  assert.equal(b.held('a', 'fp', at(90 * S)), null);
});

test('a save before an attempt and another during it: the attempt starts clean, and one more follows', () => {
  const b = createIntegrationBackoff();
  b.record('a', 'fp', failed('HTTP 401'), REFUSED, at(0));
  b.record('a', 'fp', failed('HTTP 401'), REFUSED, at(30 * S)); // parked
  b.retryNow('a', 40 * S);
  const cycle = at(60 * S);
  assert.equal(b.held('a', 'fp', cycle), null);
  b.retryNow('a', 60 * S + 200);
  const entry = b.record('a', 'fp', failed('HTTP 401'), REFUSED, cycle);
  assert.deepEqual(
    entry._status,
    { state: 'backing_off', since: T0 + 60 * S, failures: 1, nextAttemptAt: T0 + 90 * S },
    'the first attempt after the first save: a clean slate'
  );
  assert.equal(
    b.held('a', 'fp', at(61 * S)),
    null,
    'the second save: attempted before its 30 s are up'
  );
  const again = b.record('a', 'fp', failed('HTTP 401'), REFUSED, at(61 * S));
  assert.equal(again._status.failures, 1, 'and from a clean slate too');
  assert.equal(again._status.state, 'backing_off');
});

test('whether an attempt is due follows the monotonic clock: a wall-clock step neither holds nor hurries it', () => {
  const b = createIntegrationBackoff();
  const entry = b.record('a', 'fp', failed(), {}, at(0));
  assert.equal(entry._status.nextAttemptAt, T0 + 30 * S, 'the payload shows wall-clock time');

  // NTP steps the wall clock back an hour; 30 s have passed: due all the same.
  assert.equal(b.held('a', 'fp', at(30 * S, T0 - 60 * MIN)), null);
  // The wall clock jumps an hour ahead after 10 s: not due yet.
  assert.equal(b.held('a', 'fp', at(10 * S, T0 + 60 * MIN)), entry);

  // The next failure's times come from the wall clock at that cycle, once.
  const next = b.record('a', 'fp', failed(), {}, at(30 * S, T0 - 60 * MIN));
  assert.deepEqual(next._status, {
    state: 'backing_off',
    since: T0,
    failures: 2,
    nextAttemptAt: T0 - 60 * MIN + 1 * MIN,
  });
  assert.equal(
    b.held('a', 'fp', at(30 * S + 59 * S, T0)),
    null,
    'due 1 min later on the monotonic clock'
  );
  assert.equal(b.held('a', 'fp', at(30 * S + 58 * S, T0)), next);
});

test('parking warns once per park; a recovery after failures logs once, a config change included', () => {
  const lines = [];
  const logger = {
    warn: (fields, msg) => lines.push(['warn', fields, msg]),
    info: (fields, msg) => lines.push(['info', fields, msg]),
  };
  const b = createIntegrationBackoff({ logger });
  b.record('a', 'fp', failed('Login returned HTTP 401'), REFUSED, at(0));
  b.record('a', 'fp', failed('Login returned HTTP 401'), REFUSED, at(30 * S));
  b.retryNow('a', 31 * S); // as a save in Settings does
  b.record('a', 'fp', failed('Login returned HTTP 401'), REFUSED, at(32 * S));
  b.record('a', 'fp', failed('Login returned HTTP 401'), REFUSED, at(62 * S));
  b.record('a', 'fp2', good(), {}, at(63 * S));
  b.record('a', 'fp2', good(), {}, at(64 * S));
  b.record('c', 'fp', good(), {}, at(64 * S));
  assert.deepEqual(
    lines.map(([level, , msg]) => [level, msg]),
    [
      ['warn', 'integration login refused twice; not retrying until its config changes'],
      ['warn', 'integration login refused twice; not retrying until its config changes'],
      ['info', 'integration recovered'],
    ]
  );
  assert.deepEqual(lines[0][1], { key: 'a', error: 'Login returned HTTP 401' });
  assert.deepEqual(lines[2][1], { key: 'a', failures: 2 });
});
