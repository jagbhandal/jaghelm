// @ts-check
/**
 * Config drift reports (#674): what a host's drift check pushes to
 * POST /api/drift/report, and the one place that decides whether a push is
 * well formed. JagHelm runs no check and holds no SSH key: a timer on a host
 * runs the repo's drift check and sends its result here, as the PVE
 * notification webhook sends its backup results to /api/cron/report (same
 * `secret` in the body, same JAGHELM_CRON_SECRET).
 *
 * Shared by the route, the store and the web (limits and the stale default),
 * so it imports nothing.
 */

/** Hours without any report before the row reads "unknown" (Settings can change it). */
export const DRIFT_STALE_DEFAULT_HOURS = 36;
export const DRIFT_STALE_LIMITS = Object.freeze({ min: 1, max: 720 });

export const DRIFT_LIMITS = Object.freeze({
  /** Whole request body, in bytes, as sent. */
  bodyBytes: 64 * 1024,
  /** Hosts kept (one latest report each); a new host past this is refused. */
  hosts: 32,
  /** Items kept per report; more is refused, not cut, so a count never lies. */
  items: 200,
  host: 64,
  name: 256,
  kind: 32,
  detail: 500,
});

export const DRIFT_STATUSES = Object.freeze(['ok', 'drift', 'error']);

const KEYS = new Set(['secret', 'host', 'checkedAt', 'status', 'items']);
const ITEM_KEYS = new Set(['name', 'kind', 'detail']);
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Reports may be a little ahead of this clock; a day ahead is a wrong clock.
const FUTURE_SLACK_MS = 10 * 60_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * A string made safe to store and draw: control characters (newlines, escape
 * sequences) become spaces, runs of spaces collapse, the ends are trimmed.
 * React escapes it on the way out; this keeps a log line or a copied value one line.
 * @param {string} s
 */
export function cleanText(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {unknown} body  the parsed request body
 * @param {number} now    ms, for the future check
 * @returns {{ ok: true, report: { host: string, checkedAt: string, status: string, items: {name: string, kind: string, detail: string}[] } }
 *   | { ok: false, status: number, error: string }}
 */
export function validateReport(body, now = Date.now()) {
  /** @param {string} error @param {number} [status] @returns {{ ok: false, status: number, error: string }} */
  const bad = (error, status = 400) => ({ ok: false, status, error });
  if (!isObject(body)) return bad('Body must be a JSON object');
  for (const k of Object.keys(body)) if (!KEYS.has(k)) return bad(`Unknown field: ${cleanText(k).slice(0, 40)}`);

  const { host, checkedAt, status, items } = body;
  if (typeof host !== 'string' || !host) return bad('host must be a non-empty string');
  if (host.length > DRIFT_LIMITS.host) return bad('host too long', 413);
  if (!HOST_RE.test(host)) return bad('host may hold letters, digits, ".", "_" and "-" only');
  if (typeof status !== 'string' || !DRIFT_STATUSES.includes(status)) {
    return bad('status must be ok, drift or error');
  }
  if (typeof checkedAt !== 'string' || !ISO_RE.test(checkedAt)) {
    return bad('checkedAt must be an ISO 8601 time with a zone, like 2026-10-24T06:00:00Z');
  }
  const at = Date.parse(checkedAt);
  if (!Number.isFinite(at)) return bad('checkedAt is not a real time');
  if (at > now + FUTURE_SLACK_MS) return bad('checkedAt is in the future');
  if (items === undefined) return bad('items must be a list (it may be empty)');
  if (!Array.isArray(items)) return bad('items must be a list');
  if (items.length > DRIFT_LIMITS.items) return bad(`items: at most ${DRIFT_LIMITS.items}`, 413);

  /** @type {{name: string, kind: string, detail: string}[]} */
  const out = [];
  for (const it of items) {
    if (!isObject(it)) return bad('each item must be an object');
    for (const k of Object.keys(it)) if (!ITEM_KEYS.has(k)) return bad('item: unknown field');
    const { name, kind, detail } = it;
    if (typeof name !== 'string' || !cleanText(name)) return bad('item name must be a non-empty string');
    if (typeof kind !== 'string' || !cleanText(kind)) return bad('item kind must be a non-empty string');
    if (detail !== undefined && typeof detail !== 'string') return bad('item detail must be a string');
    if (name.length > DRIFT_LIMITS.name || kind.length > DRIFT_LIMITS.kind || (detail ?? '').length > DRIFT_LIMITS.detail) {
      return bad('item field too long', 413);
    }
    out.push({ name: cleanText(name), kind: cleanText(kind), detail: cleanText(detail ?? '') });
  }
  return { ok: true, report: { host, checkedAt: new Date(at).toISOString(), status, items: out } };
}

/**
 * The stale-hours setting as a usable number: whole hours in the limits, else
 * the default (a hand edit or a later build's value never breaks the row).
 * @param {unknown} v
 */
export function staleHours(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= DRIFT_STALE_LIMITS.min && v <= DRIFT_STALE_LIMITS.max
    ? v
    : DRIFT_STALE_DEFAULT_HOURS;
}
