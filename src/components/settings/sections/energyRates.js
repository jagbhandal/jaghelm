// @ts-check
import {
  ENERGY_CURRENCY_DEFAULT,
  ENERGY_CURRENCY_MAX,
  ENERGY_MAX_PER_KWH,
  validDay,
} from '../../../../server/energy.js';

/**
 * The Energy cost editor's rules (Monitoring A2, #743), the ones
 * server/energy.js `sanitizeEnergy` applies, said in words where it would
 * otherwise drop a row. Pure.
 *
 * A draft is what is typed: `{ currency, rates: [{ key, from, price }] }`
 * with `price` the text of the field.
 *
 * @typedef {{ key: number, from: string, price: string }} DraftRate
 * @typedef {{ currency: string, rates: DraftRate[] }} Draft
 */

/**
 * The draft for a saved `energy` value (none: no rows, the default symbol).
 * @param {{ currency?: string, rates?: { from: string, perKwh: number }[] } | undefined} energy
 * @returns {Draft}
 */
export function draftOf(energy) {
  const rates = Array.isArray(energy?.rates) ? energy.rates : [];
  return {
    currency: energy?.currency ?? ENERGY_CURRENCY_DEFAULT,
    rates: rates.map((r, key) => ({ key, from: r.from, price: String(r.perKwh) })),
  };
}

/**
 * The typed price as a number, or null when it is no plain decimal. A comma
 * counts as the decimal point; no exponent, sign or spaces inside.
 * @param {string} text
 */
export function parsePrice(text) {
  const t = text.trim().replace(',', '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Number(t);
}

/**
 * Each field's problem in plain words (undefined when fine), by the server's
 * rules: a real calendar date, each date once (the later row is the one at
 * fault, the server keeps the first), a price above 0 and at most 10, and a
 * symbol of 1 to 3 characters.
 * @param {Draft} draft
 * @returns {{ currency?: string, rates: { from?: string, price?: string }[] }}
 */
export function energyProblems(draft) {
  const c = draft.currency.trim();
  const currency =
    c === '' || [...c].length > ENERGY_CURRENCY_MAX
      ? `Use 1 to ${ENERGY_CURRENCY_MAX} characters, such as ${ENERGY_CURRENCY_DEFAULT}. Not saved.`
      : undefined;
  const seen = new Set();
  const rates = draft.rates.map((r) => {
    /** @type {{ from?: string, price?: string }} */
    const out = {};
    if (r.from === '') out.from = 'Pick the day this rate starts. Not saved.';
    else if (!validDay(r.from)) out.from = 'That is not a real date. Not saved.';
    else if (seen.has(r.from)) out.from = 'Another rate already starts on this day. Not saved.';
    else seen.add(r.from);

    if (r.price.trim() === '') out.price = 'Enter the price per kWh, such as 0.14. Not saved.';
    else {
      const n = parsePrice(r.price);
      if (n === null) out.price = 'Use digits and a decimal point, such as 0.14. Not saved.';
      else if (!(n > 0)) out.price = 'The price has to be above 0. Not saved.';
      else if (n > ENERGY_MAX_PER_KWH)
        out.price = `The price can be at most ${ENERGY_MAX_PER_KWH} per kWh. Not saved.`;
    }
    return out;
  });
  return { currency, rates };
}

/**
 * The `energy` value to save for a clean draft: rows sorted by date, the
 * symbol trimmed. undefined with no row, as the server keeps no key then.
 * @param {Draft} draft
 */
export function energyValue(draft) {
  if (draft.rates.length === 0) return undefined;
  const rates = draft.rates
    .map((r) => ({ from: r.from, perKwh: /** @type {number} */ (parsePrice(r.price)) }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return { currency: draft.currency.trim(), rates };
}
