// @ts-check
/**
 * Session store (ADR 0002, #250). A session is an opaque random token (32
 * bytes, hex) the client sends as `x-auth-token`. The store keys each session
 * by the SHA-256 of its token, never the token, in memory and in
 * DATA_DIR/sessions.json, so sessions survive a restart (every deploy is one)
 * and the file alone signs nobody in. The token is 256 random bits, so a fast
 * hash with no salt is enough: there is nothing to guess.
 *
 * A session ends after SESSION_IDLE_MS without use (every request it
 * authenticates is a use) and SESSION_MAX_AGE_MS after sign-in, used or not.
 * At most MAX_SESSIONS are kept: a sign-in past that ends the least recently
 * used one. Expired sessions are dropped on lookup, when the file is read and
 * by an hourly sweep.
 *
 * Writes are atomic and 0600 (ADR 0001). A sign-in, a sign-out and a password
 * change are written before the route answers. A use moves `lastUsed` in
 * memory and is written once it is LAST_USED_SAVE_MS past the one on disk, so
 * a polling phone doesn't write the file every request; a crash loses at most
 * that much of the idle window. Only an authenticated request can cause a
 * write.
 *
 * Fails safe. No file is no sessions. A file that can't be read or parsed is
 * no sessions and one warning that never quotes it (#504). A write that fails
 * is logged, and the sessions in memory carry on; the next restart starts
 * from the file as last written, so a session made meanwhile ends then. A
 * sign-out or password change whose write fails removes the file instead, so
 * a restart can't bring a revoked session back: everyone signs in again.
 *
 * The file carries a stamp of the credential (passwords.js): a restart after
 * the password or user changed outside Settings starts with no sessions.
 *
 * Lookup is by the token's hash. The map compares digests the caller can't
 * steer, so its timing tells nothing about a stored token.
 */

import crypto from 'crypto';
import { readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { DATA_DIR } from '../util/dataDir.js';
import { createLogger } from '../util/logger.js';
import { jsonFileErrorFields } from '../util/parseError.js';
import { credentialStamp, matchesCredentialStamp } from './passwords.js';

const log = createLogger('sessions');

const DAY_MS = 24 * 60 * 60 * 1000;
/** A session ends after this long without use. */
export const SESSION_IDLE_MS = 30 * DAY_MS;
/** A session ends this long after sign-in, however recently it was used. */
export const SESSION_MAX_AGE_MS = 90 * DAY_MS;
/** The most sessions kept; a sign-in past it ends the least recently used. */
export const MAX_SESSIONS = 50;
/** A use is written once it is this far past the one on disk. */
export const LAST_USED_SAVE_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const SESSIONS_FILE = join(DATA_DIR, 'sessions.json');
const FILE_VERSION = 1;
const HASH_RE = /^[0-9a-f]{64}$/;

/**
 * @typedef {{ user: string, created: number, lastUsed: number }} Session
 * @typedef {Session & { savedLastUsed: number }} Entry
 *   savedLastUsed: the lastUsed of the last write tried (memory only)
 */

/** @type {Map<string, Entry> | null} token hash → entry; read from the file on first use */
let sessions = null;

/** @param {string} token */
const hashToken = (token) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

/** @param {Session} entry @param {number} now */
const isExpired = (entry, now) =>
  now - entry.lastUsed >= SESSION_IDLE_MS || now - entry.created >= SESSION_MAX_AGE_MS;

/**
 * An entry from the file that can be used: a user, and times that are in
 * order and not in the future (a clock set back, or a hand edit).
 * @param {any} e @param {number} now
 * @returns {e is Session}
 */
function isSession(e, now) {
  return (
    Boolean(e) &&
    typeof e === 'object' &&
    typeof e.user === 'string' &&
    e.user !== '' &&
    Number.isFinite(e.created) &&
    Number.isFinite(e.lastUsed) &&
    e.created <= e.lastUsed &&
    e.lastUsed <= now
  );
}

/** The store, read from sessions.json on first use. */
function store() {
  if (!sessions) sessions = load();
  return sessions;
}

/** @returns {Map<string, Entry>} */
function load() {
  /** @type {Map<string, Entry>} */
  const loaded = new Map();
  let data;
  try {
    data = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return loaded;
    // Its path and code, or a parse error's reason and position: never its text (#504).
    log.warn(jsonFileErrorFields(err), 'could not read sessions.json: starting with no sessions');
    return loaded;
  }
  const saved = data && typeof data === 'object' ? data.sessions : null;
  if (data?.version !== FILE_VERSION || !saved || typeof saved !== 'object' || Array.isArray(saved)) {
    log.warn('sessions.json is not a sessions file this version reads: starting with no sessions');
    return loaded;
  }
  if (!matchesCredentialStamp(data.credential)) {
    log.info('the password or user changed since sessions.json was written: every device signs in again');
    // Written empty at once, so going back to the old credential brings none back.
    save(loaded, true);
    return loaded;
  }
  const now = Date.now();
  let dropped = 0;
  /** @type {[string, Entry][]} */
  const kept = [];
  for (const [hash, e] of Object.entries(saved)) {
    if (!HASH_RE.test(hash) || !isSession(e, now)) dropped++;
    else if (!isExpired(e, now)) {
      kept.push([hash, { user: e.user, created: e.created, lastUsed: e.lastUsed, savedLastUsed: e.lastUsed }]);
    }
  }
  if (dropped > 0) {
    log.warn({ dropped }, 'sessions.json held entries that are not sessions: dropped them');
  }
  // The most recently used first, at most MAX_SESSIONS of them.
  kept.sort((a, b) => b[1].lastUsed - a[1].lastUsed);
  for (const [hash, entry] of kept.slice(0, MAX_SESSIONS)) loaded.set(hash, entry);
  return loaded;
}

/**
 * Write the store to sessions.json. A failure is logged and the store in
 * memory carries on. For a revocation (`revoking`), the file is removed
 * instead, so a restart can't bring back what was revoked.
 * @param {Map<string, Entry>} from
 * @param {boolean} [revoking]
 */
function save(from, revoking = false) {
  // Whether or not the write goes through, the next try for a use waits
  // LAST_USED_SAVE_MS: a failing disk isn't hit on every request.
  for (const entry of from.values()) entry.savedLastUsed = entry.lastUsed;
  try {
    /** @type {Record<string, Session>} */
    const out = {};
    for (const [hash, { user, created, lastUsed }] of from) out[hash] = { user, created, lastUsed };
    const body = { version: FILE_VERSION, credential: credentialStamp(), sessions: out };
    atomicWriteFileSync(SESSIONS_FILE, JSON.stringify(body, null, 2), { mode: 0o600 });
    return;
  } catch (err) {
    if (!revoking) {
      log.error({ err }, 'could not write sessions.json: sessions carry on until the restart, which starts from the file as last written');
      return;
    }
    try {
      unlinkSync(SESSIONS_FILE);
    } catch (unlinkErr) {
      const failed = /** @type {NodeJS.ErrnoException} */ (unlinkErr);
      if (failed.code !== 'ENOENT') {
        log.error(
          { err, removeError: failed.message },
          'could not write or remove sessions.json after a sign-out or password change: a restart may bring a revoked session back'
        );
        return;
      }
    }
    log.error({ err }, 'could not write sessions.json after a sign-out or password change: removed it, so a restart signs every device out');
  }
}

/**
 * Create a session for `user` and return its token, written before this
 * returns. Past MAX_SESSIONS, the least recently used session ends.
 * @param {string} user
 */
export function createSession(user) {
  const all = store();
  const now = Date.now();
  for (const [hash, entry] of all) if (isExpired(entry, now)) all.delete(hash);
  while (all.size >= MAX_SESSIONS) {
    let lru = null;
    let lruAt = Infinity;
    for (const [hash, entry] of all) {
      if (entry.lastUsed < lruAt) {
        lru = hash;
        lruAt = entry.lastUsed;
      }
    }
    if (lru === null) break;
    all.delete(lru);
    log.info({ max: MAX_SESSIONS }, 'ended the least recently used session to keep the most allowed');
  }
  const token = crypto.randomBytes(32).toString('hex');
  // String(): the login route compares the user name as a string, so a JSON
  // body can pass ["admin"]; the file must hold what a restart reads back.
  all.set(hashToken(token), { user: String(user), created: now, lastUsed: now, savedLastUsed: now });
  save(all);
  return token;
}

/**
 * The live session for `token`, or null. A hit is a use: it slides the idle
 * window. An expired session is deleted.
 * @param {unknown} token
 * @returns {Session | null}
 */
export function getSession(token) {
  if (typeof token !== 'string' || token === '') return null;
  const all = store();
  const hash = hashToken(token);
  const entry = all.get(hash);
  if (!entry) return null;
  const now = Date.now();
  if (isExpired(entry, now)) {
    all.delete(hash);
    return null;
  }
  if (now > entry.lastUsed) entry.lastUsed = now;
  if (entry.lastUsed - entry.savedLastUsed >= LAST_USED_SAVE_MS) save(all);
  return { user: entry.user, created: entry.created, lastUsed: entry.lastUsed };
}

/**
 * Delete the session for `token`, written before this returns. True if there
 * was one.
 * @param {unknown} token
 */
export function deleteSession(token) {
  if (typeof token !== 'string' || token === '') return false;
  const all = store();
  if (!all.delete(hashToken(token))) return false;
  save(all, true);
  return true;
}

/**
 * Delete every session but `keepToken`'s (the caller's own, after a password
 * change), written before this returns. Always written: the file's credential
 * stamp has to follow the new password, or the kept session would end at the
 * next restart.
 * @param {unknown} keepToken
 */
export function deleteAllSessionsExcept(keepToken) {
  const all = store();
  const keep = typeof keepToken === 'string' && keepToken !== '' ? hashToken(keepToken) : null;
  for (const hash of [...all.keys()]) if (hash !== keep) all.delete(hash);
  save(all, true);
}

/** Drop expired sessions, and write the store if any went. Runs hourly. */
export function sweepExpiredSessions() {
  if (!sessions) return; // nothing read yet: nothing to sweep
  const now = Date.now();
  let dropped = false;
  for (const [hash, entry] of sessions) {
    if (isExpired(entry, now)) {
      sessions.delete(hash);
      dropped = true;
    }
  }
  if (dropped) save(sessions);
}

// .unref() so this housekeeping timer never keeps the process alive on its own
// (lets the process — and route tests that import the app — exit cleanly).
setInterval(sweepExpiredSessions, SWEEP_INTERVAL_MS).unref();

/** Test seam: no sessions, in memory or on disk. */
export function _resetAllSessions() {
  sessions = new Map();
  try {
    unlinkSync(SESSIONS_FILE);
  } catch {
    // none there
  }
}
