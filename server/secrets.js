/**
 * JagHelm Secrets Manager
 * Encrypts/decrypts credentials with AES-256-GCM using DASH_SECRET from .env.
 * Stores encrypted values in data/secrets.json.
 * Falls back to .env variables when no encrypted secret exists.
 */

import crypto from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { atomicWriteFileSync } from './util/atomicWrite.js';
import { DATA_DIR } from './util/dataDir.js';

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
    console.warn('[secrets] Could not persist per-install salt, using ephemeral:', err.message);
  }
  return fresh;
}

function getKey() {
  if (derivedKey) return derivedKey;
  const secret = process.env.DASH_SECRET;
  if (!secret) {
    console.warn('[secrets] DASH_SECRET not set — secrets manager disabled. Credentials will only resolve from .env.');
    return null;
  }
  // Refuse the published example placeholders — using a globally-known string as
  // the AES master key is no better than no encryption. Treat as unset.
  const PLACEHOLDERS = new Set([
    'your-random-secret-here', 'replace_me', 'changeme', 'change-me', 'secret', 'password',
  ]);
  if (PLACEHOLDERS.has(secret.toLowerCase())) {
    console.error(
      '[secrets] DASH_SECRET is an example placeholder — refusing to use it as an encryption key. ' +
        'Generate a real one: `openssl rand -hex 32`. Secrets manager disabled until fixed.'
    );
    return null;
  }
  if (secret.length < 16) {
    console.warn('[secrets] DASH_SECRET is weak (<16 chars). Generate a strong one with `openssl rand -hex 32` — short secrets are brute-forceable even with a unique salt.');
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
      console.log('[secrets] Loaded %d encrypted secrets', Object.keys(secrets).length);
    }
  } catch (err) {
    console.error('[secrets] Failed to load secrets.json:', err.message);
    secrets = {};
  }
}

function persistSecrets() {
  try {
    // Atomic + 0600: a crash mid-write can't truncate the encrypted store, and
    // the file is never group/world-readable.
    atomicWriteFileSync(SECRETS_PATH, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error('[secrets] Failed to save secrets.json:', err.message);
  }
}

/**
 * Encrypt a plaintext value and store it.
 */
export function setSecret(name, plaintext) {
  const key = getKey();
  if (!key) return false;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  secrets[name] = {
    iv: iv.toString('hex'),
    data: encrypted,
    tag,
  };
  persistSecrets();
  return true;
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
    console.error('[secrets] Failed to decrypt %s:', name, err.message);
    return null;
  }
}

/**
 * Delete a secret.
 */
export function deleteSecret(name) {
  if (!(name in secrets)) return false;
  delete secrets[name];
  persistSecrets();
  return true;
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
 * Returns the plaintext value or null.
 */
export function resolveCredential(envKey, secretKey) {
  // .env takes priority
  const envVal = process.env[envKey];
  if (envVal && envVal !== '' && envVal !== 'REPLACE_ME') {
    return envVal;
  }
  // Fall back to encrypted secret
  return getSecret(secretKey);
}

/**
 * Initialize the secrets manager. Call once at startup.
 */
export function initSecrets() {
  loadSecrets();
  getKey(); // Derive key early so we fail fast if DASH_SECRET is bad
}
