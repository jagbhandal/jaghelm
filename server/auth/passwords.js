/**
 * Password hashing, verification, and on-disk override storage.
 *
 * Authentication operates in three modes, in order of precedence:
 *   1. UI-set password — stored as a scrypt hash in data/auth.json
 *   2. Environment fallback — DASH_PASS (plaintext compare; for first boot)
 *   3. No auth — when neither is present, the dashboard is open
 *
 * Hash format is `scrypt:<salt-hex>:<hash-hex>`. Legacy SHA-256 hashes
 * (64 hex chars, no colon) are accepted on login and silently upgraded
 * to scrypt on the next successful check.
 */

import crypto from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(__dirname, '..', '..', 'data', 'auth.json');

const AUTH_USER = process.env.DASH_USER || 'admin';
const AUTH_PASS_ENV = process.env.DASH_PASS || '';

let storedPasswordHash = loadAuthOverride();

function loadAuthOverride() {
  try {
    if (existsSync(AUTH_FILE)) {
      const data = JSON.parse(readFileSync(AUTH_FILE, 'utf8'));
      return data.passwordHash || null;
    }
  } catch (err) {
    console.warn('[auth] Failed to load auth override:', err.message);
  }
  return null;
}

function persistHash(hash) {
  writeFileSync(
    AUTH_FILE,
    JSON.stringify({ passwordHash: hash, updatedAt: new Date().toISOString() }, null, 2)
  );
}

/** Hash a plaintext password with scrypt + a fresh random salt. */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

/** Constant-time compare a plaintext password against a stored hash string. */
function verifyPassword(password, stored) {
  if (stored.startsWith('scrypt:')) {
    const [, salt, hash] = stored.split(':');
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'));
  }
  // Legacy SHA-256 (no salt, plain hex) — kept for migration only
  if (stored.length === 64 && !stored.includes(':')) {
    const sha = crypto.createHash('sha256').update(password).digest('hex');
    return sha === stored;
  }
  return false;
}

/** Username configured for the dashboard (not a secret). */
export function getAuthUser() {
  return AUTH_USER;
}

/** True if any form of auth is enabled. */
export function authEnabled() {
  return Boolean(
    storedPasswordHash ||
    (AUTH_PASS_ENV && AUTH_PASS_ENV !== 'REPLACE_ME' && AUTH_PASS_ENV.length > 0)
  );
}

/**
 * Verify a plaintext password against the active credential source.
 * Migrates legacy SHA-256 hashes to scrypt on a successful match.
 */
export function checkPassword(password) {
  if (storedPasswordHash) {
    const match = verifyPassword(password, storedPasswordHash);
    if (match && !storedPasswordHash.startsWith('scrypt:')) {
      console.log('[auth] Migrating password hash from SHA-256 to scrypt');
      storedPasswordHash = hashPassword(password);
      try {
        persistHash(storedPasswordHash);
      } catch (err) {
        console.error('[auth] Failed to save migrated hash:', err.message);
      }
    }
    return match;
  }
  return password === AUTH_PASS_ENV;
}

/**
 * Replace the stored password with a new scrypt hash and persist it.
 * Caller is responsible for clearing existing sessions.
 */
export function setPassword(newPassword) {
  storedPasswordHash = hashPassword(newPassword);
  persistHash(storedPasswordHash);
}
