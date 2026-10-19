// Contrast check for JagHelm's design tokens (src/ui/tokens.css, #283).
//
// Every text/background pairing the design system allows (PAIRINGS) is computed
// in both themes and with all five accents, and must meet the spec's floor
// (RULES, spec §5.2): text-1 7:1; text-2, text-3, on-accent, accent-text, status
// fg and on-solid 4.5:1; the focus ring 3:1 against the surface around it.
//
//   node scripts/ui-contrast.mjs [tokens.css]
//     prints the lowest ratio per rule, and fails (exit 1) on any pairing below
//     its floor. The file defaults to src/ui/tokens.css.
//
// scripts/ui-contrast.test.mjs runs the same check in `npm test`.
//
// The colour maths follows CSS Color 4: OKLCH to OKLab to linear sRGB with the
// spec's matrices, sRGB transfer function, and alpha compositing on the
// gamma-encoded values, as browsers paint. Colours outside sRGB are brought in
// both by clipping (what browsers do today) and by CSS Color 4's gamut-mapping
// algorithm; each pairing scores the lower of the two. Contrast is WCAG 2's
// relative-luminance ratio.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TOKENS_FILE = path.join(ROOT, 'src/ui/tokens.css');

export const THEMES = ['dark', 'light'];
export const ACCENTS = ['violet', 'indigo', 'blue', 'fuchsia', 'graphite'];
// The values a context takes when its element carries no attribute.
const DEFAULTS = { theme: 'dark', accent: 'violet', density: 'comfortable' };

/** Minimum contrast per rule (spec §5.2). */
export const RULES = {
  'text-1': 7,
  'text-2': 4.5,
  'text-3': 4.5,
  'accent-text': 4.5,
  'on-accent': 4.5,
  'status-fg': 4.5,
  'on-solid': 4.5,
  'focus-ring': 3,
};

export const STATUSES = ['ok', 'warn', 'crit', 'unknown', 'maintenance', 'info'];

// A background is a token, or a translucent token painted over another (`over`).
const SURFACES = ['bg', 'sidebar', 'surface-1', 'surface-2', 'surface-3'];
const on = (...bgs) => bgs.map((bg) => ({ bg }));
const over = (tint, ...bases) => bases.map((base) => ({ bg: tint, over: base }));

/**
 * Where each foreground may appear. A pairing not listed here is not allowed,
 * and docs/design-system.md states the same rules: text-3 never sits on
 * surface-3 or in a selected nav item (accent-tint on the sidebar: light text-3
 * there is 4.4:1), status words never sit on surface-3, and text on an accent
 * fill is always on-accent.
 */
export const PAIRINGS = [
  ...['text-1', 'text-2'].flatMap((fg) =>
    [
      ...on(...SURFACES),
      ...over('accent-tint', 'bg', 'sidebar', 'surface-1'),
      ...over('row-hover', 'bg', 'surface-1'),
      ...STATUSES.flatMap((s) => over(`${s}-tint`, 'bg', 'surface-1')),
    ].map((p) => ({ rule: fg, fg, ...p }))
  ),
  ...[
    ...on('bg', 'sidebar', 'surface-1', 'surface-2'),
    ...over('accent-tint', 'bg', 'surface-1'),
    ...over('row-hover', 'bg', 'surface-1'),
    ...STATUSES.flatMap((s) => over(`${s}-tint`, 'bg', 'surface-1')),
  ].map((p) => ({ rule: 'text-3', fg: 'text-3', ...p })),
  ...[
    ...on('bg', 'sidebar', 'surface-1', 'surface-2'),
    ...over('accent-tint', 'bg', 'sidebar', 'surface-1'),
    ...over('row-hover', 'bg', 'surface-1'),
  ].map((p) => ({ rule: 'accent-text', fg: 'accent-text', ...p })),
  ...on('accent', 'accent-hover').map((p) => ({ rule: 'on-accent', fg: 'on-accent', ...p })),
  ...STATUSES.flatMap((s) =>
    [...on('bg', 'sidebar', 'surface-1', 'surface-2'), ...over(`${s}-tint`, 'bg', 'surface-1')].map(
      (p) => ({ rule: 'status-fg', fg: `${s}-fg`, ...p })
    )
  ),
  ...STATUSES.map((s) => ({ rule: 'on-solid', fg: `${s}-on-solid`, bg: `${s}-solid` })),
  ...on(...SURFACES).map((p) => ({ rule: 'focus-ring', fg: 'focus-ring', ...p })),
];

// ---- Colour maths (CSS Color 4) ---------------------------------------------

const OKLAB_TO_LMS = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
];
const LMS_TO_XYZ = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];
const XYZ_TO_LRGB = [
  [3.2409699419045226, -1.5373831775700939, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.0415550574071756],
  [0.0556300796969936, -0.2039769588889765, 1.0569715142428786],
];
const LRGB_TO_XYZ = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
const XYZ_TO_LMS = [
  [0.819022437996703, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];
const LMS_TO_OKLAB = [
  [0.210454268309314, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.4285922420485799, 0.450593709617411],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];

const mul = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);

/** sRGB transfer function, extended to negative values (CSS Color 4). */
const encode = (x) =>
  Math.abs(x) <= 0.0031308 ? 12.92 * x : Math.sign(x) * (1.055 * Math.abs(x) ** (1 / 2.4) - 0.055);
const decode = (x) =>
  Math.abs(x) <= 0.04045 ? x / 12.92 : Math.sign(x) * ((Math.abs(x) + 0.055) / 1.055) ** 2.4;

export function oklchToOklab([l, c, h]) {
  const rad = (h * Math.PI) / 180;
  return [l, c * Math.cos(rad), c * Math.sin(rad)];
}

/** Gamma-encoded sRGB [r, g, b] for an OKLCH colour, unclipped (may leave 0..1). */
export function oklchToSrgb(lch) {
  const lms = mul(OKLAB_TO_LMS, oklchToOklab(lch)).map((x) => x ** 3);
  return mul(XYZ_TO_LRGB, mul(LMS_TO_XYZ, lms)).map(encode);
}

function srgbToOklab(rgb) {
  const lms = mul(XYZ_TO_LMS, mul(LRGB_TO_XYZ, rgb.map(decode))).map(Math.cbrt);
  return mul(LMS_TO_OKLAB, lms);
}

export const inGamut = (rgb, eps = 1e-6) => rgb.every((x) => x >= -eps && x <= 1 + eps);
const clip = (rgb) => rgb.map((x) => Math.min(1, Math.max(0, x)));
const deltaEOK = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** CSS Color 4 §13.2 gamut mapping to sRGB: reduce OKLCH chroma until the clip is within a JND. */
export function cssGamutMap([l, c, h]) {
  if (l >= 1) return [1, 1, 1];
  if (l <= 0) return [0, 0, 0];
  const origin = oklchToSrgb([l, c, h]);
  if (inGamut(origin)) return clip(origin);
  const JND = 0.02;
  const EPSILON = 0.0001;
  let clipped = clip(origin);
  if (deltaEOK(srgbToOklab(clipped), oklchToOklab([l, c, h])) < JND) return clipped;
  let min = 0;
  let max = c;
  let minInGamut = true;
  while (max - min > EPSILON) {
    const chroma = (min + max) / 2;
    const current = oklchToSrgb([l, chroma, h]);
    if (minInGamut && inGamut(current)) {
      min = chroma;
      continue;
    }
    clipped = clip(current);
    const e = deltaEOK(srgbToOklab(clipped), oklchToOklab([l, chroma, h]));
    if (e < JND) {
      if (JND - e < EPSILON) return clipped;
      minInGamut = false;
      min = chroma;
    } else {
      max = chroma;
    }
  }
  return clipped;
}

/** Gamma-encoded sRGB in gamut, by `method`: 'clip' or 'map' (CSS Color 4). */
export function toSrgb(lch, method) {
  return method === 'clip' ? clip(oklchToSrgb(lch)) : cssGamutMap(lch);
}

/** WCAG 2 relative luminance of gamma-encoded sRGB. */
export function luminance(rgb) {
  const [r, g, b] = rgb.map(decode);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `fg` with opacity `alpha` painted over opaque `bg`, in gamma-encoded sRGB. */
export function composite(fg, alpha, bg) {
  return fg.map((x, i) => x * alpha + bg[i] * (1 - alpha));
}

const num = (s, pct = 1) => (s.endsWith('%') ? (parseFloat(s) / 100) * pct : parseFloat(s));

/** { lch, alpha } for an oklch() or hex colour; throws on anything else. */
export function parseColor(value) {
  const v = value.trim();
  const ok = v.match(
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i
  );
  if (ok) {
    return {
      lch: [num(ok[1]), num(ok[2], 0.4), parseFloat(ok[3])],
      alpha: ok[4] === undefined ? 1 : num(ok[4]),
    };
  }
  const hex = v.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
    const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const [L, a, b] = srgbToOklab(rgb);
    return {
      lch: [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360],
      alpha: 1,
    };
  }
  throw new Error(`unsupported colour: ${value} (write tokens as oklch() or #hex)`);
}

// ---- Reading the tokens ------------------------------------------------------

const SELECTOR = /^\.jh-ui((?:\[data-(?:theme|accent|density)=(['"])[a-z]+\2\])*)$/;

/**
 * The token rules of a stylesheet: [{ attrs, specificity, order, decls }].
 * Rules inside @media are returned separately (`media`); they may only set
 * tokens no pairing reads (scripts/ui-tokens.test.mjs).
 */
export function readTokens(css) {
  const rules = [];
  const media = [];
  let order = 0;
  postcss.parse(css).walkRules((rule) => {
    const inMedia = rule.parent?.type === 'atrule' && rule.parent.name === 'media';
    if (rule.parent?.type !== 'root' && !inMedia) {
      throw new Error(`token rule nested where the check can't follow: ${rule.selector}`);
    }
    for (const selector of rule.selectors) {
      const m = selector.trim().match(SELECTOR);
      if (!m) throw new Error(`token selector the contrast check doesn't understand: ${selector}`);
      const attrs = Object.fromEntries(
        [...m[1].matchAll(/\[data-(\w+)=['"]([a-z]+)['"]\]/g)].map(([, k, v]) => [k, v])
      );
      const decls = {};
      rule.walkDecls(/^--/, (d) => (decls[d.prop] = d.value));
      const entry = {
        selector,
        attrs,
        specificity: 1 + Object.keys(attrs).length,
        order: order++,
        decls,
      };
      (inMedia ? media : rules).push(entry);
    }
  });
  return { rules, media };
}

/** Every custom property in effect on a .jh-ui root in `context`, as CSS would cascade them. */
export function resolveContext(rules, context) {
  const ctx = { ...DEFAULTS, ...context };
  const matching = rules
    .filter((r) => Object.entries(r.attrs).every(([k, v]) => ctx[k] === v))
    .sort((a, b) => a.specificity - b.specificity || a.order - b.order);
  const props = {};
  for (const r of matching) Object.assign(props, r.decls);
  return props;
}

/** The colour a token holds in `props`, following var() references. */
export function tokenColor(props, name, seen = new Set()) {
  const prop = `--jh-${name}`;
  if (seen.has(prop)) throw new Error(`var() cycle through ${prop}`);
  seen.add(prop);
  const value = props[prop];
  if (value === undefined) throw new Error(`${prop} is not declared`);
  const ref = value.trim().match(/^var\(\s*--jh-([\w-]+)\s*\)$/);
  if (ref) return tokenColor(props, ref[1], seen);
  return parseColor(value);
}

/** Contrast of one pairing in `props`, the lower of clipping and CSS gamut mapping. */
export function pairContrast(props, { fg, bg, over: base }) {
  const ratios = ['clip', 'map'].map((method) => {
    const paint = (name, under) => {
      const { lch, alpha } = tokenColor(props, name);
      const rgb = toSrgb(lch, method);
      if (alpha >= 1) return rgb;
      if (!under) throw new Error(`--jh-${name} is translucent: pair it over a surface`);
      return composite(rgb, alpha, under);
    };
    const back = paint(bg, base && paint(base));
    return contrast(paint(fg, back), back);
  });
  return Math.min(...ratios);
}

/** Every pairing in every theme and accent: { results, failures }. */
export function checkContrast(css = readFileSync(TOKENS_FILE, 'utf8'), pairings = PAIRINGS) {
  const { rules } = readTokens(css);
  const results = [];
  for (const theme of THEMES) {
    for (const accent of ACCENTS) {
      const props = resolveContext(rules, { theme, accent });
      for (const p of pairings) {
        const ratio = pairContrast(props, p);
        results.push({
          ...p,
          theme,
          accent,
          ratio,
          min: RULES[p.rule],
          pass: ratio >= RULES[p.rule],
        });
      }
    }
  }
  return { results, failures: results.filter((r) => !r.pass) };
}

export const describe = (r) =>
  `${r.fg} on ${r.bg}${r.over ? ` over ${r.over}` : ''} (${r.theme}, ${r.accent}): ` +
  `${r.ratio.toFixed(2)}:1, needs ${r.min}:1`;

/** Markdown: the lowest ratio per rule, and where it occurs. */
export function report({ results, failures }) {
  const lines = ['| Rule | Floor | Lowest | Where |', '| --- | --- | --- | --- |'];
  for (const rule of Object.keys(RULES)) {
    const rows = results.filter((r) => r.rule === rule);
    const low = rows.reduce((a, b) => (b.ratio < a.ratio ? b : a));
    const where = `${low.fg} on ${low.bg}${low.over ? ` over ${low.over}` : ''}, ${low.theme}, ${low.accent}`;
    lines.push(`| ${rule} | ${RULES[rule]}:1 | ${low.ratio.toFixed(2)}:1 | ${where} |`);
  }
  lines.push('', `${results.length} pairings checked, ${failures.length} below their floor.`);
  for (const f of failures) lines.push(`- FAIL ${describe(f)}`);
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : TOKENS_FILE;
  const result = checkContrast(readFileSync(file, 'utf8'));
  console.log(report(result));
  if (result.failures.length) process.exitCode = 1;
}
