import { ACCENTS, DEFAULT_ACCENT } from '../../../ui/accents.js';

/**
 * The accent set's data (#321): each accent Settings → Appearance offers, in
 * src/ui/accents.js's order (each swatch is drawn by tokens.css itself,
 * src/ui/appearance.jsx), with its hue, the OKLCH hue of every colour it
 * paints in both themes; and the mapping of a colour the free accent picker
 * saved before #304 (`accentColor`, a hex) onto the nearest of them. It lives
 * with Settings → Appearance, out of the first load: the shell loads it only
 * for a config that still has such a colour (src/shell/appearance.js, through
 * lazyViews.js). scripts/accent-set.test.mjs holds each hue to tokens.css.
 */
const HUES = { violet: 293, fuchsia: 328, cyan: 215 };

/** Each accent offered: `{ id, label, hue }`. */
export const ACCENT_SET = Object.freeze(
  ACCENTS.map((a) => Object.freeze({ ...a, hue: HUES[a.id] }))
);

/**
 * The free picker's default before #304 (its indigo): a config that never
 * changed it saved it all the same, so it is no choice of the user's and maps
 * to the default without a notice.
 */
export const OLD_DEFAULT_ACCENT = '#6366f1';

const toLinear = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);

/** `#rgb` or `#rrggbb` as OKLab (CSS Color 4), or null for anything else. */
export function hexToOklab(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const digits = m[1].length === 3 ? [...m[1]].map((d) => d + d).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => toLinear(parseInt(digits.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s,
  ];
}

/**
 * Below this OKLCH chroma a colour is a grey, with no hue to be near: it
 * becomes the default accent.
 */
const GREY = 0.03;

/** How far apart two hues are, in degrees round the wheel (0 to 180). */
const hueGap = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Whether `hex` is a grey (incl. white and black): a colour with no hue. */
function isHueless(hex) {
  const lab = hexToOklab(hex);
  return lab != null && Math.hypot(lab[1], lab[2]) < GREY;
}

/**
 * The accent offered nearest `hex` in hue (OKLCH): an accent's lightness and
 * chroma are its own, tuned for contrast, so what a picked colour keeps is
 * its hue. A grey (chroma under 0.03) becomes the default accent. Null for a
 * value that isn't a hex colour.
 */
export function nearestAccent(hex) {
  const lab = hexToOklab(hex);
  if (!lab) return null;
  const [, a, b] = lab;
  if (Math.hypot(a, b) < GREY) return DEFAULT_ACCENT;
  const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  let best = null;
  for (const { id } of ACCENT_SET) {
    const gap = hueGap(hue, HUES[id]);
    if (!best || gap < best.gap) best = { id, gap };
  }
  return best.id;
}

const isAccent = (id) => ACCENTS.some((a) => a.id === id);

/**
 * `config` with its old `accentColor` mapped, once: the colour goes, and a
 * config with no accent of its own takes the one offered nearest it, with
 * `accentNotice: { from, to }` (the colour and the accent it became) for
 * Settings → Appearance to say so until it is dismissed or another accent is
 * picked. The old default, a value that isn't a colour, and a grey, white or
 * black (no hue to be near, so no "nearest" to say) just go with the accent
 * the default, Violet, as it has been since #304. A config with
 * no `accentColor` comes back as it is.
 */
export function migrateAccent(config) {
  if (config == null || typeof config !== 'object' || !Object.hasOwn(config, 'accentColor'))
    return config;
  const { accentColor, ...rest } = config;
  const from = String(accentColor).trim();
  if (isAccent(rest.accent) || from.toLowerCase() === OLD_DEFAULT_ACCENT) return rest;
  const nearest = nearestAccent(from);
  if (!nearest) return rest;
  if (nearest === DEFAULT_ACCENT && isHueless(from)) return { ...rest, accent: nearest };
  return { ...rest, accent: nearest, accentNotice: { from, to: nearest } };
}
