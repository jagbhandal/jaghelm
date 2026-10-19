// Contrast check for JagHelm's design tokens (src/ui/tokens.css, #283).
//
// Every text/background pairing the design system allows (PAIRINGS) is computed
// in both themes and with all five accents, and must meet the spec's floor
// (RULES, spec §5.2): text-1 7:1; text-2, text-3, on-accent, accent-text, status
// fg and on-solid 4.5:1; the focus ring 3:1 against the surface around it.
// Pairings ruled out by name (FORBIDDEN) may never be declared. Each accent's
// hover must also differ visibly from its rest state (HOVER_MIN_DE).
//
//   node scripts/ui-contrast.mjs [tokens.css]
//     prints the lowest ratio per rule on sRGB and on Display P3 screens, and
//     fails (exit 1) on any pairing below its floor on either, or on a hover too
//     close to its rest state. The file defaults to src/ui/tokens.css.
//
// scripts/ui-contrast.test.mjs runs the same check in `npm test`.
//
// The colour maths follows CSS Color 4: OKLCH to OKLab to linear light with the
// spec's matrices, the sRGB transfer function (Display P3 shares it), and alpha
// compositing on the gamma-encoded values, as browsers paint. Each pairing is
// scored as two kinds of screen paint it, and must pass on both:
//
//  - sRGB: a colour outside sRGB is brought in by clipping (what browsers do
//    today) and by CSS Color 4's gamut-mapping algorithm; the lower ratio counts.
//  - Display P3 (Macs, iPhones, many Android phones): the colour is clipped to
//    P3 only, so a violet that clipping darkens on sRGB shows at its true,
//    lighter value, and luminance is P3's Y.
//
// Contrast is WCAG 2's relative-luminance ratio, compared unrounded.
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
 * and docs/design-system.md states the same rules: status words never sit on
 * surface-3, text on an accent fill is always on-accent, and FORBIDDEN (below)
 * names the near misses. Status words sit in hovered and selected rows (the
 * mock's attention rows are clickable), so they are checked there too.
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
    [
      ...on('bg', 'sidebar', 'surface-1', 'surface-2'),
      ...over(`${s}-tint`, 'bg', 'surface-1'),
      ...over('row-hover', 'bg', 'surface-1'),
      ...over('accent-tint', 'bg', 'surface-1'),
    ].map((p) => ({ rule: 'status-fg', fg: `${s}-fg`, ...p }))
  ),
  ...STATUSES.map((s) => ({ rule: 'on-solid', fg: `${s}-on-solid`, bg: `${s}-solid` })),
  ...on(...SURFACES).map((p) => ({ rule: 'focus-ring', fg: 'focus-ring', ...p })),
];

/**
 * Pairings ruled out by name: plausible places for the text, but below the
 * floor in at least one theme and accent, so docs/design-system.md (rule 5)
 * forbids them rather than the mock's values moving for a pairing it never
 * draws. The check refuses a PAIRINGS list that contains one, and
 * ui-contrast.test.mjs keeps each one honest (it must still fail somewhere).
 */
export const FORBIDDEN = [
  { rule: 'text-3', fg: 'text-3', bg: 'surface-3', where: 'on surface-3' },
  {
    rule: 'text-3',
    fg: 'text-3',
    bg: 'accent-tint',
    over: 'sidebar',
    where: 'in a selected nav item',
  },
  {
    rule: 'text-3',
    fg: 'text-3',
    bg: 'accent-tint',
    over: 'surface-2',
    where: 'in a selected item of a popover or menu',
  },
];

const samePairing = (a, b) => a.fg === b.fg && a.bg === b.bg && (a.over ?? '') === (b.over ?? '');

/**
 * The least visible difference between an accent's hover and its rest state,
 * as ΔE OK (Euclidean distance in OKLab) between the colours a screen paints.
 * 0.02 is CSS Color 4's just-noticeable difference (its gamut-mapping JND):
 * below it a primary button gives no hover feedback.
 */
export const HOVER_MIN_DE = 0.02;

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

// Display P3, D65 like sRGB (CSS Color 4's lin_P3_to_XYZ and XYZ_to_lin_P3).
const LP3_TO_XYZ = [
  [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
  [35783 / 156275, 247089 / 357200, 198249 / 2500400],
  [0, 32229 / 714400, 5220557 / 5000800],
];
const XYZ_TO_LP3 = [
  [446124 / 178915, -333277 / 357830, -72051 / 178915],
  [-14852 / 17905, 63121 / 35810, 423 / 17905],
  [11844 / 330415, -50337 / 660830, 316169 / 330415],
];

const mul = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);

/** sRGB transfer function, extended to negative values (CSS Color 4). Display P3 uses it too. */
const encode = (x) =>
  Math.abs(x) <= 0.0031308 ? 12.92 * x : Math.sign(x) * (1.055 * Math.abs(x) ** (1 / 2.4) - 0.055);
const decode = (x) =>
  Math.abs(x) <= 0.04045 ? x / 12.92 : Math.sign(x) * ((Math.abs(x) + 0.055) / 1.055) ** 2.4;

export function oklchToOklab([l, c, h]) {
  const rad = (h * Math.PI) / 180;
  return [l, c * Math.cos(rad), c * Math.sin(rad)];
}

const oklchToXyz = (lch) =>
  mul(
    LMS_TO_XYZ,
    mul(OKLAB_TO_LMS, oklchToOklab(lch)).map((x) => x ** 3)
  );

/** Gamma-encoded sRGB [r, g, b] for an OKLCH colour, unclipped (may leave 0..1). */
export function oklchToSrgb(lch) {
  return mul(XYZ_TO_LRGB, oklchToXyz(lch)).map(encode);
}

/** Gamma-encoded Display P3 [r, g, b] for an OKLCH colour, unclipped. */
export function oklchToP3(lch) {
  return mul(XYZ_TO_LP3, oklchToXyz(lch)).map(encode);
}

/** OKLab of a gamma-encoded colour in `space` ('srgb' or 'p3'). */
export function rgbToOklab(rgb, space = 'srgb') {
  const toXyz = space === 'p3' ? LP3_TO_XYZ : LRGB_TO_XYZ;
  const lms = mul(XYZ_TO_LMS, mul(toXyz, rgb.map(decode))).map(Math.cbrt);
  return mul(LMS_TO_OKLAB, lms);
}
const srgbToOklab = (rgb) => rgbToOklab(rgb, 'srgb');

export const inGamut = (rgb, eps = 1e-6) => rgb.every((x) => x >= -eps && x <= 1 + eps);
const clip = (rgb) => rgb.map((x) => Math.min(1, Math.max(0, x)));
export const deltaEOK = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

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

/**
 * How a screen paints a colour. A pairing must pass on every screen; on each,
 * the lowest of its methods counts. 'clip' and 'map' paint in sRGB, 'p3'
 * clips to Display P3 and paints in it.
 */
export const SCREENS = { srgb: ['clip', 'map'], p3: ['p3'] };
const SPACE = { clip: 'srgb', map: 'srgb', p3: 'p3' };

/** Gamma-encoded RGB, in gamut, in the space `method` paints in. */
export function render(lch, method) {
  if (method === 'p3') return clip(oklchToP3(lch));
  if (method === 'clip' || method === 'map') return toSrgb(lch, method);
  throw new Error(`unknown rendering: ${method}`);
}

/** The OKLab colour a screen actually shows for `lch`, by `method`. */
export const paintedOklab = (lch, method) => rgbToOklab(render(lch, method), SPACE[method]);

// Relative luminance weights: WCAG 2's for sRGB, P3's own Y row for P3.
const LUMA = { srgb: [0.2126, 0.7152, 0.0722], p3: LP3_TO_XYZ[1] };

/** Relative luminance of gamma-encoded RGB in `space` (WCAG 2's for sRGB). */
export function luminance(rgb, space = 'srgb') {
  const [r, g, b] = rgb.map(decode);
  const [kr, kg, kb] = LUMA[space];
  return kr * r + kg * g + kb * b;
}

export function contrast(a, b, space = 'srgb') {
  const [x, y] = [luminance(a, space), luminance(b, space)];
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

/** Contrast of one pairing in `props` as `method` renders it. */
function methodContrast(props, { fg, bg, over: base }, method) {
  const paint = (name, under) => {
    const { lch, alpha } = tokenColor(props, name);
    const rgb = render(lch, method);
    if (alpha >= 1) return rgb;
    if (!under) throw new Error(`--jh-${name} is translucent: pair it over a surface`);
    return composite(rgb, alpha, under);
  };
  const back = paint(bg, base && paint(base));
  return contrast(paint(fg, back), back, SPACE[method]);
}

/** Contrast of one pairing on each kind of screen: { srgb, p3 }. */
export function screenContrasts(props, pairing) {
  return Object.fromEntries(
    Object.entries(SCREENS).map(([screen, methods]) => [
      screen,
      Math.min(...methods.map((m) => methodContrast(props, pairing, m))),
    ])
  );
}

/** Contrast of one pairing in `props`: the lowest on any screen. */
export function pairContrast(props, pairing) {
  return Math.min(...Object.values(screenContrasts(props, pairing)));
}

const contexts = () => THEMES.flatMap((theme) => ACCENTS.map((accent) => ({ theme, accent })));

/** Every pairing in every theme and accent, scored on each screen. */
function score(css, pairings) {
  const { rules } = readTokens(css);
  return contexts().flatMap((ctx) => {
    const props = resolveContext(rules, ctx);
    return pairings.map((p) => {
      const { srgb, p3 } = screenContrasts(props, p);
      const ratio = Math.min(srgb, p3);
      return { ...p, ...ctx, srgb, p3, ratio, min: RULES[p.rule], pass: ratio >= RULES[p.rule] };
    });
  });
}

/**
 * Every pairing in every theme and accent, on sRGB and Display P3 screens:
 * { results, failures }. A result passes only if it meets its floor on both.
 * A FORBIDDEN pairing in `pairings` is refused.
 */
export function checkContrast(css = readFileSync(TOKENS_FILE, 'utf8'), pairings = PAIRINGS) {
  for (const p of pairings) {
    const banned = FORBIDDEN.find((f) => samePairing(f, p));
    if (banned) {
      throw new Error(
        `${p.fg} ${banned.where} is ruled out (FORBIDDEN; docs/design-system.md, rule 5)`
      );
    }
  }
  const results = score(css, pairings);
  return { results, failures: results.filter((r) => !r.pass) };
}

/** Each FORBIDDEN pairing's worst result in every theme and accent, for the report. */
export function checkRuledOut(css = readFileSync(TOKENS_FILE, 'utf8')) {
  const results = score(css, FORBIDDEN);
  return FORBIDDEN.map((f) =>
    results.filter((r) => samePairing(r, f)).reduce((a, b) => (b.ratio < a.ratio ? b : a))
  );
}

/**
 * Each accent's hover against its rest state, in every theme, as each screen
 * paints them: { results, failures }. A result fails below HOVER_MIN_DE.
 */
export function checkHover(css = readFileSync(TOKENS_FILE, 'utf8')) {
  const { rules } = readTokens(css);
  const results = contexts().map((ctx) => {
    const props = resolveContext(rules, ctx);
    const [rest, hover] = ['accent', 'accent-hover'].map((n) => tokenColor(props, n));
    if (rest.alpha < 1 || hover.alpha < 1)
      throw new Error('accent and accent-hover must be opaque');
    const de = Math.min(
      ...Object.keys(SPACE).map((m) =>
        deltaEOK(paintedOklab(rest.lch, m), paintedOklab(hover.lch, m))
      )
    );
    return { ...ctx, de, pass: de >= HOVER_MIN_DE };
  });
  return { results, failures: results.filter((r) => !r.pass) };
}

/** A ratio to 2 decimals, never rounded up to a floor it misses (4.4999 is 4.49). */
export const formatRatio = (ratio, floor) =>
  `${(ratio < floor ? Math.floor(ratio * 100) / 100 : ratio).toFixed(2)}:1`;

const SCREEN_NAMES = { srgb: 'sRGB', p3: 'P3' };
const pairName = (r) => `${r.fg} on ${r.bg}${r.over ? ` over ${r.over}` : ''}`;

export const describe = (r) =>
  `${pairName(r)} (${r.theme}, ${r.accent}): ` +
  Object.keys(SCREENS)
    .map((s) => `${SCREEN_NAMES[s]} ${formatRatio(r[s], r.min)}`)
    .join(', ') +
  `, needs ${r.min}:1`;

/** Markdown: the lowest ratio per rule on each screen, ruled-out pairings, and hovers. */
export function report({ results, failures }, { ruledOut = [], hover } = {}) {
  const lines = [
    '| Rule | Floor | Lowest, sRGB | Where | Lowest, Display P3 | Where |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const rule of Object.keys(RULES)) {
    const rows = results.filter((r) => r.rule === rule);
    const cells = Object.keys(SCREENS).map((s) => {
      const low = rows.reduce((a, b) => (b[s] < a[s] ? b : a));
      return `${formatRatio(low[s], low.min)} | ${pairName(low)}, ${low.theme}, ${low.accent}`;
    });
    lines.push(`| ${rule} | ${RULES[rule]}:1 | ${cells.join(' | ')} |`);
  }
  lines.push(
    '',
    `${results.length} pairings checked on sRGB and Display P3, ${failures.length} below their floor.`
  );
  for (const f of failures) lines.push(`- FAIL ${describe(f)}`);
  if (ruledOut.length) {
    lines.push('', 'Ruled out by name (never declared; docs/design-system.md, rule 5):');
    for (const r of ruledOut) lines.push(`- ${r.fg} ${r.where}, at worst ${describe(r)}`);
  }
  if (hover) {
    const low = hover.results.reduce((a, b) => (b.de < a.de ? b : a));
    lines.push(
      '',
      `Hover against rest: lowest ΔE OK ${low.de.toFixed(3)} (${low.theme}, ${low.accent}), ` +
        `needs ${HOVER_MIN_DE}; ${hover.failures.length} too close.`
    );
    for (const f of hover.failures) {
      lines.push(
        `- FAIL accent-hover vs accent (${f.theme}, ${f.accent}): ΔE OK ${f.de.toFixed(3)}`
      );
    }
  }
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : TOKENS_FILE;
  const css = readFileSync(file, 'utf8');
  const result = checkContrast(css);
  const hover = checkHover(css);
  console.log(report(result, { ruledOut: checkRuledOut(css), hover }));
  if (result.failures.length || hover.failures.length) process.exitCode = 1;
}
