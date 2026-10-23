/**
 * JagHelm Secrets Manager
 * Encrypts/decrypts credentials with AES-256-GCM using DASH_SECRET from .env.
 * Stores encrypted values in data/secrets.json.
 * Falls back to .env variables when no encrypted secret exists.
 *
 * Each secret carries the origins it may be sent to (#556): `origins`, a list
 * of `scheme://host:port` (integrations/lib/origin.js), stored in clear next
 * to its encrypted value (`{ iv, data, tag, origins }`). A secret goes only
 * to a request whose own URL has one of them (integrations/lib/config.js and
 * the requests in integrations/): with none it goes nowhere. One stored
 * before #556 has no `origins` until the boot binds it to the entries that
 * use it (integrations/secretBinding.js); until then it goes nowhere too.
 * The origins never leave the store: no route answers them and nothing logs
 * them.
 */

import crypto from 'crypto';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { atomicWriteFileSync } from './util/atomicWrite.js';
import { DATA_DIR } from './util/dataDir.js';
import { createLogger } from './util/logger.js';
import { jsonFileErrorFields } from './util/parseError.js';

const log = createLogger('secrets');

const SECRETS_PATH = join(DATA_DIR, 'secrets.json');
const SALT_PATH = join(DATA_DIR, '.secrets-salt');
// Salt used by installs created before per-install salts existed. Kept so their
// already-encrypted secrets keep decrypting; never used for fresh installs.
const LEGACY_SALT = 'jaghelm-secrets-v1';

// Derive a 256-bit key from DASH_SECRET using PBKDF2
let derivedKey = null;

/**
 * Resolve the PBKDF2 salt for this install.
 *
 * A per-install RANDOM salt means two deployments sharing the same DASH_SECRET
 * no longer derive the same key — defeating cross-install precomputation and
 * rainbow attacks against the published default. The salt is not itself a
 * secret, but it's stored 0600 next to the data anyway.
 *
 * Precedence: explicit salt file → legacy static salt (only if secrets already
 * exist, so old data still decrypts) → freshly generated random salt.
 */
function getSalt() {
  if (existsSync(SALT_PATH)) {
    const s = readFileSync(SALT_PATH, 'utf8').trim();
    if (s) return s;
    // File exists but is empty/blank (truncated/corrupted). Falling back to any
    // other salt would derive a DIFFERENT key and silently fail to decrypt every
    // existing secret. Fail loud so the operator restores it instead.
    throw new Error(
      `[secrets] ${SALT_PATH} exists but is empty — refusing to derive a key with a fallback salt ` +
        `(that would corrupt access to existing secrets). Restore the salt file, or delete it AND ` +
        `data/secrets.json to start fresh.`
    );
  }
  if (existsSync(SECRETS_PATH)) {
    try {
      const existing = JSON.parse(readFileSync(SECRETS_PATH, 'utf8'));
      if (existing && Object.keys(existing).length > 0) return LEGACY_SALT;
    } catch {
      /* unreadable — fall through to a fresh salt */
    }
  }
  const fresh = crypto.randomBytes(16).toString('hex');
  try {
    atomicWriteFileSync(SALT_PATH, fresh, { mode: 0o600 });
  } catch (err) {
    log.warn({ err }, 'Could not persist per-install salt, using ephemeral');
  }
  return fresh;
}

function getKey() {
  if (derivedKey) return derivedKey;
  const secret = process.env.DASH_SECRET;
  if (!secret) {
    log.warn('DASH_SECRET not set — secrets manager disabled. Credentials will only resolve from .env.');
    return null;
  }
  // Refuse the published example placeholders — using a globally-known string as
  // the AES master key is no better than no encryption. Treat as unset.
  const PLACEHOLDERS = new Set([
    'your-random-secret-here', 'replace_me', 'changeme', 'change-me', 'secret', 'password',
  ]);
  if (PLACEHOLDERS.has(secret.toLowerCase())) {
    log.error(
      'DASH_SECRET is an example placeholder — refusing to use it as an encryption key. ' +
        'Generate a real one: `openssl rand -hex 32`. Secrets manager disabled until fixed.'
    );
    return null;
  }
  if (secret.length < 16) {
    log.warn('DASH_SECRET is weak (<16 chars). Generate a strong one with `openssl rand -hex 32` — short secrets are brute-forceable even with a unique salt.');
  }
  derivedKey = crypto.pbkdf2Sync(secret, getSalt(), 100000, 32, 'sha256');
  return derivedKey;
}

// ── In-memory secrets store ──
let secrets = {};

function loadSecrets() {
  try {
    if (existsSync(SECRETS_PATH)) {
      secrets = JSON.parse(readFileSync(SECRETS_PATH, 'utf8'));
      log.info({ count: Object.keys(secrets).length }, 'Loaded encrypted secrets');
    }
  } catch (err) {
    // A parse error as its reason and position: V8's message quotes the file (#504).
    log.error(jsonFileErrorFields(err), 'Failed to load secrets.json');
    secrets = {};
  }
}

/** Write `store` to secrets.json. A write that fails is logged and thrown. */
function persistSecrets(store) {
  try {
    // Atomic + 0600: a crash mid-write can't truncate the encrypted store, and
    // the file is never group/world-readable.
    atomicWriteFileSync(SECRETS_PATH, JSON.stringify(store, null, 2), { mode: 0o600 });
  } catch (err) {
    log.error({ err }, 'Failed to save secrets.json');
    throw err;
  }
}

/**
 * Make `change` to a copy of the store and, when it answers something truthy
 * (it changed something), write the copy; the store becomes the copy only
 * once secrets.json holds it. A write that fails throws and leaves the store
 * as it was (#502): a secret is never held only in memory, to vanish at the
 * next restart, while its caller reports it stored. Returns what `change`
 * answers.
 */
function changeStore(change) {
  const next = { ...secrets };
  const result = change(next);
  if (result) {
    persistSecrets(next);
    secrets = next;
  }
  return result;
}

/** `origins` as stored: text, each once, in order. */
function originList(origins) {
  return [...new Set((Array.isArray(origins) ? origins : []).filter((o) => typeof o === 'string' && o))];
}

/**
 * Encrypt a plaintext value and store it, with the origins it may be sent to
 * (#556; none: it goes nowhere). False when there is no key (DASH_SECRET);
 * throws when secrets.json can't be written (changeStore).
 * @param {string} name
 * @param {string} plaintext
 * @param {{ origins?: string[] }} [opts]
 */
export function setSecret(name, plaintext, { origins = [] } = {}) {
  const key = getKey();
  if (!key) return false;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  const stored = { iv: iv.toString('hex'), data: encrypted, tag, origins: originList(origins) };
  return changeStore((next) => {
    next[name] = stored;
    return true;
  });
}

/**
 * Decrypt and return a stored secret.
 */
export function getSecret(name) {
  const key = getKey();
  if (!key) return null;

  const entry = secrets[name];
  if (!entry) return null;

  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(entry.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(entry.tag, 'hex'));
    let decrypted = decipher.update(entry.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    log.error({ name, err }, 'Failed to decrypt');
    return null;
  }
}

/**
 * The origins `name` may be sent to (#556), a copy: none ([]) for one stored
 * before #556 and not bound yet; null when there is no such secret.
 * @param {string} name
 * @returns {string[] | null}
 */
export function getSecretOrigins(name) {
  if (!Object.hasOwn(secrets, name)) return null;
  return originList(secrets[name].origins);
}

/**
 * The origins `name` has once `value` is entered for `origin` (#556): the
 * value it already holds, entered again, adds the origin to those it has (a
 * password two entries share, entered for the second); any other value has
 * only that origin, so a value the store held is never sent where it wasn't
 * entered. A null origin (an address that has none) adds nothing. Compares in
 * constant time; changes nothing.
 * @param {string} name
 * @param {string} value
 * @param {string | null} origin
 */
export function originsOnEntry(name, value, origin) {
  const own = origin ? [origin] : [];
  const stored = getSecret(name);
  if (stored === null) return own;
  const a = Buffer.from(stored, 'utf8');
  const b = Buffer.from(String(value), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return own;
  return originList([...(getSecretOrigins(name) || []), ...own]);
}

/** The secrets stored before #556 and not bound to any origin yet. */
export function unboundSecretNames() {
  return Object.keys(secrets).filter((name) => !Array.isArray(secrets[name].origins));
}

/**
 * Bind each unbound secret named in `byName` to its origins, in one write of
 * secrets.json. A secret already bound (even to none) is left as it is, and a
 * name not stored is skipped. Returns how many were bound. Throws when
 * secrets.json can't be written, and then binds none (changeStore).
 * @param {Record<string, string[]>} byName
 */
export function bindSecretOrigins(byName) {
  return changeStore((next) => {
    let bound = 0;
    for (const [name, origins] of Object.entries(byName)) {
      if (!Object.hasOwn(next, name) || Array.isArray(next[name].origins)) continue;
      next[name] = { ...next[name], origins: originList(origins) };
      bound++;
    }
    return bound;
  });
}

/**
 * Delete a secret. Throws when secrets.json can't be written (changeStore).
 */
export function deleteSecret(name) {
  return deleteSecrets([name]) > 0;
}

/**
 * Delete each of `names` that is stored, with one write of secrets.json.
 * Returns how many were deleted. Throws when secrets.json can't be written,
 * and then deletes none (changeStore).
 */
export function deleteSecrets(names) {
  return changeStore((next) => {
    let deleted = 0;
    for (const name of names) {
      if (!Object.hasOwn(next, name)) continue;
      delete next[name];
      deleted++;
    }
    return deleted;
  });
}

/**
 * Copy the secret stored under `from` to `to`, replacing what `to` held. The
 * stored value is copied as it is, still encrypted, with its origins, so no
 * plaintext is handled and it works without DASH_SECRET. Returns false, and changes nothing, when
 * there is no secret under `from`. Throws when secrets.json can't be written
 * (changeStore).
 */
export function copySecret(from, to) {
  if (!Object.hasOwn(secrets, from)) return false;
  return changeStore((next) => {
    next[to] = { ...next[from] };
    if (Array.isArray(next[from].origins)) next[to].origins = [...next[from].origins];
    return true;
  });
}

/** secrets.json's bytes, null when there is none, undefined when it can't be read. */
function storeFileBytes() {
  try {
    return readFileSync(SECRETS_PATH);
  } catch (err) {
    return err.code === 'ENOENT' ? null : undefined;
  }
}

/**
 * The store as it is now, for restoreSecrets to put back (#502): every name
 * with its stored value, still encrypted, and secrets.json's bytes. Taken
 * before a change that is undone if what it goes with fails, such as an
 * integration's save whose services.yaml write is refused.
 */
export function snapshotSecrets() {
  return { secrets: { ...secrets }, file: storeFileBytes() };
}

/**
 * Put the store back as `snapshot` found it: the same names, in the same
 * order, with the same values, and secrets.json byte-for-byte as it was (or
 * gone again, when there was none). The file is written only when it changed
 * since, so a change whose own write failed (a full disk) needs no write to
 * undo. When it couldn't be read at the snapshot, it is written from the
 * restored store. Never throws: a write that fails is logged.
 */
export function restoreSecrets(snapshot) {
  secrets = { ...snapshot.secrets };
  if (snapshot.file === undefined) {
    try {
      persistSecrets(secrets);
    } catch {
      /* logged by persistSecrets */
    }
    return;
  }
  const now = storeFileBytes();
  if (snapshot.file === null ? now === null : now && now.equals(snapshot.file)) return;
  try {
    if (snapshot.file === null) unlinkSync(SECRETS_PATH);
    else atomicWriteFileSync(SECRETS_PATH, snapshot.file, { mode: 0o600 });
  } catch (err) {
    log.error({ err }, 'Failed to restore secrets.json');
  }
}

/**
 * List all secret key names (never values).
 */
export function listSecretKeys() {
  return Object.keys(secrets);
}

/**
 * Check if a secret exists.
 */
export function hasSecret(name) {
  return name in secrets;
}

/**
 * Resolve a credential by checking .env first, then encrypted secrets.
 * envKey: e.g. 'PHOTOPRISM_URL'
 * secretKey: e.g. 'photoprism_url'
 * Returns the plaintext value or null. `read` reads the secret (getSecret by
 * default; the connection test passes one that sees what its save would
 * store, #427).
 */
export function resolveCredential(envKey, secretKey, read = getSecret) {
  // .env takes priority
  const envVal = process.env[envKey];
  if (envVal && envVal !== '' && envVal !== 'REPLACE_ME') {
    return envVal;
  }
  // Fall back to encrypted secret
  return read(secretKey);
}

/**
 * Initialize the secrets manager. Call once at startup.
 */
export function initSecrets() {
  loadSecrets();
  getKey(); // Derive key early so we fail fast if DASH_SECRET is bad
}
