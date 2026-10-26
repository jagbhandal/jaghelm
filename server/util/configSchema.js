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
import { BACKUP_AGE_LIMITS } from '../backupAgeLines.js';
import { DISK_FORECAST_LIMITS } from '../diskForecastLines.js';
import { EXPIRY_LIMITS, cleanTargets } from '../expiryTargets.js';
import { DRIFT_STALE_LIMITS } from '../driftReports.js';

import { sanitizeAlerts } from '../push/alertRules.js';

const DEFAULT_MAX_BYTES = 512 * 1024;

// A container's monitor mapping (#240): a Kuma monitor's name, or false for no
// monitor at all; null (or no key) leaves the container to name matching.
const monitorMapping = z.union([z.string(), z.literal(false), z.null()]);

// One entry under `services:`, keyed by container name. Only the monitor
// mapping is checked; display_name, icon and any other key pass through. A
// `monitor_per_node` key that is no node is not refused here: the refresh loop
// warns once about it (monitors.js checkMonitorMappings).
const serviceOverrideSchema = z
  .object({
    monitor: monitorMapping.optional(),
    monitor_per_node: z.record(z.string(), monitorMapping).optional(),
    // Per node name and icon (#636): node key to a string.
    // A hand-edited value of another type (YAML reads 2024 as a number) must
    // not block every save the UI makes with the whole config: it is kept as is
    // and the refresh loop ignores it (monitors.js overrideOf).
    display_name_per_node: z.record(z.string(), z.unknown()).optional(),
    icon_per_node: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .nullable();

export const servicesConfigSchema = z
  .object({
    nodes: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
    services: z.record(z.string(), serviceOverrideSchema).optional(),
    integrations: z.record(z.string(), z.unknown()).optional(),
    // The node a Kuma monitor no container carries is shown on (#644): monitor
    // name to node key. It must be a map; a value that is no node (a hand edit)
    // is not refused, the refresh loop warns once (monitors.js checkMonitorNodes).
    monitor_nodes: z.record(z.string(), z.unknown()).optional(),
    // How a Compose stack is grouped into one row (#642): "node:project" to
    // { lead, ungroup, split, display_name }. It must be a map; the entries are
    // read where they are used (stacks.js), a bad one warned once, so a hand
    // edit never refuses a save.
    stacks: z.record(z.string(), z.unknown()).optional(),
    // No `links` rule: services.yaml has no links (they live in display-config.json).
    // Files generated before #265 carry a `links` object, which must still save;
    // scanConfig below still rejects an unsafe URL inside it.
  })
  .passthrough();

/**
 * The nodes' order (#667): node keys, first to last. The read drops a value
 * that is none. A key over MAX_ORDER_KEY characters is dropped from the list
 * alone (node keys have no length limit, so one long key must not cost the
 * whole order); that node then sorts after the listed ones.
 */
const MAX_ORDER_KEY = 64;
export const nodeOrderSchema = z
  .array(z.string())
  .max(64)
  .transform((keys) => keys.filter((k) => k.length <= MAX_ORDER_KEY));

/**
 * Where the disk forecast turns amber and red (#670), in days left:
 * `{ warn, crit }`, whole days, `crit` under `warn` (diskForecastLines.js,
 * which the web reads too). The forecast itself is the server's; these lines
 * are only how it is drawn, so a change shows on the next render. The read
 * drops a value that is none.
 */
export const diskForecastDaysSchema = z
  .object({
    warn: z.number().int().min(DISK_FORECAST_LIMITS.min).max(DISK_FORECAST_LIMITS.max),
    crit: z.number().int().min(DISK_FORECAST_LIMITS.min).max(DISK_FORECAST_LIMITS.max),
  })
  .refine((v) => v.crit < v.warn);

/**
 * The expiry tracker's TLS targets (#676): `{ tls: ['host', 'host:port', ...] }`.
 * Read and written as the entries that parse (expiryTargets.js cleanTargets: canonical,
 * once each, at most 30), so one bad row never costs the list or a save. A value
 * that is not this shape reads as unset.
 */
export const expirySchema = z
  .object({ tls: z.array(z.unknown()).max(500).transform((list) => cleanTargets(list)) })
  .transform((v) => ({ tls: v.tls }));

const expiryDay = z.number().int().min(EXPIRY_LIMITS.min).max(EXPIRY_LIMITS.max);

/** The expiry lines (#676): `{ warn, crit }` whole days, `crit` under `warn`. */
export const expiryDaysSchema = z
  .object({ warn: expiryDay, crit: expiryDay })
  .refine((v) => v.crit < v.warn);

/**
 * Where a backup's age turns amber and red (#675), in hours since its last
 * good run: `{ warn, crit }`, whole hours, `crit` over `warn`
 * (backupAgeLines.js, which the web reads too). Only how the Backups section is
 * drawn. The read drops a value that is none.
 */
export const backupAgeHoursSchema = z
  .object({
    warn: z.number().int().min(BACKUP_AGE_LIMITS.min).max(BACKUP_AGE_LIMITS.max),
    crit: z.number().int().min(BACKUP_AGE_LIMITS.min).max(BACKUP_AGE_LIMITS.max),
  })
  .refine((v) => v.crit > v.warn);
/** Hours without a drift report before the row reads "unknown" (#674); the read drops a value that is none. */
export const driftStaleHoursSchema = z
  .number()
  .int()
  .min(DRIFT_STALE_LIMITS.min)
  .max(DRIFT_STALE_LIMITS.max);

// Two keys are hand-edited and validated where they are read, not here, so a
// web save (which sends back the whole config it read) is never refused over
// them: `pushThresholds` (status/thresholds.js) and `backupJobs`, the cron jobs
// that are backups (status/backupJobs.js, #291), whose bad entries the loop
// drops with one log line.
export const displayConfigSchema = z
  .object({
    theme: z.string().max(64).optional(),
    // Floor matches refresh.js MIN_INTERVAL_SECONDS — a smaller value would
    // validate here but be silently ignored by the refresh loop (inert config).
    refreshInterval: z.number().int().min(10).max(86_400).optional(),
    // The Overview's show/hide switches (#307, src/shell/overviewSections.js):
    // a section id to on or off, as Settings → Appearance saves them.
    overviewSections: z.record(z.string(), z.boolean()).optional(),
    // The Overview's arrangement (#330, src/shell/overviewLayout.js): the order
    // of its sections and the pinned services' uids, never positions. Bounded,
    // and a value of another shape is not refused (a hand edit or a later
    // build's must not fail a whole save): it reads as unset, and the
    // Overview then draws its default order.
    overviewLayout: z
      .object({
        order: z.array(z.string().max(64)).max(32).optional().catch(undefined),
        pinned: z.array(z.string().max(200)).max(500).optional().catch(undefined),
      })
      .optional()
      .catch(undefined),
    // Settings → Appearance's accent, density and typeface (#321, src/shell/appearance.js).
    // An unknown value is not refused (a hand edit or a later build's id must not
    // fail a whole save): it reads as unset, and the screen then shows the default.
    accent: z.enum(['violet', 'fuchsia', 'cyan']).optional().catch(undefined),
    density: z.enum(['comfortable', 'compact']).optional().catch(undefined),
    // Its typeface (#660): a src/ui/typefaces.js id (configSchema.test.js keeps
    // the list equal to it). An unknown id reads as unset, so the screen shows
    // the default, and never fails a save. The old `fontFamily` presets pass
    // through unread (the client maps them once, src/shell/appearance.js).
    typeface: z.enum(['manrope', 'plus-jakarta-sans', 'montserrat']).optional().catch(undefined),
    // Settings → Appearance's custom themes (#331, server/themes.js): a list of
    // { id, name, base, tokens }, at most MAX_THEMES (a longer one is refused at
    // 64, so a hand edit can't make the file huge). The schema checks only that it is a
    // list: each
    // theme is validated, with the contrast rules, where a save adds or changes
    // one (routes/displayConfig.js) and where the client loads it, so a theme
    // that fails is listed as rejected and can be removed, never dropped here.
    themes: z.array(z.unknown()).max(64).optional(),
    // The order Settings → Nodes & Services puts the nodes in (#667,
    // src/shell/nodeOrder.js): node keys, first to last. Bounded; a value of
    // another shape reads as unset (the nodes then keep services.yaml's
    // order) and never fails a whole save.
    nodeOrder: nodeOrderSchema.optional().catch(undefined),
    // Smarter alerts (#669, push/alertRules.js): the burst window, quiet hours,
    // time zone and known causes. Kept as the parts that are valid (a bad part
    // reads as its default); it never refuses a save, and the read says the same.
    alerts: z
      .unknown()
      .transform((v) => sanitizeAlerts(v))
      .optional(),
    // Settings → Nodes & Services' disk forecast lines (#670): days left at
    // which the forecast turns amber and red. Unset reads as 14 and 3; a value
    // of another shape reads as unset and never fails a whole save.
    diskForecastDays: diskForecastDaysSchema.optional().catch(undefined),
    // The expiry tracker (#676): the TLS targets to read, and the days left at
    // which an item turns amber and red as one pair (default 21 and 7; the earlier
    // separate expiryWarnDays and expiryCritDays are still read, expiryLines in
    // expiryTargets.js). A value
    // of another shape reads as unset and never fails a whole save.
    expiry: expirySchema.optional().catch(undefined),
    expiryDays: expiryDaysSchema.optional().catch(undefined),
    // Settings → Nodes & Services' backup freshness lines (#675): hours since a
    // backup's last good run at which the Backups section turns amber and red.
    // Unset reads as 36 and 72; a value of another shape reads as unset.
    backupAgeHours: backupAgeHoursSchema.optional().catch(undefined),
    // Settings → Nodes & Services' config drift row (#674): hours without any
    // report before it reads "unknown". Unset reads as 36; a value of another
    // shape reads as unset and never fails a whole save.
    driftStaleHours: driftStaleHoursSchema.optional().catch(undefined),
    // Settings → Appearance's units and locale (#322, #260): one setting each.
    // `units` is metric (°C, the default) or
    // imperial (°F); `locale` a BCP 47 tag, or empty for the device's own. A
    // value neither knows reads as unset, never fails a save.
    units: z.enum(['metric', 'imperial']).optional().catch(undefined),
    locale: z
      .string()
      .max(35)
      .regex(/^([A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,4})?$/)
      .optional()
      .catch(undefined),
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
 * @typedef {{ path: (string | number)[], kind: 'reserved' | 'url', message: string }} Violation
 */

/**
 * DFS the parsed config for reserved keys + unsafe `url` schemes at any
 * depth, each with its path (the reserved key's, or the `url`'s). A stored
 * `javascript:` link URL would execute in the SPA origin when clicked (the
 * render-boundary guard in src/utils/safeUrl.js is the load-bearing defense
 * for the watcher-loaded YAML path, but rejecting here blocks the API +
 * BackupTab-import write paths). Size is already capped, so the walk is
 * bounded. The display config's read drops what it finds (#547), so a bad
 * hand edit can't refuse every save.
 * @param {unknown} value
 * @param {(string | number)[]} [path]
 * @returns {Violation[]}
 */
export function findViolations(value, path = []) {
  if (path.length > 50 || value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, i) => findViolations(item, [...path, i]));
  const obj = /** @type {Record<string, unknown>} */ (value);
  /** @type {Violation[]} */
  const found = [];
  for (const k of Object.keys(obj)) {
    if (RESERVED_KEYS.includes(k)) {
      found.push({
        path: [...path, k],
        kind: 'reserved',
        message: `Reserved key not allowed: ${k}`,
      });
      continue;
    }
    if (k === 'url' && isUnsafeUrl(obj[k])) {
      found.push({
        path: [...path, k],
        kind: 'url',
        message: "Unsafe URL scheme in 'url' (only http/https/mailto allowed)",
      });
    }
    found.push(...findViolations(obj[k], [...path, k]));
  }
  return found;
}

/**
 * The first reserved key or unsafe `url` scheme in the config (findViolations).
 * @param {unknown} value
 * @returns {string|null} an error message, or null if clean
 */
function scanConfig(value) {
  return findViolations(value)[0]?.message ?? null;
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
