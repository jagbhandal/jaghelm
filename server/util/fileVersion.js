/**
 * The version of a file a client saves over (#423, #547): services.yaml and
 * display-config.json, one mechanism for both.
 *
 * A version is an HMAC-SHA256 of the file's bytes on disk, keyed per install,
 * so it survives a restart and changes with any edit, by hand or by JagHelm,
 * and two readers of the same bytes agree on it. A missing file has one too
 * (VERSION_ABSENT), so the first save can name it.
 *
 * Over HTTP a read answers the version as a strong ETag, and a write must send
 * it back in If-Match: none is a 428 (refuseWithoutVersion), one that is no
 * longer the file's a 409 with the version now (refuseStale). The route does
 * its read, the compare and the write in one synchronous handler, so nothing
 * writes in between.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { createExclusiveFileSync } from './atomicWrite.js';
import { DATA_DIR } from './dataDir.js';
import { createLogger } from './logger.js';

const log = createLogger('config');

const VERSION_KEY_PATH = join(DATA_DIR, 'config-version.key');
const VERSION_KEY_BYTES = 32;

/** The version of a file that isn't there. No HMAC is this word. */
export const VERSION_ABSENT = 'absent';

// The key versions are made with, once read (versionKey).
let versionKeyBytes = null;

/**
 * The key every version is made with: 32 random bytes in
 * DATA_DIR/config-version.key, mode 0600, made on first use (#423). A plain
 * hash of services.yaml, seen in a HAR file or a screenshot, would let anyone
 * rebuild a file JagHelm wrote from the masked read and test guesses at a weak
 * plaintext credential in it offline. Not DASH_SECRET: the installs without
 * one are the ones that still keep plaintext credentials in the file.
 *
 * Two boots racing to make it end up with one key (createExclusiveFileSync).
 * A key file that can't be read, or isn't 32 bytes, throws, at boot
 * (config.js loadConfig) and on every read after: a key made up for this run
 * would change every version at the next restart. The error names the file,
 * never its content. Losing the file costs nothing but one refused save per
 * open screen: the next boot makes a new key, so every version changes once.
 */
export function versionKey() {
  if (versionKeyBytes) return versionKeyBytes;
  let key = readVersionKey();
  if (!key) {
    createExclusiveFileSync(VERSION_KEY_PATH, randomBytes(VERSION_KEY_BYTES), { mode: 0o600 });
    // Ours, or the one another boot made first.
    key = readVersionKey();
    if (!key) throw new Error(`${VERSION_KEY_PATH} vanished as it was made`);
    log.info(
      'Made a new key for the versions of services.yaml and display-config.json (config-version.key)'
    );
  }
  versionKeyBytes = key;
  return key;
}

/** The key on disk, or null when there is no key file. */
function readVersionKey() {
  let bytes;
  try {
    bytes = readFileSync(VERSION_KEY_PATH);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(
      `Can't read ${VERSION_KEY_PATH} (${err.code}), the key for the config files' versions: ` +
        'fix its permissions, or remove it and JagHelm makes a new one'
    );
  }
  if (bytes.length !== VERSION_KEY_BYTES) {
    throw new Error(
      `${VERSION_KEY_PATH} is not a ${VERSION_KEY_BYTES}-byte key: remove it and JagHelm makes a new one`
    );
  }
  return bytes;
}

/**
 * The version of a file with these bytes: an HMAC-SHA256 of them, base64url.
 * @param {Buffer | string} bytes
 */
export function versionOf(bytes) {
  return createHmac('sha256', versionKey()).update(bytes).digest('base64url');
}

/**
 * The file at `path` now: its bytes and version; no bytes and VERSION_ABSENT
 * when there is no file; or, for a file that is there but can't be read
 * (#536), no bytes, no version and `readError`, the error. Never throws for
 * the file itself (a key that can't be used still throws, versionKey).
 * @param {string} path
 * @returns {{ bytes: Buffer | null, version: string | null, readError?: any }}
 */
export function readVersioned(path) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (err) {
    if (err.code === 'ENOENT') return { bytes: null, version: VERSION_ABSENT };
    return { bytes: null, version: null, readError: err };
  }
  return { bytes, version: versionOf(bytes) };
}

/** A read error's code in plain words, for the board and Settings (#536). */
const READ_ERROR_WORDS = new Map([
  ['EACCES', 'permission denied'],
  ['EPERM', 'operation not permitted'],
  ['EISDIR', "it's a directory"],
  ['EIO', 'I/O error'],
  ['ELOOP', 'too many symlinks'],
  ['ENOTDIR', "its folder isn't a directory"],
  ['EMFILE', 'too many open files'],
  ['ENFILE', 'too many open files'],
  ['EBUSY', 'busy'],
]);

/**
 * A read error's code ("EACCES"), or null when it has none that looks like one.
 * @param {any} err
 * @returns {string | null}
 */
export function readErrorCode(err) {
  const code = err?.code;
  return typeof code === 'string' && /^E[A-Z0-9]{1,20}$/.test(code) ? code : null;
}

/**
 * A read error (readVersioned's `readError`) in plain words: "permission
 * denied", else its code, else "unknown error". Never its message, which
 * names the path.
 * @param {any} err
 */
export function readErrorWords(err) {
  const code = readErrorCode(err);
  return (code && READ_ERROR_WORDS.get(code)) || code || 'unknown error';
}

/** A version as an ETag: strong, quoted. */
export const etagOf = (/** @type {string} */ version) => `"${version}"`;

/**
 * Whether an If-Match header names `version`: one of its entity-tags is it.
 * A `W/` prefix is ignored, since a proxy that compresses the read (nginx's
 * gzip) weakens its ETag on the way. `*` is no version: a save must say which
 * one it read.
 * @param {string} header
 * @param {string} version
 */
export function ifMatchHits(header, version) {
  const want = etagOf(version);
  return header.split(',').some((part) => part.trim().replace(/^W\//, '') === want);
}

/**
 * The version a write names (its If-Match), or null after answering 428 for
 * a write that names none, with `error`, the route's words for it.
 * @param {any} req
 * @param {any} res
 * @param {string} error
 * @returns {string | null}
 */
export function versionNamed(req, res, error) {
  const ifMatch = req.get('If-Match');
  if (ifMatch) return ifMatch;
  res.status(428).json({ error });
  return null;
}

/**
 * Answer a write over a version that is no longer the file's: 409
 * `{ error, stale: true }`, with the version now as its ETag when there is
 * one, and nothing written.
 * @param {any} res
 * @param {string} error
 * @param {string | null} [version]
 */
export function refuseStale(res, error, version = null) {
  if (version) res.set('ETag', etagOf(version));
  return res.status(409).json({ error, stale: true });
}
