/**
 * JagHelm Secrets Manager
 * Encrypts/decrypts credentials with AES-256-GCM using DASH_SECRET from .env.
 * Stores encrypted values in data/secrets.json.
 * Falls back to .env variables when no encrypted secret exists.
 */

import crypto from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECRETS_PATH = join(__dirname, '..', 'data', 'secrets.json');

// Derive a 256-bit key from DASH_SECRET using PBKDF2
let derivedKey = null;

function getKey() {
  if (derivedKey) return derivedKey;
  const secret = process.env.DASH_SECRET;
  if (!secret) {
    console.warn('[secrets] DASH_SECRET not set — secrets manager disabled. Credentials will only resolve from .env.');
    return null;
  }
  // Static salt — acceptable for homelab use. The secret itself provides entropy.
  const salt = 'jaghelm-secrets-v1';
  derivedKey = crypto.pbkdf2Sync(secret, salt, 100000, 32, 'sha256');
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
    writeFileSync(SECRETS_PATH, JSON.stringify(secrets, null, 2), 'utf8');
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
