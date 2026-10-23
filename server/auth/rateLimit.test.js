/**
 * The login rate limiter (#257): per-address backoff, one bucket for the
 * account, no global lock. Every test runs on a fake clock (createLoginLimiter's
 * `now`), so waits of minutes and hours take no time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LOGIN_LIMITS,
  addressKey,
  createLoginLimiter,
  loginFailureDelay,
} from './rateLimit.js';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const quiet = { warn() {} };

/** A limiter on a fake clock; `advance(ms)` moves it. */
function setup(overrides = {}) {
  let t = 1_000_000;
  const warnings = [];
  const log = { warn: (fields, msg) => warnings.push({ fields, msg }) };
  const limiter = createLoginLimiter({ now: () => t, log, ...overrides });
  return {
    limiter,
    warnings,
    advance: (ms) => (t += ms),
    /** An attempt that fails: let through, never succeeded(). */
    fail: (ip) => limiter.attempt(ip),
  };
}

/** Fresh documentation-range addresses, one per call. */
let next = 0;
const freshIp = () => {
  next++;
  return `10.${(next >> 16) & 255}.${(next >> 8) & 255}.${next & 255}`;
};

/** `n` failures from `ip` that are let through, waiting out each refusal. */
function failThrough({ fail, advance }, ip, n) {
  for (let i = 0; i < n; i++) {
    let a = fail(ip);
    while (!a.ok) {
      advance(a.retryAfterMs);
      a = fail(ip);
    }
  }
}

// ── Per address ──────────────────────────────────────────────────────────

test('an address: 5 failures free, then 30 s doubling to 15 min, each a 429 with the wait', () => {
  const { fail, advance } = setup();
  const ip = '192.0.2.1';
  for (let i = 1; i <= 5; i++) assert.equal(fail(ip).ok, true, `failure ${i} is let through`);

  for (const wait of [30, 60, 120, 240, 480, 900, 900, 900]) {
    const refused = fail(ip);
    assert.equal(refused.ok, false, `waits ${wait} s`);
    assert.equal(refused.reason, 'address');
    assert.equal(refused.retryAfterMs, wait * SEC);
    advance(wait * SEC - 1);
    assert.equal(fail(ip).ok, false, 'still waiting 1 ms before the end');
    advance(1);
    assert.equal(fail(ip).ok, true, `let through after ${wait} s`);
  }
});

test('an address: a sign-in clears it, so its next failures are free again', () => {
  const { limiter, fail } = setup();
  const ip = '192.0.2.2';
  for (let i = 0; i < 4; i++) fail(ip);
  limiter.attempt(ip).succeeded();
  for (let i = 1; i <= 5; i++) assert.equal(fail(ip).ok, true, `failure ${i} after the sign-in`);
  assert.equal(fail(ip).ok, false, 'the 6th waits again');
});

test('an address: a sign-in after the wait clears the backoff it had reached', () => {
  const env = setup();
  const { limiter, fail, advance } = env;
  const ip = '192.0.2.3';
  failThrough(env, ip, 8);
  const waiting = fail(ip);
  assert.equal(waiting.ok, false);
  assert.equal(waiting.retryAfterMs, 240 * SEC, 'four steps in');
  advance(waiting.retryAfterMs);
  limiter.attempt(ip).succeeded();
  for (let i = 1; i <= 5; i++) assert.equal(fail(ip).ok, true);
  assert.equal(fail(ip).retryAfterMs, 30 * SEC, 'starts again at 30 s');
});

test('an address: its failures are forgotten an hour after its last one, and not before', () => {
  const { fail, advance } = setup();
  const kept = '192.0.2.4';
  const forgotten = '192.0.2.40';
  for (let i = 0; i < 5; i++) fail(kept);
  advance(1);
  for (let i = 0; i < 5; i++) fail(forgotten);
  advance(HOUR); // `kept`'s last failure is an hour and 1 ms ago, `forgotten`'s an hour

  assert.equal(fail(forgotten).ok, true, 'an hour on the dot: let through, as its 6th');
  assert.equal(fail(forgotten).retryAfterMs, 60 * SEC, 'still counted: the 6th doubles the wait');
  for (let i = 1; i <= 5; i++) assert.equal(fail(kept).ok, true, `failure ${i} after more than an hour`);
  assert.equal(fail(kept).retryAfterMs, 30 * SEC, 'counted from 1 again');
});

test('a refused attempt changes nothing: hammering during a wait does not lengthen it', () => {
  const { fail, advance } = setup();
  const ip = '192.0.2.5';
  for (let i = 0; i < 5; i++) fail(ip);
  for (let i = 0; i < 1000; i++) {
    advance(10);
    assert.equal(fail(ip).ok, false);
  }
  advance(30 * SEC - 10_000);
  assert.equal(fail(ip).ok, true, 'let through when the first 30 s are up');
});

test('parallel attempts: each is counted as it starts, so a burst cannot all pass one check', () => {
  const { limiter } = setup();
  const ip = '192.0.2.6';
  const burst = Array.from({ length: 20 }, () => limiter.attempt(ip)); // none settled yet
  assert.equal(burst.filter((a) => a.ok).length, 5);
});

// ── No global lock (#257) ────────────────────────────────────────────────

test('failures from one address never make another address wait, however long they go on', () => {
  const { fail, advance } = setup();
  const attacker = '192.0.2.66';
  // The attacker tries every second for 6 hours; every 10 minutes someone
  // else, from an address of their own, tries once (and fails too).
  for (let s = 0; s < 6 * 3600; s++) {
    fail(attacker);
    if (s % 600 === 0) {
      const other = fail(freshIp());
      assert.equal(other.ok, true, `another address at ${s} s`);
    }
    advance(SEC);
  }
});

// ── The account: address rotation ─────────────────────────────────────────

/** Guesses let through in `ms` for an attacker with a new address for every try, every 100 ms. */
function rotate({ fail, advance }, ms) {
  let through = 0;
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    if (fail(freshIp()).ok) through++;
    advance(100);
  }
  return through;
}

test('rotating addresses: at most 10 + 120 guesses in any hour, 10 + 120 an hour over four', () => {
  const env = setup();
  const hours = [1, 2, 3, 4].map(() => rotate(env, HOUR));
  for (const [i, n] of hours.entries()) assert.ok(n <= 130, `hour ${i + 1}: ${n}`);
  const total = hours.reduce((a, b) => a + b, 0);
  assert.ok(total <= 10 + 4 * 120, `four hours: ${total}`);
  assert.ok(hours[0] >= 125, `the bucket, not something tighter: ${hours[0]}`);
});

test('rotating addresses: a refusal waits for the next token, at most 30 s', () => {
  const { fail } = setup();
  for (let i = 0; i < 10; i++) assert.equal(fail(freshIp()).ok, true);
  const refused = fail(freshIp());
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'account');
  assert.ok(refused.retryAfterMs > 0 && refused.retryAfterMs <= 30 * SEC, `${refused.retryAfterMs}`);
});

test('the owner from a clean address gets in after one short wait while the bucket is empty', () => {
  const { limiter, fail, advance } = setup();
  for (let i = 0; i < 10; i++) fail(freshIp()); // the bucket is empty
  const owner = '192.0.2.10';
  const first = limiter.attempt(owner);
  assert.equal(first.ok, false);
  assert.ok(first.retryAfterMs <= 30 * SEC);
  advance(first.retryAfterMs);
  const second = limiter.attempt(owner);
  assert.equal(second.ok, true, 'let through after the wait it was given');
  second.succeeded();
});

test('the owner from an address he signed in from skips an empty bucket', () => {
  const { limiter, fail, advance } = setup();
  const home = '192.0.2.11';
  limiter.attempt(home).succeeded();
  advance(5 * MIN);
  // An attacker with many addresses keeps the bucket empty.
  for (let i = 0; i < 50; i++) fail(freshIp());
  assert.equal(fail(freshIp()).ok, false, 'the bucket is empty');
  const again = limiter.attempt(home);
  assert.equal(again.ok, true, 'his own address is let through');
  again.succeeded();
  assert.equal(limiter.attempt(home).ok, true, 'and again after that sign-in');
});

test('a known address loses the skip at its first failure, so a spoofed one buys one guess', () => {
  const { limiter, fail } = setup();
  const home = '192.0.2.12';
  limiter.attempt(home).succeeded();
  for (let i = 0; i < 10; i++) fail(freshIp()); // empty
  assert.equal(fail(home).ok, true, 'one guess from the known address');
  const after = fail(home);
  assert.equal(after.ok, false, 'then it is one more address');
  assert.equal(after.reason, 'account');
});

test("a sign-in hands back its token: the owner's sign-ins never empty the bucket", () => {
  const { limiter, fail } = setup();
  for (let i = 0; i < 100; i++) limiter.attempt(freshIp()).succeeded();
  for (let i = 0; i < 10; i++) assert.equal(fail(freshIp()).ok, true, `failure ${i + 1}`);
});

test("a sign-in doesn't refill the bucket: the owner signing in hands an attacker nothing", () => {
  const { limiter, fail } = setup();
  const home = '192.0.2.13';
  limiter.attempt(home).succeeded();
  for (let i = 0; i < 10; i++) fail(freshIp());
  limiter.attempt(home).succeeded(); // a known address: took no token, gives none back
  assert.equal(fail(freshIp()).ok, false, 'still empty');
});

// ── Memory ───────────────────────────────────────────────────────────────

test('a flood of fresh addresses: records stay under 146 and the cap, and a waiting address keeps its wait', () => {
  const env = setup();
  const { limiter, fail, advance } = env;
  const victim = '192.0.2.20';
  failThrough(env, victim, 7);
  const before = fail(victim);
  assert.equal(before.retryAfterMs, 120 * SEC);
  // 100,000 fresh addresses in under a minute: the bucket lets 10 or so through.
  for (let i = 0; i < 100_000; i++) {
    fail(freshIp());
    if (i % 2000 === 0) advance(SEC);
  }
  const { addresses } = limiter.stats();
  assert.ok(addresses <= 146 && addresses < LOGIN_LIMITS.maxAddresses, `${addresses} records`);
  const after = fail(victim);
  assert.equal(after.ok, false, 'the victim address still waits');
  assert.equal(after.reason, 'address');

  advance(HOUR + 1);
  fail(freshIp());
  assert.equal(limiter.stats().addresses, 1, 'forgotten records are dropped, not kept to the cap');
});

test('at the smallest cap the limits allow, a flood never passes it nor pushes out a live record', () => {
  // 3 + 10 + 2 = 15 live records at most, so 16 is the smallest cap allowed.
  const small = {
    freeFailures: 2,
    firstWaitMs: SEC,
    maxWaitMs: 4 * SEC,
    forgetMs: 10 * SEC,
    accountBurst: 3,
    accountIntervalMs: SEC,
    knownMax: 2,
    maxAddresses: 16,
  };
  const env = setup(small);
  const { limiter, fail, advance } = env;
  const victim = '192.0.2.21';
  failThrough(env, victim, 4); // now waits 4 s
  for (let i = 0; i < 5000; i++) {
    fail(freshIp());
    advance(100);
    assert.ok(limiter.stats().addresses <= 16, `never over the cap (${i})`);
    if (i === 38) assert.equal(fail(victim).reason, 'address', 'the victim still waits at 3.9 s');
  }
});

test('limits that would let a flood evict a live record are refused at creation', () => {
  assert.throws(
    () => createLoginLimiter({ log: quiet, maxAddresses: 100 }),
    /maxAddresses/,
    '10 + 120 + 16 live records need more than 100'
  );
  assert.throws(
    () => createLoginLimiter({ log: quiet, freeFailures: 10 }),
    /one address/,
    'one address alone could empty the bucket'
  );
  assert.throws(
    () => createLoginLimiter({ log: quiet, forgetMs: 10 * MIN }),
    /forgetMs/,
    'an address at the longest wait would be forgotten before it ends'
  );
});

test('known addresses are capped at 16, the oldest dropped first', () => {
  const { limiter, fail, advance } = setup();
  for (let i = 0; i < 40; i++) {
    limiter.attempt(`192.0.2.${100 + i}`).succeeded();
    advance(SEC);
  }
  assert.equal(limiter.stats().known, 16);
  for (let i = 0; i < 10; i++) fail(freshIp()); // empty: only known addresses get through
  assert.equal(limiter.attempt('192.0.2.123').ok, false, 'the 24th, dropped');
  assert.equal(limiter.attempt('192.0.2.124').ok, true, 'the 25th, the oldest kept');
  assert.equal(limiter.attempt('192.0.2.139').ok, true, 'the newest');
});

// ── Keys, logs, floor delay ──────────────────────────────────────────────

test('addressKey: an IP is its own key; anything else (spoofed junk, oversized) shares one', () => {
  assert.equal(addressKey('192.0.2.1'), '192.0.2.1');
  assert.equal(addressKey('2001:DB8::1'), '2001:db8::1');
  assert.equal(addressKey('::ffff:192.0.2.1'), '::ffff:192.0.2.1');
  assert.equal(addressKey('not-an-ip'), 'unknown');
  assert.equal(addressKey('1'.repeat(10_000)), 'unknown');
  assert.equal(addressKey(undefined), 'unknown');
});

test("the 'unknown' key is never a known address", () => {
  const { limiter, fail } = setup();
  limiter.attempt(undefined).succeeded();
  for (let i = 0; i < 10; i++) fail(freshIp());
  assert.equal(limiter.attempt('junk').ok, false, 'no skip for unknown');
});

test('logs: one warning when an address first has to wait, one when the bucket empties', () => {
  const { fail, warnings, advance } = setup();
  for (let i = 0; i < 5; i++) fail('192.0.2.30');
  fail('192.0.2.30');
  fail('192.0.2.30');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].fields.ip, '192.0.2.30');

  for (let i = 0; i < 20; i++) fail(freshIp());
  assert.equal(warnings.length, 2, 'the bucket emptying is logged once');
  assert.doesNotMatch(JSON.stringify(warnings[1].fields ?? {}), /10\./, 'no address in the account warning');
  advance(10 * MIN); // full again: the next emptying is logged again
  for (let i = 0; i < 20; i++) fail(freshIp());
  assert.equal(warnings.length, 3);
});

test('loginFailureDelay resolves only after the floor delay', async () => {
  const t0 = Date.now();
  await loginFailureDelay();
  assert.ok(Date.now() - t0 >= 380, 'waited at least ~the 400ms floor');
});
