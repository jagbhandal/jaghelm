// Guards the contrast of JagHelm's design tokens (src/ui/tokens.css, #283): the
// colour maths against known values, every declared pairing against its floor in
// both themes and all accents, and that the check fails on a bad pairing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCENTS,
  PAIRINGS,
  RULES,
  STATUSES,
  THEMES,
  TOKENS_FILE,
  checkContrast,
  composite,
  contrast,
  describe,
  inGamut,
  oklchToSrgb,
  pairContrast,
  parseColor,
  readTokens,
  resolveContext,
  toSrgb,
} from './ui-contrast.mjs';

const SCRIPT = fileURLToPath(new URL('./ui-contrast.mjs', import.meta.url));
const TOKENS = readFileSync(TOKENS_FILE, 'utf8');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

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

test('the floors are the spec’s (§5.2)', () => {
  assert.deepEqual(RULES, {
    'text-1': 7,
    'text-2': 4.5,
    'text-3': 4.5,
    'accent-text': 4.5,
    'on-accent': 4.5,
    'status-fg': 4.5,
    'on-solid': 4.5,
    'focus-ring': 3,
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
  }
});

test('every declared pairing meets its floor, in both themes and all five accents', () => {
  const { results, failures } = checkContrast(TOKENS);
  assert.equal(results.length, PAIRINGS.length * THEMES.length * ACCENTS.length);
  assert.deepEqual(
    failures.map(describe),
    [],
    'these pairings are below their floor (docs/design-system.md):'
  );
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
    const bad = `${TOKENS}\n.jh-ui[data-accent='indigo'] { --jh-accent: oklch(0.72 0.14 270); }\n`;
    const { failures } = checkContrast(bad);
    assert.ok(failures.some((f) => f.fg === 'on-accent' && f.bg === 'accent'));
    assert.ok(
      failures.every((f) => f.accent === 'indigo' && f.theme === 'dark'),
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

  await t.test('the script exits non-zero and names the pairing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'jh-contrast-'));
    try {
      const file = path.join(dir, 'tokens.css');
      writeFileSync(file, `${TOKENS}\n.jh-ui { --jh-crit-on-solid: var(--jh-white); }\n`);
      const bad = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });
      assert.equal(bad.status, 1, bad.stderr);
      assert.match(bad.stdout, /FAIL crit-on-solid on crit-solid \(dark, violet\)/);
      const good = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
      assert.equal(good.status, 0, good.stdout + good.stderr);
      assert.match(good.stdout, /0 below their floor/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('the tokens are read the way CSS cascades them', () => {
  const { rules } = readTokens(TOKENS);
  const dark = resolveContext(rules, {});
  const lightIndigo = resolveContext(rules, { theme: 'light', accent: 'indigo' });
  assert.equal(dark['--jh-accent'], 'var(--jh-violet-541)');
  // The light-and-indigo block (most specific) wins over both the light and indigo blocks.
  assert.equal(lightIndigo['--jh-accent-text'], 'oklch(0.47 0.2 270)');
  assert.equal(lightIndigo['--jh-text-1'], 'var(--jh-graphite-205)');
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
