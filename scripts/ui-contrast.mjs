// Contrast check for JagHelm's design tokens (src/ui/tokens.css, #283).
//
// Every text/background pairing the design system allows (PAIRINGS) is computed
// in both themes and with every accent (src/ui/accents.js), and must meet the
// spec's floor (RULES, spec §5.2): text-1 7:1; text-2, text-3, on-accent,
// accent-text, status fg and on-solid 4.5:1; the focus ring 3:1 against the
// surface around it; the edge of a control with no fill of its own (an
// empty checkbox, an off switch) 3:1 against the surface it sits on, and a
// meter's fill 3:1 against its empty track (WCAG 1.4.11). Pairings ruled out
// by name (FORBIDDEN) may never be
// declared. Each accent's hover must also differ visibly from its rest state
// (HOVER_MIN_DE), and no accent may read as a status colour (STATUS_MIN_DE).
//
// The chart colours (#386) are checked here too: each of the six slots 3:1
// where a chart is drawn (a PAIRINGS rule, `series`), the sequential ramp's
// shape (checkRamp), and the gates that hold the palette (checkChartPalette:
// neighbours apart under protanopia, deuteranopia and normal vision, slots 1
// to 3 apart in every pair under all three, clear of the status colours and
// the violet accent, enough chroma, and inside each theme's lightness band).
//
//   node scripts/ui-contrast.mjs [tokens.css]
//     prints the lowest ratio per rule on sRGB and on Display P3 screens, each
//     accent's nearest status colour and the chart colours' closest calls, and
//     fails (exit 1) on any pairing below its floor on either, on a hover too
//     close to its rest state, on an accent too close to a status, or on a
//     chart gate. The file defaults to src/ui/tokens.css.
//
// scripts/ui-contrast.test.mjs and scripts/chart-palette.test.mjs run the same
// checks in `npm test`.
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
import { ACCENTS as ACCENT_LIST, DEFAULT_ACCENT } from '../src/ui/accents.js';
import { DEFAULT_TYPEFACE } from '../src/ui/typefaces.js';
import {
  RULES,
  accentStatusDistances,
  formatRatio,
  hoverDistance,
  pairName,
  SERIES,
  RAMP,
  PAIRINGS,
  FORBIDDEN,
  samePairing,
  HOVER_MIN_DE,
  STATUS_MIN_DE,
  ACCENT_MARKS,
  STATUS_MARKS,
  mul,
  encode,
  decode,
  rgbToOklab,
  clip,
  deltaEOK,
  SCREENS,
  SPACE,
  render,
  paintedOklab,
  tokenColor,
  screenContrasts,
  pairContrast,
} from '../server/uiContrast.js';

export * from '../server/uiContrast.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TOKENS_FILE = path.join(ROOT, 'src/ui/tokens.css');

export const THEMES = ['dark', 'light'];
/** Every accent's `data-accent` id, from the one list (src/ui/accents.js). */
export const ACCENTS = ACCENT_LIST.map((a) => a.id);
// The values a context takes when its element carries no attribute. The
// typeface sets no colour; it is here so the reader knows the switch.
const DEFAULTS = {
  theme: 'dark',
  accent: DEFAULT_ACCENT,
  density: 'comfortable',
  typeface: DEFAULT_TYPEFACE,
};


// ---- Reading the tokens ------------------------------------------------------

const SELECTOR = /^\.jh-ui((?:\[data-(?:theme|accent|density|typeface)=(['"])[a-z-]+\2\])*)$/;

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
        [...m[1].matchAll(/\[data-(\w+)=['"]([a-z-]+)['"]\]/g)].map(([, k, v]) => [k, v])
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
    const de = hoverDistance(props);
    return { ...ctx, de, pass: de >= HOVER_MIN_DE };
  });
  return { results, failures: results.filter((r) => !r.pass) };
}

/**
 * Each accent's marks against each status colour, in every theme, as each
 * screen paints them: { results, failures }. A result fails below
 * STATUS_MIN_DE. `accents` defaults to every accent offered; a test passes
 * the dropped ones to show the rule catches them.
 */
export function checkAccentStatus(css = readFileSync(TOKENS_FILE, 'utf8'), accents = ACCENTS) {
  const { rules } = readTokens(css);
  const results = accents.flatMap((accent) =>
    THEMES.flatMap((theme) => {
      const props = resolveContext(rules, { theme, accent });
      return accentStatusDistances(props).map(({ mark, status, de }) => ({
        theme,
        accent,
        mark,
        status,
        de,
        pass: de >= STATUS_MIN_DE,
      }));
    })
  );
  return { results, failures: results.filter((r) => !r.pass) };
}

/** The closest accent-to-status pair for each accent in each theme. */
export function nearestStatus({ results }) {
  const nearest = new Map();
  for (const r of results) {
    const key = `${r.theme} ${r.accent}`;
    if (!nearest.has(key) || r.de < nearest.get(key).de) nearest.set(key, r);
  }
  return [...nearest.values()];
}

// ---- Chart colours (#386) ---------------------------------------------------

/**
 * The sequential ramp, in each theme: each step further from surface-1's
 * lightness than the one before, by at least RAMP_MIN_STEP (OKLCH L, as
 * written), all in slot 1's hue; and step RAMP_ORDINAL_STEP, where an ordinal
 * scale starts, at least RAMP_ORDINAL_MIN against surface-1. The ramp is not
 * held to 3:1: its first steps recede toward the panel by design, as a
 * sequential scale's "none" end should.
 */
export const RAMP_MIN_STEP = 0.06;
export const RAMP_ORDINAL_STEP = 3;
export const RAMP_ORDINAL_MIN = 2;

/**
 * The gates that hold the six slots (#386, signed off 2026-10-20), as ΔE OK
 * ×100 between the colours a screen paints, and chroma and lightness as
 * written. The separation and chroma floors are the checks the sign-off ran;
 * status and violet are set under the margins it measured (8.8 from the
 * nearest status colour, 16 from the violet fill).
 *
 *  - adjacent: neighbouring slots in normal vision, as either screen paints them.
 *  - adjacent-cvd: neighbouring slots under protanopia and under deuteranopia.
 *    A stacked chart keeps its order, so neighbours touch.
 *  - first-three, first-three-cvd: slots 1 to 3 in every pair, in normal vision
 *    and under both, so a scatter, a map or a small multiple, where any two can
 *    meet, shows three series.
 *  - status: every slot against every status lamp or bar (`solid`) and word
 *    (`fg`), so a series never reads as a state.
 *  - violet: every slot against each mark of the default accent (ACCENT_MARKS).
 *  - chroma: every slot's OKLCH chroma, so none reads as a grey.
 *  - lightness (CHART_LIGHTNESS): every slot's OKLCH L inside its theme's band,
 *    so none glares or sinks into the panel beside the others.
 */
export const CHART_FLOORS = {
  adjacent: 15,
  'adjacent-cvd': 8,
  'first-three': 15,
  'first-three-cvd': 8,
  status: 8.5,
  violet: 12,
  chroma: 0.1,
};
/** The lightness band per theme, [lowest, highest] OKLCH L as written. */
export const CHART_LIGHTNESS = { dark: [0.48, 0.67], light: [0.43, 0.77] };
const FIRST_THREE = 3;

/**
 * Machado, Oliveira and Fernandes (2009) at severity 1.0, applied to linear
 * sRGB: full protanopia and deuteranopia, the strongest red-green colour
 * blindness, so the milder forms are covered too.
 */
export const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};
const CVDS = Object.keys(MACHADO);

/** Linear sRGB as `type` ('protan' or 'deutan') sees it, clamped to 0..1. */
export const simulateCvd = (linear, type) => clip(mul(MACHADO[type], linear));

/** OKLab of a colour as an sRGB screen paints it by `method`, seen with `vision`. */
const seenOklab = (lch, method, vision) =>
  rgbToOklab(simulateCvd(render(lch, method).map(decode), vision).map(encode), 'srgb');

/**
 * ΔE OK ×100 between two colours, the least on any screen: in normal vision as
 * sRGB and Display P3 screens paint them, under a CVD as sRGB screens do (the
 * matrices are sRGB's).
 */
function chartDE(a, b, vision) {
  const des =
    vision === 'normal'
      ? Object.keys(SPACE).map((m) => deltaEOK(paintedOklab(a, m), paintedOklab(b, m)))
      : SCREENS.srgb.map((m) => deltaEOK(seenOklab(a, m, vision), seenOklab(b, m, vision)));
  return 100 * Math.min(...des);
}

function opaqueColor(props, name) {
  const { lch, alpha } = tokenColor(props, name);
  if (alpha < 1) throw new Error(`--jh-${name} must be opaque`);
  return lch;
}

/**
 * The ramp in every theme and accent: { results, failures }. Each result lists
 * its steps' lightness and hue as written, step 3's ratio on surface-1
 * (`ordinal`) and its problems.
 */
export function checkRamp(css = readFileSync(TOKENS_FILE, 'utf8')) {
  const { rules } = readTokens(css);
  const results = contexts().map((ctx) => {
    const props = resolveContext(rules, ctx);
    const surface = opaqueColor(props, 'surface-1')[0];
    const hue = opaqueColor(props, SERIES[0])[2];
    const steps = RAMP.map((name) => {
      const [l, , h] = opaqueColor(props, name);
      return { name, l, h, away: l - surface };
    });
    const problems = [];
    steps.forEach((step, i) => {
      if (Math.abs(step.h - hue) > 1e-9) {
        problems.push(`${step.name} has hue ${step.h}, not ${SERIES[0]}'s ${hue}`);
      }
      if (i === 0) return;
      const prev = steps[i - 1];
      const gap = Math.abs(step.away) - Math.abs(prev.away);
      if (Math.sign(step.away) !== Math.sign(prev.away) || gap <= 0) {
        problems.push(`${step.name} is not further from surface-1 than ${prev.name}`);
      } else if (gap < RAMP_MIN_STEP) {
        problems.push(
          `${step.name} is ${gap.toFixed(3)} from ${prev.name}, needs ${RAMP_MIN_STEP}`
        );
      }
    });
    const ordinalStep = RAMP[RAMP_ORDINAL_STEP - 1];
    const ordinal = pairContrast(props, { fg: ordinalStep, bg: 'surface-1' });
    if (ordinal < RAMP_ORDINAL_MIN) {
      problems.push(
        `${ordinalStep} is ${formatRatio(ordinal, RAMP_ORDINAL_MIN)} on surface-1, ` +
          `needs ${RAMP_ORDINAL_MIN}:1`
      );
    }
    return {
      ...ctx,
      steps: steps.map(({ name, l, h }) => ({ name, l, h })),
      minGap: Math.min(...steps.slice(1).map((s, i) => Math.abs(s.away) - Math.abs(steps[i].away))),
      ordinal,
      problems,
      pass: problems.length === 0,
    };
  });
  return { results, failures: results.filter((r) => !r.pass) };
}

/**
 * Every chart gate (CHART_FLOORS and the lightness band) in both themes:
 * { results, failures }. A result is { gate, theme, a, b, vision, value, min,
 * pass }: `value` is ΔE OK ×100; for the chroma gate, which has no `b`, the
 * chroma; for the lightness gate, how far inside its band the slot's L sits
 * (negative outside it), with the L itself as `l` and the band as `band`. The
 * slots don't change with the accent, so each theme is read once, with violet.
 */
export function checkChartPalette(css = readFileSync(TOKENS_FILE, 'utf8')) {
  const { rules } = readTokens(css);
  const results = THEMES.flatMap((theme) => {
    const props = resolveContext(rules, { theme, accent: 'violet' });
    const color = (name) => opaqueColor(props, name);
    const row = (gate, a, b, vision) => {
      const value = chartDE(color(a), color(b), vision);
      return {
        gate,
        theme,
        a,
        b,
        vision,
        value,
        min: CHART_FLOORS[gate],
        pass: value >= CHART_FLOORS[gate],
      };
    };
    const out = [];
    SERIES.slice(1).forEach((b, i) => {
      out.push(row('adjacent', SERIES[i], b, 'normal'));
      for (const v of CVDS) out.push(row('adjacent-cvd', SERIES[i], b, v));
    });
    SERIES.slice(0, FIRST_THREE).forEach((a, i) => {
      for (const b of SERIES.slice(i + 1, FIRST_THREE)) {
        out.push(row('first-three', a, b, 'normal'));
        for (const v of CVDS) out.push(row('first-three-cvd', a, b, v));
      }
    });
    for (const a of SERIES) {
      for (const m of STATUS_MARKS) out.push(row('status', a, m, 'normal'));
      for (const m of ACCENT_MARKS) out.push(row('violet', a, m, 'normal'));
      const value = color(a)[1];
      out.push({
        gate: 'chroma',
        theme,
        a,
        value,
        min: CHART_FLOORS.chroma,
        pass: value >= CHART_FLOORS.chroma,
      });
      const l = color(a)[0];
      const band = CHART_LIGHTNESS[theme];
      const inside = Math.min(l - band[0], band[1] - l);
      out.push({ gate: 'lightness', theme, a, l, band, value: inside, min: 0, pass: inside >= 0 });
    }
    return out;
  });
  return { results, failures: results.filter((r) => !r.pass) };
}

/**
 * With each accent, in each theme, the slot nearest its fill (`accent`) and the
 * slot nearest any of its marks (ACCENT_MARKS), as ΔE OK ×100 in normal vision.
 * Not a gate: charts never draw the accent inside the plot.
 */
export function nearestSlots(css = readFileSync(TOKENS_FILE, 'utf8')) {
  const { rules } = readTokens(css);
  return ACCENTS.flatMap((accent) =>
    THEMES.map((theme) => {
      const props = resolveContext(rules, { theme, accent });
      const color = (name) => opaqueColor(props, name);
      const pairs = SERIES.flatMap((slot) =>
        ACCENT_MARKS.map((mark) => ({
          slot,
          mark,
          de: chartDE(color(slot), color(mark), 'normal'),
        }))
      );
      const least = (list) => list.reduce((a, b) => (b.de < a.de ? b : a));
      return {
        accent,
        theme,
        fill: least(pairs.filter((p) => p.mark === 'accent')),
        mark: least(pairs),
      };
    })
  );
}

/** ΔE ×100 to one decimal, rounded down, as the sign-off quotes it (8.886 is 8.8). */
export const formatDE = (de) => (Math.floor(de * 10) / 10).toFixed(1);

const SCREEN_NAMES = { srgb: 'sRGB', p3: 'P3' };

export const describe = (r) =>
  `${pairName(r)} (${r.theme}, ${r.accent}): ` +
  Object.keys(SCREENS)
    .map((s) => `${SCREEN_NAMES[s]} ${formatRatio(r[s], r.min)}`)
    .join(', ') +
  `, needs ${r.min}:1`;

/**
 * Markdown: the lowest ratio per rule on each screen, ruled-out pairings,
 * hovers, status distance, and the chart colours' ramp and gates.
 */
export function report({ results, failures }, { ruledOut = [], hover, status, ramp, chart } = {}) {
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
  if (status) {
    lines.push(
      '',
      `Accent against status, nearest per accent (needs ΔE OK ${STATUS_MIN_DE}): ` +
        `${status.failures.length} too close.`
    );
    for (const n of nearestStatus(status)) {
      lines.push(`- ${n.accent}, ${n.theme}: ${n.de.toFixed(3)} (${n.mark} vs ${n.status})`);
    }
    for (const f of status.failures) {
      lines.push(
        `- FAIL ${f.mark} vs ${f.status} (${f.theme}, ${f.accent}): ΔE OK ${f.de.toFixed(3)}`
      );
    }
  }
  if (ramp) {
    const low = ramp.results.reduce((a, b) => (b.ordinal < a.ordinal ? b : a));
    const gap = Math.min(...ramp.results.map((r) => r.minGap));
    lines.push(
      '',
      `Ramp: step ${RAMP_ORDINAL_STEP} at ${formatRatio(low.ordinal, RAMP_ORDINAL_MIN)} on ` +
        `surface-1 at worst (${low.theme}), needs ${RAMP_ORDINAL_MIN}:1; steps at least ` +
        `${gap.toFixed(3)} apart in lightness, need ${RAMP_MIN_STEP}; ${ramp.failures.length} failing.`
    );
    for (const f of ramp.failures) {
      for (const p of f.problems) lines.push(`- FAIL ramp (${f.theme}, ${f.accent}): ${p}`);
    }
  }
  if (chart) {
    const pair = (r) => (r.b ? `${r.a}–${r.b}` : r.a);
    const shown = (r) =>
      r.gate === 'chroma'
        ? String(r.value)
        : r.gate === 'lightness'
          ? `L ${r.l}`
          : formatDE(r.value);
    const needs = (r) =>
      r.gate === 'lightness' ? `${r.band[0]}–${r.band[1]}` : String(CHART_FLOORS[r.gate]);
    const vision = (r) => (r.vision && r.vision !== 'normal' ? `${r.vision}, ` : '');
    lines.push(
      '',
      `Chart colours (ΔE OK ×100, rounded down), the closest call per gate: ` +
        `${chart.failures.length} failing.`
    );
    for (const gate of [...Object.keys(CHART_FLOORS), 'lightness']) {
      const low = chart.results
        .filter((r) => r.gate === gate)
        .reduce((a, b) => (b.value < a.value ? b : a));
      lines.push(
        `- ${gate}: ${shown(low)}, ${pair(low)} (${vision(low)}${low.theme}), needs ${needs(low)}`
      );
    }
    for (const f of chart.failures) {
      lines.push(
        `- FAIL ${f.gate}: ${pair(f)} (${vision(f)}${f.theme}): ${shown(f)}, needs ${needs(f)}`
      );
    }
    if (chart.nearest) {
      lines.push('', 'With each accent, the slot nearest its fill and nearest any of its marks:');
      for (const n of chart.nearest) {
        lines.push(
          `- ${n.accent}, ${n.theme}: ${n.fill.slot} ${formatDE(n.fill.de)}; ` +
            `${n.mark.slot}–${n.mark.mark} ${formatDE(n.mark.de)}`
        );
      }
    }
  }
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : TOKENS_FILE;
  const css = readFileSync(file, 'utf8');
  const result = checkContrast(css);
  const hover = checkHover(css);
  const status = checkAccentStatus(css);
  const ramp = checkRamp(css);
  const chart = { ...checkChartPalette(css), nearest: nearestSlots(css) };
  console.log(report(result, { ruledOut: checkRuledOut(css), hover, status, ramp, chart }));
  if (
    result.failures.length ||
    hover.failures.length ||
    status.failures.length ||
    ramp.failures.length ||
    chart.failures.length
  ) {
    process.exitCode = 1;
  }
}
