// @ts-check
/**
 * Settings → System → "Energy cost" (Monitoring A1, #742): the display
 * config's `energy` key read into the one shape the cost maths will use. Pure,
 * no I/O, so the save (util/configSchema.js) and the read (routes/displayConfig.js)
 * judge by the same rules, in the style of `sanitizeAlerts` (push/alertRules.js).
 *
 *   { currency: "$", rates: [ { from: "2026-01-01", perKwh: 0.14 } ] }
 *
 *   currency  a symbol of 1 to 3 characters; a missing or longer one reads as "$"
 *   rates     at most 24 rows, each a real calendar date `from` (YYYY-MM-DD) and a
 *             `perKwh` above 0 and at most 10. A row that breaks a rule is dropped,
 *             never refusing a save; a repeated `from` keeps its first row. Rows
 *             past the 24th valid one are dropped. Stored sorted by `from`.
 *
 * No valid rate leaves no `energy` key at all. Unknown keys are ignored. All of
 * it is non-secret.
 */

export const ENERGY_MAX_RATES = 24;
export const ENERGY_MAX_PER_KWH = 10;
export const ENERGY_CURRENCY_MAX = 3;
export const ENERGY_CURRENCY_DEFAULT = '$';

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

const isObject = (/** @type {unknown} */ v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Whether `s` is a real calendar date written YYYY-MM-DD (2026-02-30 is not).
 * @param {unknown} s
 */
export function validDay(s) {
  if (typeof s !== 'string') return false;
  const m = YMD.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1) return false;
  const t = new Date(Date.UTC(2000, mo - 1, d));
  t.setUTCFullYear(y); // Date.UTC maps years 0 to 99 to 19xx
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/**
 * The `energy` value as the config keeps it: only the parts that are valid.
 * undefined for anything that is no object or holds no valid rate. Pure,
 * never throws.
 * @param {unknown} raw
 * @returns {{ currency: string, rates: { from: string, perKwh: number }[] } | undefined}
 */
export function sanitizeEnergy(raw) {
  if (!isObject(raw)) return undefined;
  const src = /** @type {Record<string, any>} */ (raw);
  if (!Array.isArray(src.rates)) return undefined;
  /** @type {Map<string, number>} */
  const byDay = new Map();
  for (const item of src.rates) {
    if (byDay.size === ENERGY_MAX_RATES) break;
    if (!isObject(item)) continue;
    const { from, perKwh } = /** @type {Record<string, any>} */ (item);
    if (!validDay(from) || byDay.has(from)) continue;
    if (typeof perKwh !== 'number' || !Number.isFinite(perKwh)) continue;
    if (!(perKwh > 0 && perKwh <= ENERGY_MAX_PER_KWH)) continue;
    byDay.set(from, perKwh);
  }
  if (byDay.size === 0) return undefined;
  // YYYY-MM-DD sorts as text in date order.
  const rates = [...byDay]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([from, perKwh]) => ({ from, perKwh }));
  const c = typeof src.currency === 'string' ? src.currency.trim() : '';
  const currency = c !== '' && [...c].length <= ENERGY_CURRENCY_MAX ? c : ENERGY_CURRENCY_DEFAULT;
  return { currency, rates };
}
