/**
 * JagHelm's own VAPID key pair for Web Push (#698): made on the first boot
 * that finds VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY both unset, kept in
 * DATA_DIR/vapid-keys.json (mode 0600) and read back on every later boot, so a
 * container user needs no extra tooling. Env values always win: this is only
 * asked when neither is set (channels.js initWebPush).
 *
 *   - Made once. The file is written to a temp sibling and hard-linked into
 *     place (createExclusiveFileSync), so two boots racing end up with one
 *     pair: the loser reads the winner's.
 *   - A file with group/other access is tightened to 0600 when read (one warning).
 *   - Never replaced silently. Every browser's subscription is bound to the
 *     public key, so a new pair turns them all "needs turning on again". A file
 *     that can't be read, or isn't a matching pair, is therefore an error with a
 *     message naming the file, and Web Push stays off, UNLESS no browser is
 *     subscribed: then nothing is orphaned and a new pair is made (and logged).
 *   - The private key appears in the file and in memory (as a key object, in
 *     webPush.js) only: never in a log line, error, status or response. Errors
 *     name the file and a code, never its content.
 */
import { randomBytes } from 'node:crypto';
import {
  closeSync, fchmodSync, fstatSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync,
} from 'fs';
import { basename, dirname, join } from 'path';

import { createExclusiveFileSync } from '../util/atomicWrite.js';
import { DATA_DIR } from '../util/dataDir.js';
import { generateVapidKeys } from './webPushCrypto.js';
import { readVapid, DEFAULT_VAPID_SUBJECT } from './webPush.js';

export const VAPID_KEY_FILE = join(DATA_DIR, 'vapid-keys.json');

/** Damaged files kept beside the key (newest first), and how long a temp file may be left. */
const KEEP_BAD = 3;
const STALE_TEMP_MS = 5 * 60 * 1000;
const STALE_LOCK_MS = 15 * 1000;
const LOCK_WAIT_MS = 5000;

/**
 * @typedef {'damaged' | 'unreadable' | 'unwritable'} VapidProblem
 *   damaged: no matching pair in the file and browsers depend on it;
 *   unreadable: the file can't be read (permissions, a directory); unwritable:
 *   no key could be kept (data folder read-only, full or missing)
 * @typedef {{ ok: true, publicKey: string, privateKey: string, created: boolean, replaced?: boolean }
 *   | { ok: false, problem: VapidProblem, detail: string }} VapidKeysResult
 */

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * The pair on disk: `null` for no file, `{ bad, unreadable? }` for a file that
 * is no good. A file readable by group or other is tightened to 0600.
 */
function readStored(path, logger) {
  let fd;
  let text;
  try {
    fd = openSync(path, 'r');
    const st = fstatSync(fd);
    if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'EISDIR' });
    if (st.mode & 0o077) {
      try {
        fchmodSync(fd, 0o600);
        logger?.warn?.('web push: vapid-keys.json was readable by others: tightened to 0600');
      } catch {
        logger?.warn?.('web push: vapid-keys.json is readable by others and its mode could not be tightened (is it yours?)');
      }
    }
    text = readFileSync(fd, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    return { bad: `can't read ${path} (${err.code})`, unreadable: true };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  try {
    const parsed = JSON.parse(text);
    const publicKey = typeof parsed?.publicKey === 'string' ? parsed.publicKey : '';
    const privateKey = typeof parsed?.privateKey === 'string' ? parsed.privateKey : '';
    const fits = readVapid({
      VAPID_PUBLIC_KEY: publicKey,
      VAPID_PRIVATE_KEY: privateKey,
      VAPID_SUBJECT: DEFAULT_VAPID_SUBJECT,
    });
    if (fits.enabled) return { publicKey, privateKey };
  } catch {
    // Not JSON: the same answer as a pair that does not fit.
  }
  return { bad: `${path} holds no valid Web Push key pair` };
}

/** Temp files of an interrupted write (they hold the key, 0600) older than STALE_TEMP_MS go. */
function sweepTemps(path) {
  const prefix = `${basename(path)}.tmp.`;
  try {
    for (const name of readdirSync(dirname(path))) {
      if (!name.startsWith(prefix)) continue;
      const full = join(dirname(path), name);
      try {
        if (Date.now() - statSync(full).mtimeMs > STALE_TEMP_MS) unlinkSync(full);
      } catch { /* gone already */ }
    }
  } catch { /* no directory: the write says so */ }
}

/** Set a damaged key file aside as `<file>.bad-<time>`, keeping the newest KEEP_BAD. */
function setAside(path) {
  renameSync(path, `${path}.bad-${Date.now()}-${randomBytes(3).toString('hex')}`);
  const prefix = `${basename(path)}.bad-`;
  const old = readdirSync(dirname(path)).filter((n) => n.startsWith(prefix)).sort().reverse().slice(KEEP_BAD);
  for (const name of old) {
    try { unlinkSync(join(dirname(path), name)); } catch { /* ignore */ }
  }
}

/**
 * The stored pair, made first if there is none. Never throws; never puts a key
 * in `detail`. Making (and replacing a damaged file with no subscribers) is
 * done under a lock file, so any number of racing boots end with one pair.
 * @param {object} [opts]
 * @param {string} [opts.path]
 * @param {() => number} [opts.subscriptionCount]  browsers that a new pair would orphan
 * @param {{ info: Function, warn: Function }} [opts.logger]
 * @returns {VapidKeysResult}
 */
export function loadOrCreateVapidKeys({ path = VAPID_KEY_FILE, subscriptionCount = () => 0, logger } = {}) {
  const lock = `${path}.lock`;
  try {
    sweepTemps(path);
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      let stored = readStored(path, logger);
      if (stored && !('bad' in stored)) return { ok: true, ...stored, created: false };
      if (stored && stored.unreadable) return { ok: false, problem: 'unreadable', detail: stored.bad };
      let replaced = false;
      if (stored) {
        const count = subscriptionCount();
        if (count !== 0) {
          return {
            ok: false,
            problem: 'damaged',
            detail: `${stored.bad}; ${count} browser${count === 1 ? ' is' : 's are'} subscribed with the old pair`,
          };
        }
        replaced = true;
      }
      if (!createExclusiveFileSync(lock, Buffer.from(String(process.pid)), { mode: 0o600 })) {
        // Another start is at it: wait for its pair (or for a stale lock to go).
        try {
          if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS) unlinkSync(lock);
        } catch { /* released meanwhile */ }
        if (Date.now() > deadline) return { ok: false, problem: 'unwritable', detail: `${lock} is held by another start` };
        sleep(50);
        continue;
      }
      try {
        // Under the lock: look again, someone may have made it since.
        stored = readStored(path, logger);
        if (stored && !('bad' in stored)) return { ok: true, ...stored, created: false };
        if (stored && stored.unreadable) return { ok: false, problem: 'unreadable', detail: stored.bad };
        if (stored) setAside(path);
        const subscribed = replaced ? 0 : subscriptionCount();
        const made = generateVapidKeys();
        const body = Buffer.from(`${JSON.stringify({ publicKey: made.publicKey, privateKey: made.privateKey }, null, 2)}\n`);
        createExclusiveFileSync(path, body, { mode: 0o600 });
        const now = readStored(path, logger);
        if (!now || 'bad' in now) {
          return { ok: false, problem: 'unwritable', detail: `${path} could not be read back after it was made` };
        }
        logger?.info?.(
          replaced
            ? 'web push: the key pair file was unusable and no browser was subscribed: made a new one (vapid-keys.json; the old one is kept as vapid-keys.json.bad-*)'
            : 'web push: made a new VAPID key pair (vapid-keys.json)'
        );
        if (subscribed > 0) {
          logger?.warn?.(
            { subscriptions: subscribed },
            'web push: a new key pair was made while browsers are subscribed (the VAPID_* keys were removed from .env?): each phone re-subscribes when it opens JagHelm; until then its sends show as rejected'
          );
        }
        return { ok: true, ...now, created: true, ...(replaced ? { replaced } : {}) };
      } finally {
        try { unlinkSync(lock); } catch { /* ignore */ }
      }
    }
  } catch (err) {
    return {
      ok: false,
      problem: 'unwritable',
      detail: `can't keep the Web Push key pair in ${path} (${err?.code ?? 'error'})`,
    };
  }
}
