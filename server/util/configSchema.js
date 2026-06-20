// @ts-check
/**
 * Validation for the two config-write boundaries (POST /api/services/config and
 * POST /api/display-config). These persist client-supplied structures to disk,
 * so they're the real ingress to validate.
 *
 * Permissive by design: the configs are user-extensible, so we bound the size
 * and validate the known/dangerous fields, but .passthrough() preserves
 * forward-compatible extra keys rather than rejecting otherwise-valid configs.
 */
import { z } from 'zod';

const DEFAULT_MAX_BYTES = 512 * 1024;

export const servicesConfigSchema = z
  .object({
    nodes: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
    services: z.record(z.string(), z.unknown()).optional(),
    integrations: z.record(z.string(), z.unknown()).optional(),
    links: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const displayConfigSchema = z
  .object({
    theme: z.string().max(64).optional(),
    // Floor matches refresh.js MIN_INTERVAL_SECONDS — a smaller value would
    // validate here but be silently ignored by the refresh loop (inert config).
    refreshInterval: z.number().int().min(10).max(86_400).optional(),
    gridColumns: z.number().int().min(1).max(48).optional(),
  })
  .passthrough();

// Reserved keys are never valid config; they exist only to seed prototype
// pollution in a future merge-based consumer, and .passthrough() would otherwise
// preserve them verbatim. Checked at ANY depth (a nested __proto__ is the real
// vector — a top-level-only guard gives false completeness).
const RESERVED_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * A URL value with an explicit non-http(s)/mailto scheme (e.g. javascript:, data:).
 * @param {unknown} v
 * @returns {boolean}
 */
function isUnsafeUrl(v) {
  if (typeof v !== 'string') return false;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(v.trim());
  if (!m) return false; // relative / bare host -> fine
  return !['http', 'https', 'mailto'].includes(m[1].toLowerCase());
}

/**
 * DFS the parsed config rejecting reserved keys + unsafe `url` schemes at any
 * depth. A stored `javascript:` link URL would execute in the SPA origin when
 * clicked (the render-boundary guard in src/utils/safeUrl.js is the load-bearing
 * defense for the watcher-loaded YAML path, but rejecting here blocks the API +
 * BackupTab-import write paths). Size is already capped, so the walk is bounded.
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {string|null} an error message, or null if clean
 */
function scanConfig(value, depth = 0) {
  if (depth > 50 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const e = scanConfig(item, depth + 1);
      if (e) return e;
    }
    return null;
  }
  const obj = /** @type {Record<string, unknown>} */ (value);
  for (const k of Object.keys(obj)) {
    if (RESERVED_KEYS.includes(k)) return `Reserved key not allowed: ${k}`;
    if (k === 'url' && isUnsafeUrl(obj[k])) {
      return "Unsafe URL scheme in 'url' (only http/https/mailto allowed)";
    }
    const e = scanConfig(obj[k], depth + 1);
    if (e) return e;
  }
  return null;
}

/**
 * Validate a request body against a schema + a byte cap.
 * @param {import('zod').ZodTypeAny} schema
 * @param {*} body
 * @param {{ maxBytes?: number }} [opts]
 * @returns {{ ok: true, data: any } | { ok: false, status: number, error: string }}
 */
export function validateConfig(schema, body, opts = {}) {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'Config must be a JSON object' };
  }
  let serialized;
  try {
    serialized = JSON.stringify(body);
  } catch {
    return { ok: false, status: 400, error: 'Config is not serializable' };
  }
  if (serialized.length > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `Config too large (max ${Math.round(maxBytes / 1024)}KB)`,
    };
  }
  const violation = scanConfig(body);
  if (violation) return { ok: false, status: 400, error: violation };
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first.path.length ? first.path.join('.') : '(root)';
    return { ok: false, status: 400, error: `Invalid config at ${where}: ${first.message}` };
  }
  return { ok: true, data: parsed.data };
}
