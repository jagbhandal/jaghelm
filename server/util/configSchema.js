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
// pollution in a future merge-based consumer, and .passthrough() would
// otherwise preserve them verbatim. Reject at the validation boundary.
const RESERVED_KEYS = ['__proto__', 'constructor', 'prototype'];

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
  for (const k of RESERVED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      return { ok: false, status: 400, error: `Reserved key not allowed: ${k}` };
    }
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
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first.path.length ? first.path.join('.') : '(root)';
    return { ok: false, status: 400, error: `Invalid config at ${where}: ${first.message}` };
  }
  return { ok: true, data: parsed.data };
}
