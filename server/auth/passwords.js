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
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { atomicWriteFileSync } from '../util/atomicWrite.js';
import { DATA_DIR } from '../util/dataDir.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('auth');

const AUTH_FILE = join(DATA_DIR, 'auth.json');

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
    log.warn({ err }, 'Failed to load auth override');
  }
  return null;
}

function persistHash(hash) {
  // Atomic + 0600: a crash mid-write can't truncate the admin hash, and the
  // file is never group/world-readable.
  atomicWriteFileSync(
    AUTH_FILE,
    JSON.stringify({ passwordHash: hash, updatedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 }
  );
}

/** Hash a plaintext password with scrypt + a fresh random salt. */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

/** Constant-time compare a plaintext password against a stored hash string. */
export function verifyPassword(password, stored) {
  if (stored.startsWith('scrypt:')) {
    // A truncated/corrupt scrypt hash (bad manual edit, crash mid-write, migration
    // bug) must read as "no match", never throw — an uncaught throw here escapes the
    // sync /login handler as a 500 on EVERY attempt and permanently locks the admin out.
    try {
      const [, salt, hash] = stored.split(':');
      if (!salt || !hash) return false;
      const derived = Buffer.from(crypto.scryptSync(password, salt, 64).toString('hex'), 'hex');
      const storedBuf = Buffer.from(hash, 'hex');
      if (storedBuf.length !== derived.length) return false;
      return crypto.timingSafeEqual(derived, storedBuf);
    } catch {
      return false;
    }
  }
  // Legacy SHA-256 (no salt, plain hex) — kept for migration only.
  // Buffers are 32 bytes (SHA-256 digest), always equal length, so
  // timingSafeEqual is safe to call directly without padding.
  if (stored.length === 64 && !stored.includes(':')) {
    const sha = crypto.createHash('sha256').update(password).digest();
    const storedBuf = Buffer.from(stored, 'hex');
    if (storedBuf.length !== sha.length) return false;
    return crypto.timingSafeEqual(sha, storedBuf);
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
      log.info('Migrating password hash from SHA-256 to scrypt');
      storedPasswordHash = hashPassword(password);
      try {
        persistHash(storedPasswordHash);
      } catch (err) {
        log.error({ err }, 'Failed to save migrated hash');
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
