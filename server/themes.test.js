// Custom themes as validated data (#331): the schema, the contrast rules named
// on failure, hostile input, the list and the save check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEME_BASES } from './themeBases.js';
import { STATUS_APART_MIN_DE, statusDistances } from './uiContrast.js';
import {
  ACCENT_ROLE_NAMES,
  MAX_THEMES,
  THEME_TOKENS,
  parseThemeColor,
  themeVars,
  themesSaveError,
  validateTheme,
  validateThemes,
} from './themes.js';

const MIDNIGHT = JSON.parse(
  readFileSync(new URL('../docs/examples/midnight-theme.json', import.meta.url), 'utf8')
);
/** The example with `tokens` laid over its own. */
const midnight = (tokens = {}, rest = {}) => ({
  ...MIDNIGHT,
  ...rest,
  tokens: { ...MIDNIGHT.tokens, ...tokens },
});
const reasonsOf = (theme) => {
  const r = validateTheme(theme);
  assert.equal(r.ok, false, 'expected a rejection');
  return r.reasons;
};

test('the example theme in the docs loads, with its colours written again', () => {
  const r = validateTheme(MIDNIGHT);
  assert.equal(r.ok, true, r.ok ? '' : r.reasons.join('\n'));
  assert.equal(r.theme.id, 'midnight');
  assert.equal(r.theme.base, 'dark');
  assert.equal(r.theme.setsAccent, false);
  assert.equal(r.theme.tokens['text-2'], 'oklch(0.78 0.02 255)');
});

test('a theme of hex colours loads, shorthand and capitals written as #rrggbb', () => {
  const r = validateTheme({
    id: 'paper',
    name: 'Paper',
    base: 'light',
    tokens: { bg: '#FAFAFB', 'surface-1': '#fff' },
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reasons.join('\n'));
  assert.deepEqual(r.theme.tokens, { bg: '#fafafb', 'surface-1': '#ffffff' });
});

test('a theme that fails is rejected with the pairing, its ratio and its floor named', () => {
  // The card's example: text-2 on surface-1 at 3.x:1.
  const reasons = reasonsOf(midnight({ 'text-2': 'oklch(0.52 0.02 255)' }));
  assert.ok(
    reasons.some((r) => /^text-2 on surface-1: 3\.\d\d:1, needs 4\.5:1$/.test(r)),
    reasons.join('\n')
  );
});

test('each contrast rule names its pairing when a theme breaks it', () => {
  const grey = (l) => `oklch(${l} 0 0)`;
  const cases = [
    // [rule, tokens, the pairing named, the floor]
    ['text-1', { 'text-1': grey(0.6) }, 'text-1 on bg', 7],
    ['text-2', { 'text-2': grey(0.45) }, 'text-2 on surface-1', 4.5],
    ['text-3', { 'text-3': grey(0.45) }, 'text-3 on surface-1', 4.5],
    ['accent-text', { 'accent-text': grey(0.3) }, 'accent-text on surface-1', 4.5],
    ['on-accent', { 'on-accent': 'oklch(0.541 0.281 293)' }, 'on-accent on accent', 4.5],
    ['status-fg', { 'ok-fg': grey(0.3) }, 'ok-fg on surface-1', 4.5],
    ['on-solid', { 'ok-on-solid': 'oklch(0.765 0.177 163)' }, 'ok-on-solid on ok-solid', 4.5],
    ['focus-ring', { 'focus-ring': grey(0.2) }, 'focus-ring on bg', 3],
    ['control-edge', { 'control-edge': grey(0.2) }, 'control-edge on surface-1', 3],
    ['series', { 'series-1': grey(0.2) }, 'series-1 on surface-1', 3],
    ['meter', { meter: grey(0.2) }, 'meter on track over surface-1', 3],
  ];
  for (const [rule, tokens, pairing, floor] of cases) {
    // Setting an accent role brings its own accent; the rules still apply.
    const reasons = reasonsOf(midnight(tokens));
    const line = reasons.find((r) => r.startsWith(`${pairing}:`));
    assert.ok(line, `${rule}: no reason names "${pairing}":\n${reasons.join('\n')}`);
    assert.match(line, new RegExp(`^${pairing}: \\d\\.\\d\\d:1, needs ${floor}:1`));
  }
});

test('an accent that does not stand out from its rest state, or reads as a status, is rejected', () => {
  const hover = reasonsOf(
    midnight({ accent: 'oklch(0.54 0.28 293)', 'accent-hover': 'oklch(0.541 0.281 293)' })
  );
  assert.ok(
    hover.some((r) => /^accent-hover is too close to accent: ΔE 0\.\d+, needs 0\.02/.test(r))
  );
  const status = reasonsOf(
    midnight({ accent: 'oklch(0.765 0.177 163)', 'accent-hover': 'oklch(0.7 0.17 163)' })
  );
  assert.ok(
    status.some((r) => /^accent reads as ok-solid: ΔE/.test(r)),
    status.join('\n')
  );
});

test('a colour that fails only under another accent says which', () => {
  // Reasons carry the accent when the failure is not the default one's.
  const all = [];
  for (let l = 0.3; l <= 0.5; l += 0.01) {
    const r = validateTheme(midnight({ 'text-2': `oklch(${l.toFixed(2)} 0.02 255)` }));
    if (!r.ok) all.push(...r.reasons);
  }
  assert.ok(all.some((r) => / with the (fuchsia|cyan) accent$/.test(r)));
});

test('a theme that sets an accent role brings its own: it is checked once, with the default accent', () => {
  const r = validateTheme(
    midnight({
      accent: 'oklch(0.55 0.2 330)',
      'accent-hover': 'oklch(0.5 0.2 330)',
      'accent-text': 'oklch(0.8 0.12 330)',
      'accent-tint': 'oklch(0.55 0.2 330 / 0.16)',
      'accent-border': 'oklch(0.6 0.2 330 / 0.38)',
      'focus-ring': 'oklch(0.64 0.2 330)',
      'row-hover': 'oklch(0.55 0.2 330 / 0.07)',
      meter: 'oklch(0.7 0.16 330)',
    })
  );
  assert.equal(r.ok, true, r.ok ? '' : r.reasons.join('\n'));
  assert.equal(r.theme.setsAccent, true);
  assert.ok(ACCENT_ROLE_NAMES.includes('accent'));
});

test('a translucent surface or word is rejected, not scored', () => {
  const reasons = reasonsOf(midnight({ 'surface-1': 'oklch(0.2 0.02 255 / 0.5)' }));
  assert.ok(
    reasons.some((r) => /translucent|opaque/.test(r)),
    reasons.join('\n')
  );
});

test('the schema: keys, ids, names, bases and tokens are all checked', () => {
  const cases = [
    [null, /object/],
    [[], /object/],
    [midnight({}, { extra: 1 }), /Unknown key "extra"/],
    [midnight({}, { id: 'Has Caps' }), /id must be/],
    [midnight({}, { id: '' }), /id must be/],
    [midnight({}, { id: 'a'.repeat(33) }), /id must be/],
    [midnight({}, { name: '' }), /name must be/],
    [midnight({}, { name: 'x'.repeat(41) }), /name must be/],
    [midnight({}, { name: 'two\nlines' }), /name must be/],
    [midnight({}, { base: 'blue' }), /base must be/],
    [midnight({}, { base: undefined }), /base must be/],
    [{ ...MIDNIGHT, tokens: null }, /tokens must be an object/],
    [{ ...MIDNIGHT, tokens: [] }, /tokens must be an object/],
    [{ ...MIDNIGHT, tokens: {} }, /tokens is empty/],
    [midnight({ 'not-a-token': '#fff' }), /Unknown token "not-a-token"/],
    [midnight({ 'seq-3': '#fff' }), /Unknown token "seq-3"/],
    [midnight({ bg: 5 }), /bg is not a string/],
    [midnight({ bg: 'red' }), /bg is not a colour/],
  ];
  for (const [theme, why] of cases) {
    const r = validateTheme(theme);
    assert.equal(r.ok, false, JSON.stringify(theme));
    assert.match(r.reasons.join('\n'), why);
  }
});

test('too many colours in one theme is rejected before any is scored', () => {
  const tokens = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, '#fff']));
  const reasons = reasonsOf({ ...MIDNIGHT, tokens });
  assert.ok(reasons.some((r) => /more than 120/.test(r)));
});

const HOSTILE_COLOURS = [
  'red; background: url(https://evil.example/x.png)',
  'oklch(0.5 0.1 100); } body { display: none',
  'oklch(0.5 0.1 100)}',
  'oklch(0.5 0.1 100) /* c */',
  '#fff;}',
  '#fff\n}',
  'url(javascript:alert(1))',
  'url("data:text/html,x")',
  'expression(alert(1))',
  'var(--jh-bg)',
  'calc(1 + 2)',
  'oklch(from red l c h)',
  'oklch(0.5 0.1 100 / var(--x))',
  'oklch(0.5 0.1 100 !important)',
  'oklch(0.5 0.1 100)\u0000',
  'oklch(0.5 0.1 100);\\',
  '\\6f klch(0.5 0.1 100)',
  'oklch(1e2 0.1 100)',
  'oklch(-0.5 0.1 100)',
  'oklch(0.5 0.9 100)',
  'oklch(0.5 0.1 900)',
  'oklch(0.5 0.1 100 / 3)',
  'oklch(2 0.1 100)',
  '#ggg',
  '#12345',
  '#12345678',
  '',
  ' ',
  'x'.repeat(10_000),
  `oklch(0.5 0.1 100)${' '.repeat(100)}`,
  null,
  undefined,
  {},
  ['#fff'],
  1,
  true,
];

test('hostile colour values are all rejected', () => {
  for (const bad of HOSTILE_COLOURS) {
    assert.equal(parseThemeColor(bad).ok, false, `accepted ${JSON.stringify(bad)?.slice(0, 60)}`);
    assert.equal(validateTheme(midnight({ bg: bad })).ok, false);
  }
});

test('hostile token names, ids and names are rejected', () => {
  const names = [
    '__proto__',
    'constructor',
    'prototype',
    'toString',
    '--jh-bg',
    'bg;color',
    'bg}',
    'bg\n',
    'BG',
    ' bg',
    '',
    'x'.repeat(5000),
  ];
  for (const name of names) {
    const tokens = JSON.parse(
      `{${JSON.stringify(name)}: "#fff", "text-1": "oklch(0.975 0.006 255)"}`
    );
    const r = validateTheme({ ...MIDNIGHT, tokens });
    assert.equal(r.ok, false, `accepted token ${JSON.stringify(name).slice(0, 40)}`);
  }
  for (const id of ['a"b', 'a b', 'a;b', '../x', 'a/b', 'a\nb', '__proto__', '-a', 'A']) {
    assert.equal(validateTheme({ ...MIDNIGHT, id }).ok, false, id);
  }
  // A key that can poison a prototype is no token, and nothing is polluted.
  validateTheme(
    JSON.parse('{"id":"a","name":"A","base":"dark","tokens":{"__proto__":{"bg":"#fff"}}}')
  );
  assert.equal(/** @type {any} */ ({}).bg, undefined);
});

test('what a loading theme applies is only digits, a hash, oklch( and punctuation, whatever was written', () => {
  const r = validateTheme(
    midnight({
      bg: '  OKLCH( 15%  0.02   255deg / 100% ) ',
      'surface-2': 'oklch(0.235000 0.026000 255.0)',
      'text-1': '#F8F8FA',
    })
  );
  assert.equal(r.ok, true, r.ok ? '' : r.reasons.join('\n'));
  const vars = themeVars(r.theme.tokens);
  for (const [name, value] of Object.entries(vars)) {
    assert.match(name, /^--jh-[a-z0-9-]+$/);
    assert.match(value, /^(#[0-9a-f]{6}|oklch\([\d. ]+(?: \/ [\d.]+)?\))$/, `${name}: ${value}`);
  }
  assert.equal(vars['--jh-bg'], 'oklch(0.15 0.02 255)');
  assert.equal(vars['--jh-text-1'], '#f8f8fa');
});

test('every token a theme may set is a known role, none of the palette', () => {
  assert.ok(THEME_TOKENS.includes('surface-1') && THEME_TOKENS.includes('ok-fg'));
  for (const name of THEME_TOKENS) assert.doesNotMatch(name, /^(graphite|violet|blue)-\d|^seq-/);
});

test('validateThemes lists those that load and those rejected, by place in the list', () => {
  const list = [
    MIDNIGHT,
    midnight({ 'text-2': 'oklch(0.4 0 0)' }, { id: 'dim', name: 'Dim' }),
    { id: 'broken' },
    'not a theme',
    midnight({}, { id: 'midnight', name: 'Again' }),
  ];
  const { valid, rejected } = validateThemes(list);
  assert.deepEqual(
    valid.map((t) => t.id),
    ['midnight']
  );
  assert.deepEqual(
    rejected.map((r) => r.index),
    [1, 2, 3, 4]
  );
  assert.equal(rejected[0].id, 'dim');
  assert.match(rejected[0].reasons[0], /^text-2 on /);
  assert.match(rejected[3].reasons[0], /already used/);
  assert.deepEqual(validateThemes(undefined), { valid: [], rejected: [] });
  assert.deepEqual(validateThemes('x'), { valid: [], rejected: [] });
});

test(`themes past ${MAX_THEMES} are rejected as over the limit`, () => {
  const list = Array.from({ length: MAX_THEMES + 2 }, (_, i) =>
    midnight({}, { id: `t${i}`, name: `T${i}` })
  );
  const { valid, rejected } = validateThemes(list);
  assert.equal(valid.length, MAX_THEMES);
  assert.deepEqual(
    rejected.map((r) => r.index),
    [MAX_THEMES, MAX_THEMES + 1]
  );
  assert.match(rejected[0].reasons[0], /keeps 8 themes/);
});

test('a save is refused for a theme it adds or changes that fails, naming the pairing', () => {
  const bad = midnight({ 'text-2': 'oklch(0.58 0.02 255)' });
  const error = themesSaveError([bad], []);
  assert.match(
    error,
    /^Theme "Midnight" was refused: .*text-2 on surface-1: \d\.\d\d:1, needs 4\.5:1/
  );
  assert.equal(themesSaveError([MIDNIGHT], []), null);
  assert.equal(themesSaveError(undefined, [bad]), null);
  assert.match(themesSaveError('x', []), /must be a list/);
  assert.match(themesSaveError([{ id: 'x' }], []), /was refused/);
});

test('a theme already on disk is let through as it is, so a config with a bad one can still be saved', () => {
  const bad = midnight({ 'text-2': 'oklch(0.58 0.02 255)' });
  assert.equal(themesSaveError([bad], [bad]), null);
  // Changed, it must load.
  assert.ok(themesSaveError([{ ...bad, name: 'Edited' }], [bad]));
  // Removing it is a save with fewer themes.
  assert.equal(themesSaveError([], [bad]), null);
});

test('a save may not grow the list past the limit, but may keep one already over it', () => {
  const many = (n) =>
    Array.from({ length: n }, (_, i) => midnight({}, { id: `t${i}`, name: `T${i}` }));
  assert.equal(themesSaveError(many(MAX_THEMES), []), null);
  assert.match(themesSaveError(many(MAX_THEMES + 1), many(MAX_THEMES)), /Too many themes/);
  assert.equal(themesSaveError(many(MAX_THEMES + 1), many(MAX_THEMES + 1)), null);
});

test('a theme may not paint one status as another: crit and warn in ok’s colours is rejected, naming the pair', () => {
  const ok = THEME_BASES.dark;
  const tokens = {};
  for (const s of ['crit', 'warn']) {
    for (const part of ['fg', 'tint', 'border', 'solid']) tokens[`${s}-${part}`] = ok[`ok-${part}`];
  }
  const reasons = reasonsOf(midnight(tokens));
  assert.ok(
    reasons.some((r) => /^ok-solid and crit-solid are too close: ΔE 0\.00, needs 0\.05$/.test(r)),
    reasons.join('\n')
  );
  assert.ok(reasons.some((r) => /^ok-fg and warn-fg are too close/.test(r)));
  // A light theme is held to it too.
  const light = THEME_BASES.light;
  const lightTokens = {};
  for (const part of ['fg', 'solid']) lightTokens[`crit-${part}`] = light[`ok-${part}`];
  const lightReasons = reasonsOf({ id: 'l', name: 'L', base: 'light', tokens: lightTokens });
  assert.ok(lightReasons.some((r) => /^ok-solid and crit-solid are too close/.test(r)));
});

test('the built-in themes keep their statuses apart by more than the floor, and so does the example', () => {
  for (const theme of ['dark', 'light']) {
    const props = Object.fromEntries(
      Object.entries(THEME_BASES[theme]).map(([k, v]) => [`--jh-${k}`, v])
    );
    for (const { a, b, de } of statusDistances(props)) {
      assert.ok(de >= STATUS_APART_MIN_DE, `${theme}: ${a} and ${b} ${de}`);
    }
  }
  assert.equal(validateTheme(MIDNIGHT).ok, true);
});

test('a long list of problems is capped on every path, with "and N more"', () => {
  const tokens = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`nope-${i}`, '#fff']));
  const reasons = reasonsOf({ ...MIDNIGHT, tokens });
  assert.equal(reasons.length, 7);
  assert.match(reasons.at(-1), /^and \d+ more$/);
});
