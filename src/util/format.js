/**
 * The one place the web app decides how a date, a time or a temperature is
 * written (#322, #260). Two display-config settings drive it, shared with the
 * Android app (which reads the same keys from /api/display-config in Phase 4):
 *
 *   units   'metric' (the default, °C) or 'imperial' (°F)
 *   locale  a BCP 47 tag ('en-GB'), or '' / unset for the browser's own
 *
 * App.jsx hands the config over on each render (setFormatting); everything
 * that prints one of these asks here, so a setting changes every screen and no
 * file hard-codes 'en-US' or a unit. Formatters are built on use and kept per
 * locale and options, never at import time, so a change applies at once. A
 * component that is memoised and doesn't re-render keeps its old text until it
 * does; the settings that change this re-render the page they sit on.
 */

export const UNITS = Object.freeze(['metric', 'imperial']);

// A BCP 47 tag, loosely (language, optional script, region, variants): what
// Intl accepts without throwing is checked below as well.
const TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,4}$/;

let prefs = { units: 'metric', locale: '' }; // until the first config is handed over
const cache = new Map();

/**
 * The units a config means: its `units`; else, for a config from before the
 * setting, what it was drawing: Fahrenheit unless `tempUnit` said C (the same
 * rule the server's one-time migration saves, server/displayUnits.js). A fresh
 * install's config carries `units: 'metric'` (defaultConfig.js).
 */
export function unitsFromConfig(config) {
  if (UNITS.includes(config?.units)) return config.units;
  return config?.tempUnit === 'C' ? 'metric' : 'imperial';
}

function validLocale(locale) {
  if (typeof locale !== 'string' || !TAG.test(locale)) return '';
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? '';
  } catch {
    return '';
  }
}

/** Takes the units and locale from a display config (anything else is left to the defaults). */
export function setFormatting(config) {
  const next = { units: unitsFromConfig(config), locale: validLocale(config?.locale) };
  if (next.units === prefs.units && next.locale === prefs.locale) return;
  prefs = next;
  cache.clear();
}

export const unitsOf = () => prefs.units;

/** The locale to format in; undefined is the browser's own. */
export const localeOf = () => prefs.locale || undefined;

/** An Intl.DateTimeFormat for `options` in the chosen locale, kept for the next call. */
export function dateTimeFormat(options) {
  const key = `${prefs.locale}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(localeOf(), options);
    cache.set(key, f);
  }
  return f;
}

const DAY = { month: 'short', day: 'numeric' };

/** A day as "Oct 20" or "20 Oct" by the locale. */
export const formatDay = (date) => dateTimeFormat(DAY).format(date);

/**
 * A temperature as the units print it, rounded: "20°C" or "68°F". `value` is
 * in `from` ('C', the default, or 'F': open-meteo's answer is Fahrenheit); a
 * value already in the units is rounded as it is, never converted twice.
 * `units` is the setting's, unless given.
 */
export function formatTemperature(value, { from = 'C', units = prefs.units } = {}) {
  const to = units === 'imperial' ? 'F' : 'C';
  let n = value;
  if (from === 'C' && to === 'F') n = (value * 9) / 5 + 32;
  else if (from === 'F' && to === 'C') n = ((value - 32) * 5) / 9;
  n = Math.round(n);
  return `${n === 0 ? 0 : n}°${to}`;
}
