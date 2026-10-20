// Guards the contrast of JagHelm's design tokens (src/ui/tokens.css, #283): the
// colour maths against known values (sRGB and Display P3), every declared
// pairing against its floor in both themes and all accents on both kinds of
// screen, the pairings ruled out by name, each accent's hover against its rest
// state, every accent's distance from the status colours, and that the check
// fails on a bad pairing. scripts/chart-palette.test.mjs covers the chart
// colours (#386).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCENTS,
  ACCENT_MARKS,
  FORBIDDEN,
  HOVER_MIN_DE,
  PAIRINGS,
  RULES,
  STATUSES,
  STATUS_MARKS,
  STATUS_MIN_DE,
  THEMES,
  TOKENS_FILE,
  checkAccentStatus,
  checkContrast,
  checkHover,
  checkRuledOut,
  composite,
  contrast,
  describe,
  inGamut,
  luminance,
  nearestStatus,
  oklchToP3,
  oklchToSrgb,
  pairContrast,
  parseColor,
  readTokens,
  resolveContext,
  screenContrasts,
  toSrgb,
} from './ui-contrast.mjs';

const SCRIPT = fileURLToPath(new URL('./ui-contrast.mjs', import.meta.url));
const TOKENS = readFileSync(TOKENS_FILE, 'utf8');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

// The three accents Jag dropped on 2026-10-19, as the tokens had them (their
// marks only): each read as a status colour somewhere.
const DROPPED = `
.jh-ui[data-accent='blue'] {
  --jh-accent: oklch(0.53 0.19 255); --jh-accent-hover: oklch(0.49 0.18 255);
  --jh-accent-text: oklch(0.8 0.1 255); --jh-focus-ring: oklch(0.64 0.17 255);
  --jh-meter: oklch(0.7 0.13 255);
}
.jh-ui[data-theme='light'][data-accent='blue'] {
  --jh-accent: oklch(0.53 0.19 255); --jh-accent-hover: oklch(0.49 0.18 255);
  --jh-accent-text: oklch(0.47 0.17 255); --jh-focus-ring: oklch(0.53 0.19 255);
  --jh-meter: oklch(0.57 0.17 255);
}
.jh-ui[data-accent='indigo'] {
  --jh-accent: oklch(0.52 0.22 270); --jh-accent-hover: oklch(0.555 0.21 270);
  --jh-accent-text: oklch(0.79 0.11 270); --jh-focus-ring: oklch(0.62 0.2 270);
  --jh-meter: oklch(0.68 0.15 270);
}
.jh-ui[data-theme='light'][data-accent='indigo'] {
  --jh-accent: oklch(0.52 0.22 270); --jh-accent-hover: oklch(0.48 0.21 270);
  --jh-accent-text: oklch(0.47 0.2 270); --jh-focus-ring: oklch(0.52 0.22 270);
  --jh-meter: oklch(0.56 0.19 270);
}
.jh-ui[data-accent='graphite'] {
  --jh-accent: oklch(0.5 0.025 286); --jh-accent-hover: oklch(0.545 0.025 286);
  --jh-accent-text: oklch(0.85 0.02 286); --jh-focus-ring: oklch(0.75 0.02 286);
  --jh-meter: oklch(0.72 0.02 286);
}
.jh-ui[data-theme='light'][data-accent='graphite'] {
  --jh-accent: oklch(0.38 0.02 286); --jh-accent-hover: oklch(0.32 0.02 286);
  --jh-accent-text: oklch(0.35 0.02 286); --jh-focus-ring: oklch(0.38 0.02 286);
  --jh-meter: oklch(0.5 0.02 286);
}
`;

test('OKLCH converts to sRGB as CSS Color 4 does', () => {
  // CSS Color 4's own examples: sRGB red and green in OKLCH.
  const red = oklchToSrgb([0.62796, 0.25768, 29.2339]);
  [1, 0, 0].forEach((x, i) => near(red[i], x, 1e-4, `red[${i}]`));
  const green = oklchToSrgb([0.51975, 0.17686, 142.495]);
  [0, 128 / 255, 0].forEach((x, i) => near(green[i], x, 1e-4, `green[${i}]`));
  assert.deepEqual(
    oklchToSrgb([1, 0, 0]).map((x) => +x.toFixed(9)),
    [1, 1, 1]
  );
  assert.deepEqual(
    oklchToSrgb([0, 0, 0]).map((x) => +x.toFixed(9)),
    [0, 0, 0]
  );
  // and back: #7c3aed is Tailwind v3's violet-600, the spec's "≈ #7c3aed".
  const { lch } = parseColor('#7c3aed');
  oklchToSrgb(lch).forEach((x, i) => near(x * 255, [0x7c, 0x3a, 0xed][i], 1e-6, `#7c3aed[${i}]`));
});

test('colours outside sRGB are brought in by clipping and by CSS gamut mapping', () => {
  const vivid = [0.7, 0.35, 145]; // a green only wide-gamut screens show
  assert.equal(inGamut(oklchToSrgb(vivid)), false);
  const clipped = toSrgb(vivid, 'clip');
  const mapped = toSrgb(vivid, 'map');
  assert.ok(inGamut(clipped) && inGamut(mapped));
  assert.notDeepEqual(clipped, mapped, 'mapping reduces chroma rather than clipping');
  // Mapping keeps the lightness (to within the JND) where clipping lets it drift.
  const L = (rgb) =>
    parseColor(
      `#${rgb
        .map((x) =>
          Math.round(x * 255)
            .toString(16)
            .padStart(2, '0')
        )
        .join('')}`
    ).lch[0];
  near(L(mapped), 0.7, 0.03, 'mapped lightness');
  // A colour already in sRGB is left alone.
  assert.deepEqual(toSrgb([0.6, 0.1, 200], 'map'), oklchToSrgb([0.6, 0.1, 200]));
});

test('Display P3 screens are checked too, where an out-of-sRGB colour shows at its true value', () => {
  // CSS Color 4: sRGB red is color(display-p3 0.9175 0.2003 0.1386); white is white.
  const red = oklchToP3([0.62796, 0.25768, 29.2339]);
  [0.9175, 0.2003, 0.1386].forEach((x, i) => near(red[i], x, 1e-4, `red in P3 [${i}]`));
  oklchToP3([1, 0, 0]).forEach((x, i) => near(x, 1, 1e-9, `white in P3 [${i}]`));
  // P3's luminance is its own Y row: P3 green is brighter than sRGB green's 0.7152.
  near(luminance([1, 1, 1], 'p3'), 1, 1e-9, 'P3 white');
  near(luminance([0, 1, 0], 'p3'), 0.69174, 1e-5, 'P3 green');

  // The mock's dark violet hover is inside P3 but outside sRGB. Clipping darkens
  // it on an sRGB screen (4.50:1); a P3 screen shows its true colour (4.37:1).
  const hover = [0.585, 0.27, 293];
  assert.equal(inGamut(oklchToSrgb(hover)), false);
  assert.equal(inGamut(oklchToP3(hover)), true);
  const props = {
    '--jh-on-accent': 'oklch(0.969 0.016 293.756)',
    '--jh-accent-hover': 'oklch(0.585 0.27 293)',
  };
  const { srgb, p3 } = screenContrasts(props, { fg: 'on-accent', bg: 'accent-hover' });
  near(srgb, 4.5003, 1e-4, 'sRGB');
  near(p3, 4.37, 0.005, 'P3');
  assert.equal(pairContrast(props, { fg: 'on-accent', bg: 'accent-hover' }), p3);

  // So the check fails it, on P3 alone, and says so.
  const bad = `${TOKENS}\n.jh-ui { --jh-accent-hover: oklch(0.585 0.27 293); }\n`;
  const { failures } = checkContrast(bad);
  assert.deepEqual(
    failures.map(describe),
    ['on-accent on accent-hover (dark, violet): sRGB 4.50:1, P3 4.37:1, needs 4.5:1'],
    'only the P3 rendering is below 4.5:1'
  );
});

test('contrast is WCAG 2 contrast, and translucent colours are painted over their surface', () => {
  near(contrast([1, 1, 1], [0, 0, 0]), 21, 1e-9, 'white on black');
  const grey = (hex) => [hex / 255, hex / 255, hex / 255];
  near(contrast(grey(0x76), [1, 1, 1]), 4.54, 0.005, '#767676 on white'); // the lightest AA grey
  near(contrast(grey(0x77), [1, 1, 1]), 4.48, 0.005, '#777777 on white');
  assert.deepEqual(composite([1, 1, 1], 0.5, [0, 0, 0]), [0.5, 0.5, 0.5]);
  assert.deepEqual(parseColor('oklch(54.1% 70.25% 293.009 / 50%)'), {
    lch: [0.541, 0.281, 293.009],
    alpha: 0.5,
  });
  assert.throws(() => parseColor('rgb(0 0 0)'), /unsupported colour/);
});

test('the floors are the spec’s (§5.2), and WCAG 1.4.11’s 3:1 for a chart’s slots', () => {
  assert.deepEqual(RULES, {
    'text-1': 7,
    'text-2': 4.5,
    'text-3': 4.5,
    'accent-text': 4.5,
    'on-accent': 4.5,
    'status-fg': 4.5,
    'on-solid': 4.5,
    'focus-ring': 3,
    'control-edge': 3,
    series: 3,
  });
  for (const rule of Object.keys(RULES)) {
    assert.ok(
      PAIRINGS.some((p) => p.rule === rule),
      `no pairing checks ${rule}`
    );
  }
  for (const s of STATUSES) {
    assert.ok(
      PAIRINGS.some((p) => p.fg === `${s}-fg`),
      `${s}-fg is not checked`
    );
    assert.ok(
      PAIRINGS.some((p) => p.fg === `${s}-on-solid`),
      `${s}-on-solid is not checked`
    );
    // Status words sit in hovered and selected rows (the mock's attention rows).
    for (const bg of ['row-hover', 'accent-tint']) {
      for (const base of ['bg', 'surface-1']) {
        assert.ok(
          PAIRINGS.some((p) => p.fg === `${s}-fg` && p.bg === bg && p.over === base),
          `${s}-fg on ${bg} over ${base} is not checked`
        );
      }
    }
  }
});

test('every declared pairing meets its floor, in both themes and every accent, on sRGB and P3', () => {
  const { results, failures } = checkContrast(TOKENS);
  assert.equal(results.length, PAIRINGS.length * THEMES.length * ACCENTS.length);
  for (const r of results) {
    assert.ok(Number.isFinite(r.srgb) && Number.isFinite(r.p3), describe(r));
    assert.equal(r.ratio, Math.min(r.srgb, r.p3));
  }
  assert.deepEqual(
    failures.map(describe),
    [],
    'these pairings are below their floor (docs/design-system.md):'
  );
});

test('pairings ruled out by name are never declared, and still fail somewhere', () => {
  const same = (a, b) => a.fg === b.fg && a.bg === b.bg && (a.over ?? '') === (b.over ?? '');
  const ruledOut = checkRuledOut(TOKENS);
  assert.equal(ruledOut.length, FORBIDDEN.length);
  for (const [i, f] of FORBIDDEN.entries()) {
    assert.ok(!PAIRINGS.some((p) => same(p, f)), `${f.fg} ${f.where} is declared`);
    assert.throws(() => checkContrast(TOKENS, [...PAIRINGS, f]), /ruled out/);
    // If tokens change so it passes everywhere, declare it instead of forbidding it.
    assert.equal(ruledOut[i].pass, false, `${describe(ruledOut[i])}: passes, declare it`);
  }
  // The selected item in a popover or menu (review of #387): 4.29:1 at worst,
  // light violet (4.21:1 with the dropped Graphite accent).
  const menu = ruledOut[FORBIDDEN.findIndex((f) => f.over === 'surface-2')];
  near(menu.ratio, 4.29, 0.01, 'text-3 on accent-tint over surface-2');
  assert.deepEqual([menu.theme, menu.accent], ['light', 'violet']);
});

test('every accent’s hover differs visibly from its rest state', () => {
  assert.equal(HOVER_MIN_DE, 0.02, "CSS Color 4's just-noticeable difference");
  const { results, failures } = checkHover(TOKENS);
  assert.equal(results.length, THEMES.length * ACCENTS.length);
  assert.deepEqual(
    failures.map((f) => `${f.theme} ${f.accent}: ΔE OK ${f.de.toFixed(3)}`),
    [],
    'these hovers are too close to their rest state:'
  );
  // A hover a hair off its rest state is a hover nobody can see.
  const faint = `${TOKENS}\n.jh-ui[data-accent='fuchsia'] { --jh-accent-hover: oklch(0.57 0.225 328); }\n`;
  assert.deepEqual(
    checkHover(faint).failures.map((f) => `${f.theme} ${f.accent}`),
    ['dark fuchsia']
  );
});

test('no accent reads as a status colour: ΔE OK ≥ 0.05 from every lamp, bar and word, in both themes, on sRGB and P3', () => {
  assert.equal(STATUS_MIN_DE, 0.05);
  // Every mark an accent paints, against every status's lamp or bar and word.
  assert.deepEqual(ACCENT_MARKS, ['accent', 'accent-hover', 'accent-text', 'meter', 'focus-ring']);
  assert.deepEqual(
    STATUS_MARKS,
    STATUSES.flatMap((s) => [`${s}-solid`, `${s}-fg`])
  );
  const status = checkAccentStatus(TOKENS);
  assert.equal(
    status.results.length,
    ACCENTS.length * THEMES.length * ACCENT_MARKS.length * STATUS_MARKS.length
  );
  assert.deepEqual(
    status.failures.map(
      (f) => `${f.mark} vs ${f.status} (${f.theme}, ${f.accent}): ${f.de.toFixed(3)}`
    ),
    [],
    'these accent colours read as a status colour (docs/design-system.md, rule 2):'
  );
  // The nearest calls, as Jag saw them on 2026-10-19.
  const nearest = Object.fromEntries(
    nearestStatus(status).map((n) => [`${n.accent} ${n.theme}`, +n.de.toFixed(3)])
  );
  assert.deepEqual(nearest, {
    'violet dark': 0.103,
    'violet light': 0.129,
    'fuchsia dark': 0.124,
    'fuchsia light': 0.196,
    'cyan dark': 0.095,
    'cyan light': 0.064,
  });
});

test('the status rule catches the accents it dropped: Blue, Indigo and Graphite', () => {
  const dropped = ['blue', 'indigo', 'graphite'];
  const { failures } = checkAccentStatus(`${TOKENS}\n${DROPPED}`, dropped);
  const failing = new Set(failures.map((f) => `${f.accent} ${f.theme}`));
  // Blue sits on maintenance in both themes; Indigo nearly does in light;
  // Graphite's meter is the "no signal" grey.
  assert.deepEqual([...failing].sort(), [
    'blue dark',
    'blue light',
    'graphite dark',
    'graphite light',
    'indigo light',
  ]);
  const worst = (accent, theme) =>
    failures
      .filter((f) => f.accent === accent && f.theme === theme)
      .reduce((a, b) => (b.de < a.de ? b : a));
  const show = (f) => `${f.mark} vs ${f.status} ${f.de.toFixed(3)}`;
  assert.equal(show(worst('blue', 'dark')), 'meter vs maintenance-solid 0.029');
  assert.equal(show(worst('blue', 'light')), 'accent-hover vs maintenance-fg 0.021');
  assert.equal(show(worst('indigo', 'light')), 'meter vs maintenance-solid 0.037');
  assert.equal(show(worst('graphite', 'dark')), 'meter vs unknown-solid 0.018');
  // And none of them is offered again.
  for (const accent of dropped) {
    assert.ok(!ACCENTS.includes(accent), `${accent} is offered again`);
  }
});

test('the check fails on a deliberately bad pairing', async (t) => {
  await t.test('a light-theme text-2 too pale for 4.5:1 fails in light, with every accent', () => {
    const bad = `${TOKENS}\n.jh-ui[data-theme='light'] { --jh-text-2: oklch(0.7 0.012 286); }\n`;
    const { failures } = checkContrast(bad);
    assert.ok(failures.length > 0);
    assert.ok(failures.every((f) => f.rule === 'text-2' && f.theme === 'light'));
    assert.deepEqual([...new Set(failures.map((f) => f.accent))].sort(), [...ACCENTS].sort());
  });

  await t.test('an accent too light for its label fails for that accent only', () => {
    const bad = `${TOKENS}\n.jh-ui[data-accent='cyan'] { --jh-accent: oklch(0.72 0.1 215); }\n`;
    const { failures } = checkContrast(bad);
    assert.ok(failures.some((f) => f.fg === 'on-accent' && f.bg === 'accent'));
    assert.ok(
      failures.every((f) => f.accent === 'cyan' && f.theme === 'dark'),
      failures.map(describe).join('\n')
    );
  });

  await t.test('the floor is the line: #767676 on white passes 4.5:1 and fails 7:1', () => {
    const css = '.jh-ui { --jh-bg: #ffffff; --jh-text-2: #767676; --jh-text-1: #767676; }';
    const pairs = [
      { rule: 'text-2', fg: 'text-2', bg: 'bg' },
      { rule: 'text-1', fg: 'text-1', bg: 'bg' },
    ];
    const { failures } = checkContrast(css, pairs);
    assert.deepEqual([...new Set(failures.map((f) => f.rule))], ['text-1']);
  });

  await t.test('the floor is compared unrounded: 4.4999:1 fails, though it rounds to 4.50', () => {
    const pair = [{ rule: 'text-2', fg: 'text-2', bg: 'bg' }];
    const css = (l) => `.jh-ui { --jh-bg: oklch(1 0 0); --jh-text-2: oklch(${l} 0 0); }`;
    const ratioAt = (l) => checkContrast(css(l), pair).results[0].ratio;
    // The grey whose ratio on white is just above `target` (ratio falls as L rises).
    const greyAt = (target) => {
      let [lo, hi] = [0.5, 0.7];
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        if (ratioAt(mid) > target) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    const under = checkContrast(css(greyAt(4.4999)), pair);
    const [r] = under.results;
    assert.ok(r.ratio < 4.5 && r.ratio.toFixed(2) === '4.50', `set-up: ${r.ratio}`);
    assert.equal(under.failures.length, under.results.length, 'just under the floor fails');
    // ...and the report never rounds a miss up to the floor it missed.
    assert.match(describe(r), /sRGB 4\.49:1/);
    const over = checkContrast(css(greyAt(4.5001)), pair);
    assert.ok(over.results[0].ratio >= 4.5);
    assert.equal(over.failures.length, 0, 'just over the floor passes');
  });

  await t.test('the script exits non-zero and names the pairing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'jh-contrast-'));
    try {
      const file = path.join(dir, 'tokens.css');
      writeFileSync(file, `${TOKENS}\n.jh-ui { --jh-crit-on-solid: var(--jh-white); }\n`);
      const bad = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
      assert.equal(bad.status, 1, bad.stderr);
      assert.match(bad.stdout, /FAIL crit-on-solid on crit-solid \(dark, violet\)/);
      const faint = path.join(dir, 'faint.css');
      writeFileSync(
        faint,
        `${TOKENS}\n.jh-ui[data-accent='fuchsia'] { --jh-accent-hover: oklch(0.57 0.22 328); }\n`
      );
      const hover = spawnSync(process.execPath, [SCRIPT, faint], { encoding: 'utf8' });
      assert.equal(hover.status, 1, hover.stderr);
      assert.match(hover.stdout, /FAIL accent-hover vs accent \(dark, fuchsia\)/);
      // A Cyan meter in the "no signal" steel reads as a status.
      const steel = path.join(dir, 'steel.css');
      writeFileSync(
        steel,
        `${TOKENS}\n.jh-ui[data-accent='cyan'] { --jh-meter: oklch(0.72 0.03 250); }\n`
      );
      const status = spawnSync(process.execPath, [SCRIPT, steel], { encoding: 'utf8' });
      assert.equal(status.status, 1, status.stderr);
      assert.match(status.stdout, /FAIL meter vs unknown-solid \(dark, cyan\): ΔE OK 0\.000/);
      const good = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
      assert.equal(good.status, 0, good.stdout + good.stderr);
      assert.match(good.stdout, /0 below their floor/);
      assert.match(good.stdout, /0 too close\.\n[\s\S]*Accent against status[^\n]*0 too close/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('the tokens are read the way CSS cascades them', () => {
  const { rules } = readTokens(TOKENS);
  const dark = resolveContext(rules, {});
  const lightCyan = resolveContext(rules, { theme: 'light', accent: 'cyan' });
  assert.equal(dark['--jh-accent'], 'var(--jh-violet-541)');
  // The light-and-cyan block (most specific) wins over both the light and cyan blocks.
  assert.equal(lightCyan['--jh-accent-text'], 'oklch(0.48 0.083 215)');
  assert.equal(lightCyan['--jh-text-1'], 'var(--jh-graphite-205)');
  // A token that names another resolves through it, in the context's own values.
  assert.equal(dark['--jh-lamp-cut'], 'var(--jh-surface-1)');
  near(
    pairContrast(resolveContext(rules, { theme: 'light' }), { fg: 'lamp-cut', bg: 'surface-1' }),
    1,
    1e-9,
    'lamp-cut is surface-1 in light'
  );
});

test('the reader refuses what it cannot follow, rather than skipping it', () => {
  for (const css of [
    ':root { --jh-bg: #000; }',
    '.jh-ui .panel { --jh-bg: #000; }',
    "[data-theme='light'] .jh-ui { --jh-bg: #000; }",
    '.jh-ui[data-theme=light] { --jh-bg: #000; }',
    '@supports (color: oklch(0 0 0)) { .jh-ui { --jh-bg: #000; } }',
  ]) {
    assert.throws(() => readTokens(css), /token (selector|rule)/, css);
  }
  const props = {
    '--jh-a': 'var(--jh-b)',
    '--jh-b': 'var(--jh-a)',
    '--jh-t': 'oklch(1 0 0 / 0.5)',
  };
  assert.throws(() => pairContrast(props, { fg: 'a', bg: 't' }), /cycle|translucent/);
  assert.throws(() => pairContrast(props, { fg: 'missing', bg: 'b' }), /cycle|not declared/);
  assert.throws(
    () => pairContrast({ ...props, '--jh-w': '#fff' }, { fg: 'w', bg: 't' }),
    /translucent/
  );
});
