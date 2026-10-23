// The accents Settings → Appearance offers (#321) can't break readability or
// read as a status: the set is src/ui/accents.js's, which the section lists
// (src/components/settings/sections/accentSet.js) and the contrast check
// (scripts/ui-contrast.mjs, P0-2) checks. Here, for every accent in the set,
// in both themes: the script itself passes; each of the accent's uses (the
// primary button, a link, a selected row, the focus ring, a meter) meets its
// floor; each of its colours clears every status lamp and word by ΔE OK
// 0.05; and the hue the section maps an old colour by is tokens.css's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACCENTS as CHECKED,
  ACCENT_MARKS,
  STATUS_MARKS,
  STATUS_MIN_DE,
  THEMES,
  TOKENS_FILE,
  checkAccentStatus,
  checkContrast,
  oklchToOklab,
  readTokens,
  resolveContext,
  tokenColor,
} from './ui-contrast.mjs';
import { ACCENT_SET } from '../src/components/settings/sections/accentSet.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS = readFileSync(TOKENS_FILE, 'utf8');
const OFFERED = ACCENT_SET.map((a) => a.id);

test('the set Settings offers is the set the check checks, Violet first', () => {
  assert.deepEqual(OFFERED, CHECKED);
  assert.deepEqual(OFFERED, ['violet', 'fuchsia', 'cyan']);
});

test('the contrast script passes, naming each accent offered in both themes', () => {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts/ui-contrast.mjs')], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /0 below their floor/);
  assert.match(
    run.stdout,
    /Accent against status, nearest per accent \(needs ΔE OK 0\.05\): 0 too close/
  );
  for (const accent of OFFERED)
    for (const theme of THEMES)
      assert.match(run.stdout, new RegExp(`- ${accent}, ${theme}: 0\\.\\d+`));
  assert.match(run.stdout, /\| meter \| 3:1 \|/);
});

// What each use paints, as the check's pairings name it.
const USES = {
  button: (p) => p.rule === 'on-accent',
  link: (p) => p.fg === 'accent-text' && p.over == null,
  'selected row': (p) => p.bg === 'accent-tint',
  'focus ring': (p) => p.rule === 'focus-ring',
  meter: (p) => p.rule === 'meter',
};

test('every use of every accent meets its floor in both themes, on sRGB and P3', () => {
  const { results } = checkContrast(TOKENS);
  for (const accent of OFFERED) {
    for (const theme of THEMES) {
      const mine = results.filter((r) => r.accent === accent && r.theme === theme);
      for (const [use, isUse] of Object.entries(USES)) {
        const checked = mine.filter(isUse);
        assert.ok(checked.length > 0, `${accent} ${theme}: no ${use} is checked`);
        const below = checked.filter((r) => !r.pass);
        assert.deepEqual(
          below.map(
            (r) => `${r.fg} on ${r.bg}${r.over ? ` over ${r.over}` : ''}: ${r.ratio.toFixed(2)}`
          ),
          [],
          `${accent} ${theme}: its ${use} is below its floor`
        );
      }
    }
  }
});

test('no accent offered reads as a status: each colour it paints clears every lamp and word', () => {
  for (const accent of OFFERED) {
    const { results, failures } = checkAccentStatus(TOKENS, [accent]);
    assert.equal(results.length, THEMES.length * ACCENT_MARKS.length * STATUS_MARKS.length);
    assert.deepEqual(failures, [], `${accent} reads as a status colour`);
    assert.ok(results.every((r) => r.de >= STATUS_MIN_DE));
  }
});

test('the hue an old colour is mapped by is each accent’s, in tokens.css, in both themes', () => {
  const { rules } = readTokens(TOKENS);
  for (const { id, hue } of ACCENT_SET) {
    for (const theme of THEMES) {
      const props = resolveContext(rules, { theme, accent: id });
      for (const mark of ['accent', 'accent-text', 'meter', 'focus-ring']) {
        const [, a, b] = oklchToOklab(tokenColor(props, mark).lch);
        const actual = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
        assert.ok(Math.abs(actual - hue) < 1, `${id} ${theme} ${mark}: hue ${actual}, not ${hue}`);
      }
    }
  }
});
