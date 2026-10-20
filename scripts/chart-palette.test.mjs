// Guards JagHelm's chart colours (src/ui/tokens.css, #386): the six categorical
// slots and the sequential ramp Jag signed off on 2026-10-20, their utilities,
// their 3:1 contrast where charts are drawn, the ramp's shape, and the gates the
// palette was chosen by, computed from the tokens as written: neighbouring
// slots apart under protanopia, deuteranopia and normal vision, slots 1 to 3
// apart in every pair, every slot clear of the status colours and of the
// violet accent, and enough chroma. Each gate is shown to bite.
// docs/design-system.md, "Chart colours", states the rules these keep.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@tailwindcss/node';
import {
  ACCENTS,
  ACCENT_MARKS,
  CHART_FLOORS,
  MACHADO,
  PAIRINGS,
  RAMP,
  RAMP_MIN_STEP,
  RAMP_ORDINAL_MIN,
  RAMP_ORDINAL_STEP,
  RULES,
  SERIES,
  STATUS_MARKS,
  THEMES,
  TOKENS_FILE,
  checkChartPalette,
  checkContrast,
  checkRamp,
  describe,
  formatDE,
  nearestSlots,
  readTokens,
  render,
  resolveContext,
  simulateCvd,
  tokenColor,
} from './ui-contrast.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STACK = path.join(ROOT, 'src/ui/tailwind.css');
const DOC = path.join(ROOT, 'docs/design-system.md');
const SCRIPT = fileURLToPath(new URL('./ui-contrast.mjs', import.meta.url));
const TOKENS = readFileSync(TOKENS_FILE, 'utf8');
const { rules } = readTokens(TOKENS);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

// Issue #386, comment 9033, signed off in comment 9115 (Jag, 2026-10-20).
const SIGNED_OFF = [
  { name: 'Azure', dark: 'oklch(0.6 0.138 240)', light: 'oklch(0.58 0.133 240)' },
  { name: 'Rose', dark: 'oklch(0.64 0.15 355)', light: 'oklch(0.5 0.15 355)' },
  { name: 'Lime', dark: 'oklch(0.66 0.15 125)', light: 'oklch(0.56 0.141 125)' },
  { name: 'Plum', dark: 'oklch(0.55 0.15 325)', light: 'oklch(0.6 0.15 325)' },
  { name: 'Orange', dark: 'oklch(0.66 0.15 55)', light: 'oklch(0.6 0.149 55)' },
  { name: 'Teal', dark: 'oklch(0.66 0.112 200)', light: 'oklch(0.62 0.105 200)' },
];
// The ramp, none to most, as the sign-off lists it (hex).
const SIGNED_OFF_RAMP = {
  dark: ['#00314d', '#00476c', '#005e8c', '#0076af', '#4191c5', '#75acd2', '#a4c6de'],
  light: ['#cce9ff', '#9bd2fa', '#6bbaf0', '#36a2e3', '#0089c9', '#006da2', '#00537c'],
};

const hex = (rgb) =>
  `#${rgb
    .map((x) =>
      Math.round(x * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
const props = (theme, accent = 'violet') => resolveContext(rules, { theme, accent });
const value = (theme, name) => props(theme)[`--jh-${name}`];

/** The lowest result of `gate` in `theme`. */
const worst = (results, gate, theme) =>
  results
    .filter((r) => r.gate === gate && r.theme === theme)
    .reduce((a, b) => (b.value < a.value ? b : a));
const show = (r) =>
  r.gate === 'chroma'
    ? `${r.a} ${r.value}`
    : `${r.a}–${r.b}${r.vision === 'normal' ? '' : ` ${r.vision}`} ${formatDE(r.value)}`;

test('the six slots and the ramp are the values Jag signed off, in order', () => {
  assert.deepEqual(
    SERIES,
    [1, 2, 3, 4, 5, 6].map((i) => `series-${i}`)
  );
  assert.deepEqual(
    RAMP,
    [1, 2, 3, 4, 5, 6, 7].map((i) => `seq-${i}`)
  );
  for (const theme of THEMES) {
    assert.deepEqual(
      SERIES.map((s) => value(theme, s)),
      SIGNED_OFF.map((s) => s[theme]),
      `the slots, ${theme}`
    );
    // tokens.css speaks OKLCH: each step is slot 1's hue, 240, and paints the
    // signed-off hex on an sRGB screen, by clipping and by CSS gamut mapping.
    for (const [i, step] of RAMP.entries()) {
      const { lch, alpha } = tokenColor(props(theme), step);
      assert.equal(alpha, 1, `${step}, ${theme}: opaque`);
      assert.equal(lch[2], 240, `${step}, ${theme}: azure's hue`);
      for (const method of ['clip', 'map']) {
        assert.equal(
          hex(render(lch, method)),
          SIGNED_OFF_RAMP[theme][i],
          `${step}, ${theme}, ${method}`
        );
      }
    }
  }
});

test('the chart colours never change with the accent', () => {
  for (const theme of THEMES) {
    const base = props(theme, 'violet');
    for (const accent of ACCENTS) {
      const p = props(theme, accent);
      for (const name of [...SERIES, ...RAMP]) {
        assert.equal(p[`--jh-${name}`], base[`--jh-${name}`], `${name}, ${theme}, ${accent}`);
      }
    }
  }
  // No accent block sets one (ui-tokens.test.mjs holds each to its eight roles).
  for (const r of rules.filter((x) => x.attrs.accent)) {
    for (const name of [...SERIES, ...RAMP]) {
      assert.ok(!(`--jh-${name}` in r.decls), `${r.selector} sets --jh-${name}`);
    }
  }
});

test('tailwind.css offers each as fill, stroke, background and text utilities', async () => {
  const theme = readFileSync(STACK, 'utf8');
  for (const name of [...SERIES, ...RAMP]) {
    assert.ok(
      theme.includes(`--color-${name}: var(--jh-${name});`),
      `tailwind.css maps --color-${name}`
    );
  }
  const compiler = await compile(theme, { base: path.join(ROOT, 'src/ui'), onDependency() {} });
  const css = compiler.build(['fill-series-1', 'stroke-series-6', 'bg-seq-7', 'text-series-3']);
  assert.match(css, /\.fill-series-1\s*\{\s*fill:\s*var\(--jh-series-1\)/);
  assert.match(css, /\.stroke-series-6\s*\{\s*stroke:\s*var\(--jh-series-6\)/);
  assert.match(css, /\.bg-seq-7\s*\{\s*background-color:\s*var\(--jh-seq-7\)/);
  assert.match(css, /\.text-series-3\s*\{\s*color:\s*var\(--jh-series-3\)/);
});

test('every slot is at least 3:1 where a chart is drawn, in both themes and every accent', () => {
  assert.equal(RULES.series, 3, "WCAG 1.4.11's 3:1 for a graphical object");
  const series = PAIRINGS.filter((p) => p.rule === 'series');
  // The page, a panel, a hovered tile or a chart's tooltip, and a hovered row.
  const where = (p) => (p.over ? `${p.bg} over ${p.over}` : p.bg);
  for (const s of SERIES) {
    assert.deepEqual(
      series.filter((p) => p.fg === s).map(where),
      ['bg', 'surface-1', 'surface-2', 'row-hover over surface-1'],
      `${s}'s pairings`
    );
  }
  const { results, failures } = checkContrast(TOKENS, series);
  assert.equal(results.length, SERIES.length * 4 * THEMES.length * ACCENTS.length);
  assert.deepEqual(failures.map(describe), [], 'these slots are below 3:1');
  // The dimmest, as docs/design-system.md quotes them: dark plum and light teal,
  // on surface-2.
  const low = (theme) =>
    results.filter((r) => r.theme === theme).reduce((a, b) => (b.ratio < a.ratio ? b : a));
  assert.deepEqual([low('dark').fg, low('dark').bg], ['series-4', 'surface-2']);
  near(low('dark').ratio, 3.15, 0.005, 'dark plum on surface-2');
  assert.deepEqual([low('light').fg, low('light').bg], ['series-6', 'surface-2']);
  near(low('light').ratio, 3.11, 0.005, 'light teal on surface-2');
  // On surface-3 (a chip, a track) they are not: the docs keep charts off it.
  const on3 = checkContrast(
    TOKENS,
    SERIES.map((fg) => ({ rule: 'series', fg, bg: 'surface-3' }))
  );
  assert.deepEqual([...new Set(on3.failures.map((f) => `${f.fg} ${f.theme}`))].sort(), [
    'series-4 dark',
    'series-6 light',
  ]);
});

test('the ramp steps away from the panel, one hue, and step 3 clears 2:1', () => {
  assert.equal(RAMP_MIN_STEP, 0.06);
  assert.equal(RAMP_ORDINAL_STEP, 3);
  assert.equal(RAMP_ORDINAL_MIN, 2);
  const { results, failures } = checkRamp(TOKENS);
  assert.equal(results.length, THEMES.length * ACCENTS.length);
  assert.deepEqual(
    failures.map((f) => `${f.theme} ${f.accent}: ${f.problems.join('; ')}`),
    []
  );
  const at = (theme) => results.find((r) => r.theme === theme && r.accent === 'violet');
  // Lighter step by step in dark, darker in light: away from surface-1 both ways.
  assert.deepEqual(
    at('dark').steps.map((s) => s.l),
    [0.3, 0.38, 0.459, 0.54, 0.63, 0.72, 0.81]
  );
  assert.deepEqual(
    at('light').steps.map((s) => s.l),
    [0.92, 0.84, 0.76, 0.68, 0.6, 0.511, 0.42]
  );
  // Step 3, where an ordinal scale starts: the sign-off's 2.58:1 and 2.12:1.
  near(at('dark').ordinal, 2.58, 0.005, 'dark step 3');
  near(at('light').ordinal, 2.12, 0.005, 'light step 3');
});

test('the ramp check bites: a step out of order, too close, off-hue or too faint fails', () => {
  const problems = (css) =>
    checkRamp(`${TOKENS}\n${css}\n`).failures.map((f) => `${f.theme} ${f.accent}: ${f.problems}`);
  const dark = problems('.jh-ui { --jh-seq-4: oklch(0.45 0.124 240); }');
  assert.equal(dark.length, ACCENTS.length);
  assert.match(dark[0], /^dark violet: seq-4 is not further from surface-1 than seq-3/);
  assert.match(
    problems(".jh-ui[data-theme='light'] { --jh-seq-2: oklch(0.89 0.08 240); }")[0],
    /^light violet: seq-2 is 0\.030 from seq-1, needs 0\.06/
  );
  assert.match(
    problems('.jh-ui { --jh-seq-6: oklch(0.72 0.08 200); }')[0],
    /seq-6 has hue 200, not series-1's 240/
  );
  assert.match(
    problems(".jh-ui[data-theme='light'] { --jh-seq-3: oklch(0.79 0.11 240); }")[0],
    /^light violet: .*seq-3 is 1\.\d\d:1 on surface-1, needs 2:1$/
  );
});

test('the CVD matrices are Machado, Oliveira and Fernandes (2009) at severity 1.0', () => {
  assert.deepEqual(MACHADO, {
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
  });
  // Neutrals stay neutral (each row sums to 1); red loses most of its light
  // for a protan and collapses toward olive for both, and the result is clamped.
  for (const type of ['protan', 'deutan']) {
    for (const grey of [0, 0.25, 1]) {
      simulateCvd([grey, grey, grey], type).forEach((x) => near(x, grey, 1e-5, `${type} grey`));
    }
  }
  const red = simulateCvd([1, 0, 0], 'protan');
  near(red[0], 0.152286, 1e-9, 'protan red, r');
  near(red[1], 0.114503, 1e-9, 'protan red, g');
  assert.equal(red[2], 0, 'clamped at 0');
  assert.deepEqual(simulateCvd([0, 1, 0], 'protan'), [1, 0.786281, 0], 'clamped at 1');
});

test('the palette passes every gate it was chosen by, in both themes', () => {
  assert.deepEqual(CHART_FLOORS, {
    adjacent: 15,
    'adjacent-cvd': 8,
    'first-three-cvd': 8,
    status: 8.5,
    violet: 12,
    chroma: 0.1,
  });
  const { results, failures } = checkChartPalette(TOKENS);
  assert.deepEqual(failures.map(show), [], 'these gates fail (docs/design-system.md):');
  // What each gate covers, per theme: neighbours (5 pairs) in normal vision and
  // both CVDs, slots 1–3 (3 pairs) in both CVDs, each slot against every status
  // lamp and word and every violet mark, and each slot's chroma.
  const count = (gate) => results.filter((r) => r.gate === gate).length / THEMES.length;
  assert.equal(count('adjacent'), 5);
  assert.equal(count('adjacent-cvd'), 10);
  assert.equal(count('first-three-cvd'), 6);
  assert.equal(count('status'), SERIES.length * STATUS_MARKS.length);
  assert.equal(count('violet'), SERIES.length * ACCENT_MARKS.length);
  assert.equal(count('chroma'), SERIES.length);
  // The sign-off's figures (ΔE OK ×100, rounded down): neighbours under CVD
  // 8.8, in normal vision 21.1, slots 1–3 in every pair 8.8, and the nearest
  // status pair, light teal to light ok, 8.8.
  const pinned = Object.fromEntries(
    THEMES.flatMap((theme) =>
      ['adjacent-cvd', 'adjacent', 'first-three-cvd', 'status', 'violet', 'chroma'].map((g) => [
        `${g} ${theme}`,
        show(worst(results, g, theme)),
      ])
    )
  );
  assert.deepEqual(pinned, {
    'adjacent-cvd dark': 'series-1–series-2 protan 8.8',
    'adjacent dark': 'series-4–series-5 23.8',
    'first-three-cvd dark': 'series-1–series-2 protan 8.8',
    'status dark': 'series-2–crit-solid 10.7',
    'violet dark': 'series-4–focus-ring 14.6',
    'chroma dark': 'series-6 0.112',
    'adjacent-cvd light': 'series-2–series-3 deutan 12.4',
    'adjacent light': 'series-4–series-5 21.1',
    'first-three-cvd light': 'series-2–series-3 deutan 12.4',
    'status light': 'series-6–ok-solid 8.8',
    'violet light': 'series-4–meter 13.1',
    'chroma light': 'series-6 0.105',
  });
});

test('with Fuchsia or Cyan, the nearest slot to the accent is the one the docs name', () => {
  const nearest = Object.fromEntries(
    nearestSlots(TOKENS).map((n) => [
      `${n.accent} ${n.theme}`,
      `${n.fill.slot} ${formatDE(n.fill.de)}; ${n.mark.slot}–${n.mark.mark} ${formatDE(n.mark.de)}`,
    ])
  );
  assert.deepEqual(nearest, {
    'violet dark': 'series-4 17.3; series-4–focus-ring 14.6',
    'violet light': 'series-4 18.2; series-4–meter 13.1',
    'fuchsia dark': 'series-4 8.1; series-4–accent-hover 7.6',
    'fuchsia light': 'series-4 9.9; series-4–meter 5.9',
    'cyan dark': 'series-1 10.5; series-6–focus-ring 2.9',
    'cyan light': 'series-1 8.7; series-6–meter 5.6',
  });
});

test('each gate bites: one slot moved fails it, and names the pair', async (t) => {
  const failing = (css) =>
    checkChartPalette(`${TOKENS}\n${css}\n`).failures.map((f) => `${f.gate} ${f.theme} ${show(f)}`);

  await t.test('rose moved toward azure fails the CVD neighbours, in dark only', () => {
    const f = failing('.jh-ui { --jh-series-2: oklch(0.6 0.15 300); }');
    assert.ok(f.length > 0);
    assert.ok(
      f.some((x) => /^adjacent-cvd dark series-1–series-2 (protan|deutan)/.test(x)),
      f
    );
    assert.ok(
      f.some((x) => /^first-three-cvd dark series-1–series-2/.test(x)),
      f
    );
    assert.ok(
      f.every((x) => x.includes(' dark ')),
      f
    );
  });

  await t.test('two neighbours a lightness step apart, same hue, fail normal vision', () => {
    const f = failing(".jh-ui[data-theme='light'] { --jh-series-5: oklch(0.68 0.15 325); }");
    assert.ok(f.includes('adjacent light series-4–series-5 8.0'), f);
  });

  await t.test('slots 1 and 3 too close under CVD fail the scatter gate', () => {
    const f = failing('.jh-ui { --jh-series-3: oklch(0.62 0.13 230); }');
    assert.ok(
      f.some((x) => /^first-three-cvd dark series-1–series-3/.test(x)),
      f
    );
  });

  await t.test('a slot in a status hue fails the status gate', () => {
    const f = failing('.jh-ui { --jh-series-6: oklch(0.765 0.15 163); }');
    assert.ok(
      f.some((x) => /^status dark series-6–ok-(solid|fg)/.test(x)),
      f
    );
  });

  await t.test('a slot near the violet accent fails the violet gate', () => {
    const f = failing('.jh-ui { --jh-series-4: oklch(0.6 0.22 300); }');
    assert.ok(
      f.some((x) => /^violet dark series-4–/.test(x)),
      f
    );
  });

  await t.test('a slot too grey fails the chroma floor', () => {
    const f = failing(".jh-ui[data-theme='light'] { --jh-series-6: oklch(0.62 0.09 200); }");
    assert.ok(f.includes('chroma light series-6 0.09'), f);
  });

  await t.test('the script exits non-zero and names the gate', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'jh-chart-'));
    try {
      const file = path.join(dir, 'tokens.css');
      writeFileSync(file, `${TOKENS}\n.jh-ui { --jh-series-2: oklch(0.6 0.15 300); }\n`);
      const bad = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
      assert.equal(bad.status, 1, bad.stderr);
      assert.match(bad.stdout, /FAIL adjacent-cvd: series-1–series-2 \((protan|deutan), dark\)/);
      const ramp = path.join(dir, 'ramp.css');
      writeFileSync(ramp, `${TOKENS}\n.jh-ui { --jh-seq-4: oklch(0.45 0.124 240); }\n`);
      const r = spawnSync(process.execPath, [SCRIPT, ramp], { encoding: 'utf8' });
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stdout, /FAIL ramp \(dark, violet\): seq-4 is not further from surface-1/);
      const good = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
      assert.equal(good.status, 0, good.stdout + good.stderr);
      assert.match(good.stdout, /Chart colours[^\n]*0 failing/);
      assert.match(good.stdout, /Ramp[^\n]*0 failing/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("design-system.md's chart colour tables match the tokens", () => {
  const lines = readFileSync(DOC, 'utf8').split('\n');
  const table = (head) => {
    const at = lines.indexOf(head);
    assert.ok(at >= 0, `design-system.md has no table headed ${head}`);
    const end = lines.findIndex((l, i) => i > at && !l.startsWith('|'));
    return lines.slice(at + 2, end).map((l) =>
      l
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim())
    );
  };
  assert.deepEqual(
    table('| Slot | Name | Token | Dark | Light |'),
    SIGNED_OFF.map((s, i) => [
      String(i + 1),
      s.name,
      `\`series-${i + 1}\``,
      `\`${s.dark}\``,
      `\`${s.light}\``,
    ])
  );
  assert.deepEqual(
    table('| Step | Token | Dark | Light |'),
    RAMP.map((step, i) => [
      String(i + 1),
      `\`${step}\``,
      `\`${value('dark', step)}\` ${SIGNED_OFF_RAMP.dark[i]}`,
      `\`${value('light', step)}\` ${SIGNED_OFF_RAMP.light[i]}`,
    ])
  );
  // The gates table: every gate, its floor, and its worst figure in either theme.
  const { results } = checkChartPalette(TOKENS);
  const gates = table('| Gate | Check | Floor | Worst |');
  assert.deepEqual(
    gates.map(([g]) => g.replaceAll('`', '')).sort(),
    Object.keys(CHART_FLOORS).sort()
  );
  for (const [g, , floor, worstCell] of gates) {
    const gate = g.replaceAll('`', '');
    assert.equal(Number(floor), CHART_FLOORS[gate], `${gate}'s floor`);
    const low = results
      .filter((r) => r.gate === gate)
      .reduce((a, b) => (b.value < a.value ? b : a));
    const figure = gate === 'chroma' ? String(low.value) : formatDE(low.value);
    assert.ok(worstCell.startsWith(`${figure}, `), `${gate}'s worst is ${figure}: ${worstCell}`);
    assert.ok(worstCell.includes(`(${low.theme}`), `${gate}'s worst is in ${low.theme}`);
  }
});
