/**
 * Login rate limiter (#257): slows password guessing without a lock that
 * anyone can trip for everyone.
 *
 * Three layers. The first two are checked before a password is looked at, and
 * a refusal is a 429 with Retry-After that changes no state:
 *
 *  1. Per address (loginAddress.js: an IPv4 address, or an IPv6 /64). Its
 *     first 5 failures in a row cost only the floor delay; after the 5th it
 *     must wait 30 s, and each further failure doubles the wait, up to 15 min.
 *     A sign-in from it clears it; its failures are forgotten an hour after the
 *     last. Failures from one address never make another address wait (the old
 *     global lock did). This applies to every address, known or trusted too.
 *  2. The account. JagHelm has one account, and every attempt is a guess at it
 *     whatever user name it carries (the name is half the secret), so this is
 *     one token bucket, not a map of names an attacker could fill or probe: 10
 *     attempts, one more every 30 s. It holds an attacker who rotates addresses
 *     (many hosts, many IPv6 networks, or a proxy whose X-Forwarded-For can be
 *     spoofed: why the old global counter existed) to 10 + 120 guesses in any
 *     hour. One address can't empty it (5 free failures, then one per 30 s at
 *     most). Its tokens go to whoever asks first and a refusal costs nothing,
 *     so many addresses asking all the time can keep a NEW address out for as
 *     long as they keep at it. Two kinds of address never wait on it:
 *     - known: the 16 that signed in most recently, kept in
 *       DATA_DIR/known-addresses.json so a restart keeps them. One stays known
 *       through 3 failures in a row and leaves at the 4th (a sign-in brings it
 *       back), so a typo or three doesn't drop the owner into the race, and an
 *       attacker who can send from one gets at most 4 guesses an hour from it
 *       (64 for all 16).
 *     - trusted: in LOGIN_TRUSTED_NETS (empty by default), for a LAN or a
 *       tailnet. These are held per address only.
 *  3. A jittered floor delay on every failure, so a 401's timing isn't a
 *     fine-grained credential oracle.
 *
 * Each attempt let through is counted as a failure when it starts, and
 * succeeded() undoes that, so parallel requests can't all pass one check.
 *
 * Memory: the account is one record, known addresses at most 16. Records of
 * addresses outside the trusted nets are capped at 1000, oldest first, but one
 * is made only for an attempt the bucket or a known address let through, so no
 * more than 10 + 120 + 16 = 146 are live (failed within the hour) and the cap
 * only ever drops forgotten ones: a flood of fresh addresses can't push a
 * waiting address out to reset its wait. createLoginLimiter refuses limits that
 * would break that. Trusted-net records have a cap of their own (1000, oldest
 * first), so they can't push those out either; inside a trusted net with more
 * than 1000 addresses in use, the oldest waits there can be pushed out.
 *
 * The known-addresses file holds the keys in plain text, not hashed: an
 * address isn't a secret, and a hash of one is undone by trying every address
 * (IPv4 has 2^32), so hashing would hide nothing. It is written atomically,
 * 0600, like sessions.json; one that can't be read or parsed is no known
 * addresses and one warning. A password change forgets all but the address it
 * came from. The rest of the state is in memory, on a monotonic clock: a
 * restart clears every wait and refills the bucket. Client identification
 * (req.ip) is the caller's; behind a proxy it needs TRUST_PROXY set
 * (server/index.js, KNOWN-ISSUES), or LOGIN_TRUSTED_NETS and known addresses
 * can be claimed by anyone.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { addressKey, isKnownKey, parseTrustedNets } from './loginAddress.js';
import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { DATA_DIR } from '../util/dataDir.js';
import { createLogger } from '../util/logger.js';
import { jsonFileErrorFields } from '../util/parseError.js';

const defaultLog = createLogger('auth');

export const LOGIN_LIMITS = Object.freeze({
  freeFailures: 5, // failures in a row an address makes before it waits
  firstWaitMs: 30_000, // its first wait, doubled at each further failure
  maxWaitMs: 15 * 60_000, // the longest wait
  forgetMs: 60 * 60_000, // an address's failures are forgotten this long after its last
  accountBurst: 10, // the account bucket's size
  accountIntervalMs: 30_000, // one attempt more in the bucket this often
  knownMax: 16, // addresses that signed in, kept to skip the bucket
  knownFailures: 3, // failures in a row a known address stays known through
  maxAddresses: 1000, // records of addresses outside the trusted nets
  maxTrustedAddresses: 1000, // records of addresses inside them
});

export const KNOWN_FILE = join(DATA_DIR, 'known-addresses.json');
const KNOWN_VERSION = 1;
const FAILURE_DELAY_MS = 400; // floor delay on a failed login
const UNKNOWN = 'unknown';

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
 * The known addresses in `file`, oldest first, at most `max`: none, with one
 * warning, for a file that can't be read or parsed or isn't this shape.
 */
function readKnown(file, max, log) {
  if (!file) return [];
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return [];
    // Its path and code, or a parse error's reason and position: never its text.
    log.warn(jsonFileErrorFields(err), 'could not read known-addresses.json: no address skips the sign-in budget');
    return [];
  }
  if (data?.version !== KNOWN_VERSION || !Array.isArray(data.addresses)) {
    log.warn('known-addresses.json is not a file this version reads: no address skips the sign-in budget');
    return [];
  }
  const kept = data.addresses.filter(isKnownKey);
  const dropped = data.addresses.length - kept.length;
  if (dropped > 0) log.warn({ dropped }, 'known-addresses.json held entries that are not addresses: dropped them');
  // The last of each, the most recent last.
  return [...new Set(kept.reverse())].reverse().slice(-max);
}

/**
 * A login limiter. `attempt(ip)` → `{ ok: true, succeeded() }`, the attempt
 * counted as a failure until succeeded() is called; or `{ ok: false,
 * retryAfterMs, reason }`, reason `'address'` or `'account'`.
 * `forgetKnownExcept(ip)` forgets every known address but `ip`'s.
 * `knownFile` (null: kept in memory only) and `trustedNets` (LOGIN_TRUSTED_NETS'
 * text) are the deployment's; `now` (ms, monotonic) and `log` are seams for tests.
 */
export function createLoginLimiter({
  now = () => performance.now(),
  log = defaultLog,
  knownFile = null,
  trustedNets = '',
  ...overrides
} = {}) {
  const limits = { ...LOGIN_LIMITS, ...overrides };
  checkLimits(limits);
  const trusted = parseTrustedNets(trustedNets, log);

  /** key → { failures, last, until, warned }, oldest `last` first: outside the trusted nets, and inside. */
  const addresses = new Map();
  const trustedAddresses = new Map();
  /** Known keys, oldest first; read on first use. */
  let known = null;
  let knownSaved = '';
  let tokens = limits.accountBurst;
  let refilledAt = now();
  let accountWarned = false;

  const forgotten = (record, t) => t - record.last > limits.forgetMs;

  function knownSet() {
    if (!known) {
      known = new Set(readKnown(knownFile, limits.knownMax, log));
      knownSaved = JSON.stringify([...known]);
    }
    return known;
  }

  /** Write the known addresses if they changed. A failed write is logged; they stay known until the restart. */
  function saveKnown() {
    const list = [...knownSet()];
    const text = JSON.stringify(list);
    if (!knownFile || text === knownSaved) return;
    knownSaved = text;
    try {
      const body = { version: KNOWN_VERSION, addresses: list };
      atomicWriteFileSync(knownFile, JSON.stringify(body, null, 2), { mode: 0o600 });
    } catch (err) {
      log.error({ err }, 'could not write known-addresses.json: these addresses are known until the restart');
    }
  }

  function refill(t) {
    tokens = Math.min(limits.accountBurst, tokens + (t - refilledAt) / limits.accountIntervalMs);
    refilledAt = t;
    if (tokens >= limits.accountBurst) accountWarned = false;
  }

  /** Store `record` as the newest, then drop forgotten records (and any over `cap`) from the oldest end. */
  function store(records, cap, key, record, t) {
    records.delete(key);
    records.set(key, record);
    for (const [oldKey, old] of records) {
      if (!forgotten(old, t) && records.size <= cap) break;
      records.delete(oldKey);
    }
  }

  function attempt(ip) {
    const t = now();
    const key = addressKey(ip);
    const isTrusted = trusted.has(ip);
    const records = isTrusted ? trustedAddresses : addresses;
    let record = records.get(key);
    if (record && forgotten(record, t)) {
      records.delete(key);
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

    const isKnown = !isTrusted && knownSet().has(key);
    const takesToken = !isTrusted && !isKnown;
    if (takesToken) {
      refill(t);
      if (tokens < 1) {
        const retryAfterMs = Math.ceil((1 - tokens) * limits.accountIntervalMs);
        if (!accountWarned) {
          accountWarned = true;
          log.warn(
            { retryAfterMs },
            'sign-ins from new addresses are being slowed: failed sign-ins from many addresses'
          );
        }
        return { ok: false, retryAfterMs, reason: 'account' };
      }
      tokens -= 1;
    }

    const failures = (record?.failures ?? 0) + 1;
    const cap = isTrusted ? limits.maxTrustedAddresses : limits.maxAddresses;
    store(records, cap, key, { failures, last: t, until: t + waitAfter(failures, limits), warned: false }, t);
    if (isKnown && failures > limits.knownFailures) {
      knownSet().delete(key); // until it signs in again
      saveKnown();
    }

    let settled = false;
    return {
      ok: true,
      succeeded() {
        if (settled) return;
        settled = true;
        records.delete(key);
        if (takesToken) {
          refill(now());
          tokens = Math.min(limits.accountBurst, tokens + 1);
        }
        if (isTrusted || key === UNKNOWN) return;
        const set = knownSet();
        set.delete(key);
        set.add(key);
        if (set.size > limits.knownMax) set.delete(set.values().next().value);
        saveKnown();
      },
    };
  }

  function forgetKnownExcept(ip) {
    const key = addressKey(ip);
    const set = knownSet();
    for (const k of [...set]) if (k !== key) set.delete(k);
    saveKnown();
  }

  /** For tests: how many records are kept. */
  const stats = () => ({
    addresses: addresses.size,
    trusted: trustedAddresses.size,
    known: knownSet().size,
  });

  return { attempt, forgetKnownExcept, stats };
}

const deployment = () => ({ knownFile: KNOWN_FILE, trustedNets: process.env.LOGIN_TRUSTED_NETS });
let limiter = createLoginLimiter(deployment());

/** Gate a login attempt from `ip` (see createLoginLimiter). */
export function loginAttempt(ip) {
  return limiter.attempt(ip);
}

/** After a password change from `ip`: every other address must sign in again to be known. */
export function loginPasswordChanged(ip) {
  limiter.forgetKnownExcept(ip);
}

/**
 * A jittered floor delay applied to every failed login. Awaited by the login
 * route before returning 401. Jitter keeps the delay from being a precise oracle.
 */
export function loginFailureDelay() {
  const ms = FAILURE_DELAY_MS + Math.floor(Math.random() * 120);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Test seam: a fresh limiter between cases, its options as createLoginLimiter's
// over the deployment's (known addresses in memory unless `knownFile` is given).
export function _resetAllLoginRate(options = {}) {
  limiter = createLoginLimiter({ ...deployment(), knownFile: null, ...options });
}
