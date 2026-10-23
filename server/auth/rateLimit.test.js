/**
 * The login rate limiter (#257): per-address backoff, one bucket for the
 * account, known addresses (kept on disk) and LOGIN_TRUSTED_NETS that skip it,
 * no global lock. Every test runs on a fake clock (createLoginLimiter's `now`),
 * so waits of minutes and hours take no time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LOGIN_LIMITS, createLoginLimiter, loginFailureDelay } from './rateLimit.js';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const quiet = { warn() {}, error() {} };

/** A limiter on a fake clock; `advance(ms)` moves it. `restart()` makes a new one, same clock and options. */
function setup(overrides = {}) {
  let t = 1_000_000;
  const warnings = [];
  const errors = [];
  const log = {
    warn: (fields, msg) => warnings.push({ fields, msg }),
    error: (fields, msg) => errors.push({ fields, msg }),
  };
  const make = () => createLoginLimiter({ now: () => t, log, ...overrides });
  const env = {
    limiter: make(),
    warnings,
    errors,
    advance: (ms) => (t += ms),
    /** An attempt that fails: let through, never succeeded(). */
    fail: (ip) => env.limiter.attempt(ip),
    restart: () => (env.limiter = make()),
  };
  return env;
}

/** A known-addresses file in a fresh directory (under the test run's data dir). */
const knownFile = () =>
  join(mkdtempSync(join(process.env.JAGHELM_DATA_DIR || tmpdir(), 'known-')), 'known-addresses.json');

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

test('with nobody racing it, a new address gets in after one wait while the bucket is empty', () => {
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

test('a known address keeps the skip through 3 failures, and leaves on the 4th', () => {
  const { limiter, fail } = setup();
  const home = '192.0.2.12';
  limiter.attempt(home).succeeded();
  for (let i = 0; i < 10; i++) fail(freshIp()); // empty
  for (let i = 1; i <= 4; i++) assert.equal(fail(home).ok, true, `try ${i}: still known when it starts`);
  const after = fail(home);
  assert.equal(after.ok, false, 'after its 4th failure it is one more address');
  assert.equal(after.reason, 'account');
});

test('a known address that typed its password wrong 3 times still gets in on the 4th, and stays known', () => {
  const { limiter, fail } = setup();
  const home = '192.0.2.14';
  limiter.attempt(home).succeeded();
  for (let i = 0; i < 10; i++) fail(freshIp()); // empty
  for (let i = 0; i < 3; i++) fail(home);
  const fourth = limiter.attempt(home);
  assert.equal(fourth.ok, true);
  fourth.succeeded();
  for (let i = 1; i <= 4; i++) assert.equal(fail(home).ok, true, `known again, its failures cleared (${i})`);
});

test('a known address still waits on its own failures: 5 in a row, then 30 s', () => {
  const { limiter, fail } = setup();
  const home = '192.0.2.15';
  limiter.attempt(home).succeeded();
  for (let i = 0; i < 5; i++) fail(home);
  const waiting = fail(home);
  assert.equal(waiting.reason, 'address');
  assert.equal(waiting.retryAfterMs, 30 * SEC);
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

// ── LOGIN_TRUSTED_NETS ───────────────────────────────────────────────────

test('a trusted-net address skips an empty bucket, as many times as it likes, and never takes a token', () => {
  const { limiter, fail } = setup({ trustedNets: '192.168.68.0/22,fd00:1::/48' });
  for (let i = 0; i < 10; i++) fail(freshIp()); // empty
  for (const ip of ['192.168.69.5', '::ffff:192.168.70.6', 'fd00:1:0:9::5']) {
    for (let i = 0; i < 3; i++) assert.equal(fail(ip).ok, true, `${ip} try ${i + 1}`);
    limiter.attempt(ip).succeeded();
  }
  assert.equal(fail('192.168.72.1').reason, 'account', 'outside the net: the bucket');
  assert.equal(limiter.stats().known, 0, 'a trusted address takes no known slot');
});

test('a trusted-net address still waits on its own failures', () => {
  const { fail } = setup({ trustedNets: '192.168.68.0/22' });
  for (let i = 0; i < 5; i++) fail('192.168.68.9');
  const waiting = fail('192.168.68.9');
  assert.equal(waiting.reason, 'address');
  assert.equal(waiting.retryAfterMs, 30 * SEC);
});

test('trusted-net records have their own cap, so they never push out a record from outside', () => {
  const { limiter, fail, advance } = setup({ trustedNets: '10.0.0.0/8' });
  const victim = '192.0.2.40';
  failThrough({ fail, advance }, victim, 7); // waits 120 s
  for (let i = 0; i < 5000; i++) fail(freshIp()); // all inside 10/8
  const { addresses, trusted } = limiter.stats();
  assert.equal(trusted, LOGIN_LIMITS.maxTrustedAddresses);
  assert.equal(addresses, 1);
  assert.equal(fail(victim).reason, 'address', 'the outside record keeps its wait');
});

// ── The race (#257 review) ───────────────────────────────────────────────

test('a race: 20 addresses at 10 tries a second for an hour keep a new address out; a known address (after 3 typos) and a trusted one get straight in', () => {
  const env = setup({ trustedNets: '192.168.68.0/22' });
  const { limiter, advance } = env;
  const known = '192.0.2.50';
  const trusted = '192.168.69.50';
  const fresh = '203.0.113.50';
  limiter.attempt(known).succeeded(); // signed in before the attack
  const attackers = Array.from({ length: 20 }, (_, i) => `198.51.100.${i + 1}`);

  // Every 5 ms one attacker tries (200 a second in all, 10 each, every one
  // wrong). Every 30 s, 2.5 s after the attack's tick, each owner address
  // tries: the known one types a wrong password 3 times first.
  const got = { fresh: null, known: null, trusted: null };
  let freshRefused = 0;
  let knownTypos = 0;
  let nextTry = 2.5 * SEC;
  for (let t = 0, i = 0; t < HOUR; t += 5, i++) {
    limiter.attempt(attackers[i % attackers.length]);
    if (t >= nextTry) {
      nextTry += 30 * SEC;
      if (got.fresh === null) {
        const a = limiter.attempt(fresh);
        if (a.ok) {
          a.succeeded();
          got.fresh = t;
        } else freshRefused++;
      }
      if (got.known === null) {
        const a = limiter.attempt(known);
        assert.equal(a.ok, true, `the known address is let through at ${t} ms`);
        if (knownTypos < 3) knownTypos++;
        else {
          a.succeeded();
          got.known = t;
        }
      }
      if (got.trusted === null) {
        const a = limiter.attempt(trusted);
        assert.equal(a.ok, true, 'the trusted address is let through');
        a.succeeded();
        got.trusted = t;
      }
    }
    advance(5);
  }
  assert.equal(got.trusted, 2.5 * SEC, 'trusted: in at its first try');
  assert.equal(got.known, 2.5 * SEC + 3 * 30 * SEC, 'known: in at its 4th try, after 3 typos');
  // The documented limit: tokens go to whoever asks first, and a refusal
  // costs the attackers nothing, so a brand-new address can be kept out.
  assert.equal(got.fresh, null, 'new: kept out for the whole hour');
  assert.equal(freshRefused, 120);
});

// ── Known addresses on disk ──────────────────────────────────────────────

test('known addresses survive a restart: the file is 0600 and holds the keys in plain text', () => {
  const file = knownFile();
  const env = setup({ knownFile: file });
  env.limiter.attempt('192.0.2.60').succeeded();
  env.limiter.attempt('2001:db8:5:6::99').succeeded();

  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    version: 1,
    addresses: ['192.0.2.60', '2001:db8:5:6::/64'],
  });

  env.restart();
  for (let i = 0; i < 10; i++) env.fail(freshIp()); // empty
  assert.equal(env.limiter.attempt('192.0.2.60').ok, true, 'known after the restart');
  assert.equal(env.limiter.attempt('2001:db8:5:6::1').ok, true, 'its /64 too');
  assert.equal(env.limiter.attempt('192.0.2.61').reason, 'account');
});

test('the file holds at most 16, the most recent; an address that leaves leaves the file', () => {
  const file = knownFile();
  const env = setup({ knownFile: file });
  for (let i = 0; i < 20; i++) env.limiter.attempt(`192.0.2.${100 + i}`).succeeded();
  let saved = JSON.parse(readFileSync(file, 'utf8')).addresses;
  assert.equal(saved.length, 16);
  assert.equal(saved[0], '192.0.2.104');
  assert.equal(saved[15], '192.0.2.119');

  for (let i = 0; i < 4; i++) env.fail('192.0.2.119');
  saved = JSON.parse(readFileSync(file, 'utf8')).addresses;
  assert.equal(saved.includes('192.0.2.119'), false);
  env.restart();
  assert.equal(env.limiter.stats().known, 15);
});

test('a file that is not JSON, or not this shape, is no known addresses and one warning', () => {
  for (const text of ['{nope', '[]', '{"version":2,"addresses":[]}', '{"version":1,"addresses":"192.0.2.1"}']) {
    const file = knownFile();
    writeFileSync(file, text);
    const env = setup({ knownFile: file });
    assert.equal(env.limiter.stats().known, 0, text);
    assert.equal(env.limiter.stats().known, 0, 'read once');
    assert.equal(env.warnings.length, 1, text);
    assert.doesNotMatch(JSON.stringify(env.warnings[0]), /nope|192\.0\.2\.1/, 'the warning never quotes the file');
  }
});

test('entries that are not keys are dropped, with one warning; duplicates kept once', () => {
  const file = knownFile();
  writeFileSync(
    file,
    JSON.stringify({ version: 1, addresses: ['192.0.2.1', 'junk', 7, '2001:db8::1', '192.0.2.2', '192.0.2.1'] })
  );
  const env = setup({ knownFile: file });
  assert.equal(env.limiter.stats().known, 2);
  assert.equal(env.warnings.length, 1);
  assert.equal(env.warnings[0].fields.dropped, 3);
});

test('no file is no known addresses and no warning', () => {
  const env = setup({ knownFile: knownFile() });
  assert.equal(env.limiter.stats().known, 0);
  assert.equal(env.warnings.length, 0);
});

test('a file that cannot be written is logged, and the addresses stay known until the restart', { skip: process.getuid?.() === 0 }, () => {
  const file = knownFile();
  const dir = join(file, '..');
  chmodSync(dir, 0o500);
  try {
    const env = setup({ knownFile: file });
    env.limiter.attempt('192.0.2.70').succeeded();
    assert.equal(env.errors.length, 1);
    assert.match(env.errors[0].msg, /known-addresses/);
    for (let i = 0; i < 10; i++) env.fail(freshIp());
    assert.equal(env.limiter.attempt('192.0.2.70').ok, true);
  } finally {
    chmodSync(dir, 0o700);
  }
});

test('a password change forgets every known address but the one it came from', () => {
  const file = knownFile();
  const env = setup({ knownFile: file });
  for (const ip of ['192.0.2.80', '192.0.2.81', '192.0.2.82']) env.limiter.attempt(ip).succeeded();
  env.limiter.forgetKnownExcept('192.0.2.81');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).addresses, ['192.0.2.81']);
  for (let i = 0; i < 10; i++) env.fail(freshIp());
  assert.equal(env.limiter.attempt('192.0.2.80').reason, 'account');
  assert.equal(env.limiter.attempt('192.0.2.81').ok, true);
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

test('IPv6 rotation inside one /64 is one address: it shares one wait', () => {
  const { fail } = setup();
  for (let i = 1; i <= 5; i++) assert.equal(fail(`2001:db8:7:8::${i}`).ok, true);
  const sixth = fail('2001:db8:7:8:ffff::6');
  assert.equal(sixth.reason, 'address');
  assert.equal(fail('2001:db8:7:9::1').ok, true, 'the next /64 is another address');
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
