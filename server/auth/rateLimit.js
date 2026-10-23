/**
 * Login rate limiter (#257): slows password guessing without a lock that
 * anyone can trip for everyone.
 *
 * Three layers. The first two are checked before a password is looked at, and
 * a refusal is a 429 with Retry-After that changes no state:
 *
 *  1. Per address. An address's first 5 failures in a row cost only the floor
 *     delay; after the 5th it must wait 30 s, and each further failure doubles
 *     the wait, up to 15 min. A sign-in from it clears it; its failures are
 *     forgotten an hour after its last one. Failures from one address never
 *     make another address wait (the old global lock did: #257).
 *  2. The account. JagHelm has one account, and every attempt is a guess at it
 *     whatever user name it carries (the name is half the secret), so this is
 *     one token bucket rather than a map of names an attacker could fill or
 *     probe: 10 attempts, one more every 30 s. It holds an attacker who rotates
 *     addresses (many hosts, IPv6, or a proxy whose X-Forwarded-For can be
 *     spoofed: why the old global counter existed) to at most 10 + 120 guesses
 *     in any hour. One address can't empty it (5 free failures, then one per
 *     30 s at most), so it only slows anyone once failures come from several
 *     addresses, and then by at most 30 s. The last 16 addresses that signed in
 *     skip it until their next failure, so an attacker who keeps it empty
 *     can't keep the owner out from where he signs in (a spoofed one buys a
 *     single guess).
 *  3. A jittered floor delay on every failure, so a 401's timing isn't a
 *     fine-grained credential oracle.
 *
 * Each attempt let through is counted as a failure when it starts, and
 * succeeded() undoes that, so parallel requests can't all pass one check.
 *
 * Memory: the account is one record, known addresses at most 16. Address
 * records are capped at 1000, oldest first, but a record is made only for an
 * attempt the bucket let through, so no more than 10 + 120 + 16 = 146 are live
 * (failed within the hour) and the cap only ever drops forgotten ones: a flood
 * of fresh addresses can't push a waiting address out to reset its wait.
 * createLoginLimiter refuses limits that would break that. A key is the
 * client's IP; anything that isn't one shares the key `unknown`.
 *
 * The state is in memory, on a monotonic clock: a restart clears it (sessions
 * survive one, #250). Client identification (req.ip) is the caller's; behind
 * a proxy it needs TRUST_PROXY set (server/index.js, KNOWN-ISSUES).
 */
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';

import { createLogger } from '../util/logger.js';

const defaultLog = createLogger('auth');

export const LOGIN_LIMITS = Object.freeze({
  freeFailures: 5, // failures in a row an address makes before it waits
  firstWaitMs: 30_000, // its first wait, doubled at each further failure
  maxWaitMs: 15 * 60_000, // the longest wait
  forgetMs: 60 * 60_000, // an address's failures are forgotten this long after its last
  accountBurst: 10, // the account bucket's size
  accountIntervalMs: 30_000, // one attempt more in the bucket this often
  knownMax: 16, // addresses that signed in, kept to skip the bucket
  maxAddresses: 1000, // address records kept at most
});

const FAILURE_DELAY_MS = 400; // floor delay on a failed login
const UNKNOWN = 'unknown';

/** The limiter's key for a client address: the IP, or `unknown` for anything else. */
export function addressKey(ip) {
  return typeof ip === 'string' && ip.length <= 64 && isIP(ip) ? ip.toLowerCase() : UNKNOWN;
}

/** The wait after an address's `failures`th failure in a row. */
function waitAfter(failures, limits) {
  if (failures < limits.freeFailures) return 0;
  const doublings = Math.min(failures - limits.freeFailures, 30);
  return Math.min(limits.firstWaitMs * 2 ** doublings, limits.maxWaitMs);
}

function checkLimits(l) {
  const live = l.accountBurst + Math.ceil(l.forgetMs / l.accountIntervalMs) + l.knownMax;
  if (l.maxAddresses <= live) {
    throw new Error(`login limits: maxAddresses must exceed the ${live} records that can be live`);
  }
  if (l.freeFailures >= l.accountBurst || l.firstWaitMs < l.accountIntervalMs) {
    throw new Error('login limits: one address alone could empty the account bucket');
  }
  if (l.forgetMs <= l.maxWaitMs) {
    throw new Error('login limits: forgetMs must outlast maxWaitMs');
  }
}

/**
 * A login limiter. `attempt(ip)` → `{ ok: true, succeeded() }`, the attempt
 * counted as a failure until succeeded() is called; or `{ ok: false,
 * retryAfterMs, reason }`, reason `'address'` or `'account'`.
 * `now` (ms, monotonic) and `log` are seams for tests.
 */
export function createLoginLimiter({ now = () => performance.now(), log = defaultLog, ...overrides } = {}) {
  const limits = { ...LOGIN_LIMITS, ...overrides };
  checkLimits(limits);

  /** key → { failures, last, until, warned }, oldest `last` first. */
  const addresses = new Map();
  /** key → time of its last sign-in, oldest first. */
  const known = new Map();
  let tokens = limits.accountBurst;
  let refilledAt = now();
  let accountWarned = false;

  const forgotten = (record, t) => t - record.last > limits.forgetMs;

  function refill(t) {
    tokens = Math.min(limits.accountBurst, tokens + (t - refilledAt) / limits.accountIntervalMs);
    refilledAt = t;
    if (tokens >= limits.accountBurst) accountWarned = false;
  }

  /** Store `record` as the newest, then drop forgotten records (and any over the cap) from the oldest end. */
  function store(key, record, t) {
    addresses.delete(key);
    addresses.set(key, record);
    for (const [oldKey, old] of addresses) {
      if (!forgotten(old, t) && addresses.size <= limits.maxAddresses) break;
      addresses.delete(oldKey);
    }
  }

  function attempt(ip) {
    const t = now();
    const key = addressKey(ip);
    let record = addresses.get(key);
    if (record && forgotten(record, t)) {
      addresses.delete(key);
      record = undefined;
    }

    if (record && record.until > t) {
      if (!record.warned) {
        record.warned = true;
        log.warn(
          { ip: key, failures: record.failures, waitMs: record.until - t },
          'an address is waiting to sign in again after repeated failed sign-ins'
        );
      }
      return { ok: false, retryAfterMs: record.until - t, reason: 'address' };
    }

    const skipsBucket = known.has(key);
    if (!skipsBucket) {
      refill(t);
      if (tokens < 1) {
        if (!accountWarned) {
          accountWarned = true;
          log.warn(
            { retryAfterMs: Math.ceil((1 - tokens) * limits.accountIntervalMs) },
            'sign-ins from new addresses are being slowed: failed sign-ins from many addresses'
          );
        }
        return {
          ok: false,
          retryAfterMs: Math.ceil((1 - tokens) * limits.accountIntervalMs),
          reason: 'account',
        };
      }
      tokens -= 1;
    }
    known.delete(key); // until it signs in again

    const failures = (record?.failures ?? 0) + 1;
    store(key, { failures, last: t, until: t + waitAfter(failures, limits), warned: false }, t);

    let settled = false;
    return {
      ok: true,
      succeeded() {
        if (settled) return;
        settled = true;
        addresses.delete(key);
        if (!skipsBucket) {
          refill(now());
          tokens = Math.min(limits.accountBurst, tokens + 1);
        }
        if (key === UNKNOWN) return;
        known.set(key, now());
        if (known.size > limits.knownMax) known.delete(known.keys().next().value);
      },
    };
  }

  /** For tests: how many records are kept. */
  const stats = () => ({ addresses: addresses.size, known: known.size });

  return { attempt, stats };
}

let limiter = createLoginLimiter();

/** Gate a login attempt from `ip` (see createLoginLimiter). */
export function loginAttempt(ip) {
  return limiter.attempt(ip);
}

/**
 * A jittered floor delay applied to every failed login. Awaited by the login
 * route before returning 401. Jitter keeps the delay from being a precise oracle.
 */
export function loginFailureDelay() {
  const ms = FAILURE_DELAY_MS + Math.floor(Math.random() * 120);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Test seam: a fresh limiter (its options as createLoginLimiter's) between cases.
export function _resetAllLoginRate(options) {
  limiter = createLoginLimiter(options);
}
