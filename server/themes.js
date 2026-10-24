/**
 * Custom themes as validated data (#331; spec §2, §11).
 *
 * A theme is DATA, never CSS: a name, a base (the built-in theme it starts
 * from, dark or light) and a few colours for known token names. Nothing here
 * writes a stylesheet. A colour is accepted only if a strict parser reads it
 * (`#rgb`, `#rrggbb`, `oklch(L C H)` or `oklch(L C H / A)`), and what is
 * kept and applied is the colour written again from the numbers it read, so
 * no byte of the input reaches a style: a `url()`, a `;`, a `}` or a comment
 * is not a colour and the theme is rejected. The shell sets the colours as
 * custom properties on each `.jh-ui` root (src/ui/root.jsx, themeVars).
 *
 * A theme loads only if it keeps the contrast rules of the built-in themes
 * (scripts/ui-contrast.mjs, #283: the same code, server/uiContrast.js). The
 * theme is laid over its base, every pairing the design system allows is
 * scored on sRGB and Display P3 screens in each accent the theme leaves to the
 * user, and each accent's hover and distance from the status colours is
 * checked too. A theme that fails is rejected with each failing pairing named
 * (`text-2 on surface-1: 3.10:1, needs 4.5:1`).
 *
 * The same function runs in the browser when the display config loads and in
 * the server when a save adds or changes a theme (routes/displayConfig.js), so
 * a hand-edited config cannot smuggle a bad theme. It lives in server/ because
 * the runtime image holds server/ but not src/, and src/ imports it (as it
 * does kumaBeats.js). It imports nothing from Node.
 *
 * A theme that sets any accent role (ACCENT_ROLE_NAMES) brings its own
 * accent: the accent chosen in Settings then has nothing to change, and the
 * shell draws the default accent's attribute (setsAccent).
 */
import { ACCENT_ROLES, THEME_BASES } from './themeBases.js';
import {
  HOVER_MIN_DE,
  PAIRINGS,
  RULES,
  STATUS_APART_MIN_DE,
  STATUS_MIN_DE,
  accentStatusDistances,
  formatRatio,
  hoverDistance,
  pairContrast,
  pairName,
  parseColor,
  statusDistances,
} from './uiContrast.js';

/** Most themes a config holds; a save may not grow past it. */
export const MAX_THEMES = 8;
/** Most colours one theme sets. */
export const MAX_TOKENS = 120;
/** Longest colour written, in characters. */
export const MAX_COLOR_LENGTH = 64;
/** Longest theme name, in characters. */
export const MAX_NAME_LENGTH = 40;
/** Most failures a rejection lists before "and N more". */
export const MAX_REASONS = 6;

/** The built-in themes a custom one starts from. */
export const THEME_BASE_IDS = /** @type {const} */ (['dark', 'light']);

/** The accent a root shows with no `data-accent` attribute (src/ui/accents.js). */
const DEFAULT_ACCENT_ID = 'violet';

/** Every accent: the default, then those with a block in themeBases.js. */
const ACCENT_IDS = [DEFAULT_ACCENT_ID, ...Object.keys(ACCENT_ROLES.dark)];

/** The roles an accent sets (tokens.css); a theme that sets one brings its own accent. */
export const ACCENT_ROLE_NAMES = Object.freeze([
  ...new Set(Object.values(ACCENT_ROLES.dark).flatMap((roles) => Object.keys(roles))),
]);

/** The token names a theme may set: the built-in roles (themeBases.js). */
export const THEME_TOKENS = Object.freeze(Object.keys(THEME_BASES.dark));
const TOKEN_SET = new Set(THEME_TOKENS);

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const KEYS = new Set(['id', 'name', 'base', 'tokens']);

// A number as written in a colour: at most three digits, six decimals.
const N = String.raw`\d{1,3}(?:\.\d{1,6})?`;
const OKLCH = new RegExp(
  String.raw`^oklch\(\s*(${N}%?)\s+(${N}%?)\s+(${N})(?:deg)?(?:\s*/\s*(${N}%?)\s*)?\)$`,
  'i'
);
const HEX = /^#([\da-f]{3}|[\da-f]{6})$/i;

/** A number to at most 4 decimals, written plainly. */
const fmt = (x) => String(Number(x.toFixed(4)));

/**
 * The colour `value` is, written again from what was read, or why it is none.
 * @param {unknown} value
 * @returns {{ ok: true, color: string } | { ok: false, why: string }}
 */
export function parseThemeColor(value) {
  if (typeof value !== 'string') return { ok: false, why: 'is not a string' };
  if (value.length > MAX_COLOR_LENGTH)
    return { ok: false, why: `is longer than ${MAX_COLOR_LENGTH} characters` };
  const v = value.trim();
  const hex = HEX.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
    return { ok: true, color: `#${h.toLowerCase()}` };
  }
  const m = OKLCH.exec(v);
  if (!m) return { ok: false, why: 'is not a colour (write #rrggbb or oklch(L C H / A))' };
  const pct = (s, whole) => (s.endsWith('%') ? (parseFloat(s) / 100) * whole : parseFloat(s));
  const l = pct(m[1], 1);
  const c = pct(m[2], 0.4);
  const h = parseFloat(m[3]);
  const a = m[4] === undefined ? 1 : pct(m[4], 1);
  if (l > 1) return { ok: false, why: 'has a lightness above 1' };
  if (c > 0.5) return { ok: false, why: 'has a chroma above 0.5' };
  if (h > 360) return { ok: false, why: 'has a hue above 360' };
  if (a > 1) return { ok: false, why: 'has an alpha above 1' };
  const color = `oklch(${fmt(l)} ${fmt(c)} ${fmt(h)}${a < 1 ? ` / ${fmt(a)}` : ''})`;
  return { ok: true, color };
}

/**
 * @typedef {{ id: string, name: string, base: 'dark' | 'light', tokens: Record<string, string>, setsAccent: boolean }} Theme
 * @typedef {{ ok: true, theme: Theme } | { ok: false, id: string | null, name: string | null, reasons: string[] }} ThemeResult
 */

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A key or id for a message: printable, short, quoted. */
const shown = (s) =>
  JSON.stringify(
    String(s)
      .slice(0, 40)
      .replace(/[^\x20-\x7e]/g, '?')
  );

/** At most MAX_REASONS reasons, then "and N more": a theme with 100 bad keys is not a wall of text. */
const capped = (reasons) =>
  reasons.length > MAX_REASONS
    ? [...reasons.slice(0, MAX_REASONS), `and ${reasons.length - MAX_REASONS} more`]
    : reasons;

/** The properties a theme gives its root: `{ '--jh-bg': 'oklch(...)' }`. */
export function themeVars(tokens) {
  return Object.fromEntries(Object.entries(tokens).map(([name, color]) => [`--jh-${name}`, color]));
}

/** What a root in `base` shows with `accent` and the theme's colours laid over it, as the check reads it. */
function propsFor(base, accent, tokens) {
  const roles = {
    ...THEME_BASES[base],
    ...(accent === DEFAULT_ACCENT_ID ? {} : ACCENT_ROLES[base][accent]),
    ...tokens,
  };
  return Object.fromEntries(Object.entries(roles).map(([name, value]) => [`--jh-${name}`, value]));
}

/**
 * Every rule a theme breaks, in the order the design system lists them: the contrast pairings (named as
 * `fg on bg`), each accent's hover and its distance from the status colours.
 * @param {'dark' | 'light'} base
 * @param {Record<string, string>} tokens
 * @param {boolean} setsAccent
 * @returns {string[]}
 */
function contrastFailures(base, tokens, setsAccent) {
  const accents = setsAccent ? [DEFAULT_ACCENT_ID] : ACCENT_IDS;
  // A rule broken under several accents is listed once, as its worst accent breaks it.
  /** @type {Map<string, { deficit: number, text: string }>} */
  const found = new Map();
  const note = (key, deficit, text) => {
    const prev = found.get(key);
    if (!prev) found.set(key, { deficit, text });
    else if (deficit < prev.deficit) found.set(key, { deficit, text });
  };
  for (const accent of accents) {
    const props = propsFor(base, accent, tokens);
    const withAccent =
      setsAccent || accent === DEFAULT_ACCENT_ID ? '' : ` with the ${accent} accent`;
    // Status colours must tell states apart: crit painted as ok would show a
    // critical lamp as healthy. Checked once, in the first context (the accent
    // doesn't change a status).
    if (accent === accents[0]) {
      for (const { a, b, de } of statusDistances(props)) {
        if (de < STATUS_APART_MIN_DE) {
          note(
            `${a}~${b}`,
            de / STATUS_APART_MIN_DE,
            `${a} and ${b} are too close: ΔE ${de.toFixed(2)}, needs ${STATUS_APART_MIN_DE}`
          );
        }
      }
    }
    for (const p of PAIRINGS) {
      const min = RULES[p.rule];
      const ratio = pairContrast(props, p);
      if (ratio < min) {
        note(
          pairName(p),
          ratio / min,
          `${pairName(p)}: ${formatRatio(ratio, min)}, needs ${min}:1${withAccent}`
        );
      }
    }
    const hover = hoverDistance(props);
    if (hover < HOVER_MIN_DE) {
      note(
        'hover',
        hover / HOVER_MIN_DE,
        `accent-hover is too close to accent: ΔE ${hover.toFixed(3)}, needs ${HOVER_MIN_DE}${withAccent}`
      );
    }
    for (const { mark, status, de } of accentStatusDistances(props)) {
      if (de < STATUS_MIN_DE) {
        note(
          `${mark}~${status}`,
          de / STATUS_MIN_DE,
          `${mark} reads as ${status}: ΔE ${de.toFixed(3)}, needs ${STATUS_MIN_DE}${withAccent}`
        );
      }
    }
  }
  return [...found.values()].map((f) => f.text);
}

/**
 * Whether `raw` is a theme that loads: `{ ok: true, theme }`, with its colours
 * written again from what was read, or `{ ok: false, reasons }`, each saying
 * what is wrong (a key, a colour, a pairing under its floor).
 * @param {unknown} raw
 * @returns {ThemeResult}
 */
export function validateTheme(raw) {
  /** @type {string[]} */
  const reasons = [];
  const rejected = (/** @type {string | null} */ id, /** @type {string | null} */ name) => ({
    ok: /** @type {const} */ (false),
    id,
    name,
    reasons: capped(reasons),
  });
  if (!isObject(raw)) {
    reasons.push('A theme is an object with an id, a name, a base and tokens');
    return rejected(null, null);
  }
  const obj = /** @type {Record<string, unknown>} */ (raw);
  const id = typeof obj.id === 'string' && ID.test(obj.id) ? obj.id : null;
  const name =
    typeof obj.name === 'string' &&
    obj.name.trim().length >= 1 &&
    obj.name.length <= MAX_NAME_LENGTH &&
    !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(obj.name)
      ? obj.name.trim()
      : null;
  for (const key of Object.keys(obj)) {
    if (!KEYS.has(key))
      reasons.push(`Unknown key ${shown(key)} (a theme has id, name, base and tokens)`);
  }
  if (id === null)
    reasons.push('id must be 1 to 32 characters: lower-case letters, digits and hyphens');
  if (name === null) reasons.push(`name must be 1 to ${MAX_NAME_LENGTH} printable characters`);
  const base = obj.base === 'dark' || obj.base === 'light' ? obj.base : null;
  if (base === null) reasons.push('base must be "dark" or "light"');

  /** @type {Record<string, string>} */
  const tokens = Object.create(null);
  if (!isObject(obj.tokens)) {
    reasons.push('tokens must be an object of token names to colours');
  } else {
    const entries = Object.entries(obj.tokens);
    if (entries.length === 0) reasons.push('tokens is empty: set at least one colour');
    if (entries.length > MAX_TOKENS) reasons.push(`tokens has more than ${MAX_TOKENS} colours`);
    for (const [token, value] of entries.slice(0, MAX_TOKENS)) {
      if (!TOKEN_SET.has(token)) {
        reasons.push(`Unknown token ${shown(token)}`);
        continue;
      }
      const c = parseThemeColor(value);
      if (c.ok) tokens[token] = c.color;
      else reasons.push(`${token} ${c.why}`);
    }
  }
  if (reasons.length > 0 || base === null) return rejected(id, name);

  const plain = { ...tokens };
  const setsAccent = ACCENT_ROLE_NAMES.some((role) => Object.hasOwn(plain, role));
  let failures;
  try {
    failures = contrastFailures(base, plain, setsAccent);
  } catch (err) {
    // A colour the maths can't use where it is read, such as a translucent surface.
    reasons.push(err instanceof Error ? err.message.replace(/^--jh-/, '') : 'could not be checked');
    return rejected(id, name);
  }
  if (failures.length > 0) {
    reasons.push(...failures);
    return rejected(id, name);
  }
  return {
    ok: true,
    theme: {
      id: /** @type {string} */ (id),
      name: /** @type {string} */ (name),
      base,
      tokens: plain,
      setsAccent,
    },
  };
}

/**
 * @typedef {{ index: number, id: string | null, name: string | null, reasons: string[] }} Rejection
 */

/**
 * The themes in a config's `themes` list: those that load, and those
 * rejected with why, by their place in the list (so one can be removed). A
 * second theme with an id already taken, or one past MAX_THEMES, is rejected.
 * @param {unknown} list
 * @returns {{ valid: Theme[], rejected: Rejection[] }}
 */
export function validateThemes(list) {
  /** @type {Theme[]} */
  const valid = [];
  /** @type {Rejection[]} */
  const rejected = [];
  if (!Array.isArray(list)) return { valid, rejected };
  list.forEach((raw, index) => {
    if (index >= MAX_THEMES) {
      const r = isObject(raw) ? raw : {};
      rejected.push({
        index,
        id: typeof r.id === 'string' ? r.id : null,
        name: typeof r.name === 'string' ? r.name.slice(0, MAX_NAME_LENGTH) : null,
        reasons: [`JagHelm keeps ${MAX_THEMES} themes: remove one`],
      });
      return;
    }
    const result = validateTheme(raw);
    if (result.ok && valid.some((t) => t.id === result.theme.id)) {
      rejected.push({
        index,
        id: result.theme.id,
        name: result.theme.name,
        reasons: [`id ${shown(result.theme.id)} is already used by an earlier theme`],
      });
    } else if (result.ok) valid.push(result.theme);
    else rejected.push({ index, id: result.id, name: result.name, reasons: result.reasons });
  });
  return { valid, rejected };
}

/**
 * Why a save of `next` themes must be refused, or null. A theme already in
 * `prev` (the file on disk) is let through as it is, so a config with a theme
 * that was hand-edited bad can still be saved, to remove it; a theme added or
 * changed must load, and the list may not grow past MAX_THEMES.
 * @param {unknown} next
 * @param {unknown} prev
 * @returns {string | null}
 */
export function themesSaveError(next, prev) {
  if (next === undefined) return null;
  if (!Array.isArray(next)) return 'themes must be a list';
  const before = Array.isArray(prev) ? prev : [];
  if (next.length > MAX_THEMES && next.length > before.length) {
    return `Too many themes (JagHelm keeps ${MAX_THEMES})`;
  }
  const known = new Set(before.map((t) => JSON.stringify(t)));
  for (const [index, raw] of next.entries()) {
    if (known.has(JSON.stringify(raw))) continue;
    const result = validateTheme(raw);
    if (!result.ok) {
      const label = result.name ?? result.id ?? `#${index + 1}`;
      return `Theme ${shown(label)} was refused: ${result.reasons.join('; ')}`;
    }
  }
  return null;
}
