// Guards the shape of JagHelm's design tokens (src/ui/tokens.css, #283) and how
// tailwind.css offers them: every token in every theme and accent, one accent
// list (src/ui/accents.js) that tokens.css, the contrast check and
// docs/design-system.md all follow, the accent values Jag signed off, roles
// (never the palette) as utilities, nothing of Tailwind's defaults, blur, text
// shadow or gradient text left to reach for (epic #333 rule 9), and no stock
// shadcn highlight (accent-foreground).
// scripts/ui-contrast.test.mjs checks their contrast.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import postcss from 'postcss';
import {
  ACCENTS,
  STATUSES,
  TOKENS_FILE,
  checkAccentStatus,
  nearestStatus,
  parseColor,
  readTokens,
  resolveContext,
  tokenColor,
} from './ui-contrast.mjs';
import { ACCENTS as ACCENT_LIST, DEFAULT_ACCENT } from '../src/ui/accents.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STACK = path.join(ROOT, 'src/ui/tailwind.css');
const DOC = path.join(ROOT, 'docs/design-system.md');
const TOKENS = readFileSync(TOKENS_FILE, 'utf8');
const { rules, media } = readTokens(TOKENS);
const base = rules.find((r) => r.selector === '.jh-ui');

// What an accent sets; on-accent is shared by every accent (the mock's).
const ACCENT_ROLES = [
  'accent',
  'accent-hover',
  'accent-text',
  'accent-tint',
  'accent-border',
  'focus-ring',
  'row-hover',
  'meter',
].map((n) => `--jh-${n}`);
const PALETTE = /^--jh-(graphite|violet|green|amber|red|steel|blue)-\d+$|^--jh-white$/;

test('the default .jh-ui block declares every token, so each switch only overrides', () => {
  const declared = new Set(Object.keys(base.decls));
  for (const r of [...rules, ...media]) {
    for (const prop of Object.keys(r.decls)) {
      assert.ok(declared.has(prop), `${prop} is set by ${r.selector} but has no default on .jh-ui`);
    }
  }
});

test('one accent list: tokens.css, the contrast check and the docs follow src/ui/accents.js', () => {
  const ids = ACCENT_LIST.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'an accent is listed twice');
  assert.equal(ids[0], DEFAULT_ACCENT, 'the default accent comes first');
  for (const a of ACCENT_LIST) assert.match(a.id, /^[a-z]+$/, `${a.id}: a data-accent value`);
  // The contrast check reads the list, so it covers every accent offered.
  assert.deepEqual(ACCENTS, ids);
  const others = ids.filter((id) => id !== DEFAULT_ACCENT);
  // tokens.css: a block per accent but the default (the next test checks them),
  // and the switch its header documents.
  const blocks = new Set(rules.filter((r) => r.attrs.accent).map((r) => r.attrs.accent));
  assert.deepEqual([...blocks].sort(), [...others].sort(), 'tokens.css data-accent blocks');
  const header = TOKENS.match(/data-accent="([a-z|]+)"/);
  assert.deepEqual(header?.[1].split('|'), others, "tokens.css header's data-accent values");
  // docs/design-system.md: the switches table, and the accents table with each
  // accent's nearest status colour as the check measures it.
  const doc = readFileSync(DOC, 'utf8');
  const sw = doc.match(/^\| `data-accent` \| (.+?) \| (\w+) \|$/m);
  assert.ok(sw, 'design-system.md has no data-accent row in its switches table');
  assert.deepEqual(
    [...sw[1].matchAll(/`([a-z]+)`/g)].map((m) => m[1]),
    others
  );
  assert.equal(sw[2], DEFAULT_ACCENT);
  const head =
    '| Accent | `data-accent` | `accent`, dark | `accent`, light | Nearest status, dark / light |';
  const lines = doc.split('\n');
  const at = lines.indexOf(head);
  assert.ok(at >= 0, `design-system.md has no accents table headed ${head}`);
  const end = lines.findIndex((l, i) => i > at && !l.startsWith('|'));
  const cells = (l) =>
    l
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
  const rows = lines.slice(at + 2, end).map(cells);
  const nearest = nearestStatus(checkAccentStatus(TOKENS));
  const de = (id, theme) => nearest.find((n) => n.accent === id && n.theme === theme).de.toFixed(3);
  assert.deepEqual(
    rows.map(([label, attr, , , dist]) => [label, attr, dist]),
    ACCENT_LIST.map(({ id, label }) => [
      id === DEFAULT_ACCENT ? `${label} (default)` : label,
      id === DEFAULT_ACCENT ? 'none' : `\`${id}\``,
      `${de(id, 'dark')} / ${de(id, 'light')}`,
    ]),
    "design-system.md's accents table"
  );
});

test('each accent sets the same roles in both themes, and the check covers every accent', () => {
  const accents = new Set(rules.filter((r) => r.attrs.accent).map((r) => r.attrs.accent));
  assert.deepEqual([...accents].sort(), ACCENTS.filter((a) => a !== DEFAULT_ACCENT).sort());
  for (const accent of accents) {
    const dark = rules.find((r) => r.attrs.accent === accent && !r.attrs.theme);
    const light = rules.find((r) => r.attrs.accent === accent && r.attrs.theme === 'light');
    assert.ok(dark && light, `${accent} needs a dark and a light block`);
    assert.deepEqual(Object.keys(dark.decls).sort(), [...ACCENT_ROLES].sort(), `${accent}, dark`);
    assert.deepEqual(Object.keys(light.decls).sort(), [...ACCENT_ROLES].sort(), `${accent}, light`);
  }
  const lightBlock = rules.find((r) => r.selector === ".jh-ui[data-theme='light']");
  for (const role of ACCENT_ROLES) assert.ok(role in lightBlock.decls, `light violet sets ${role}`);
});

test('every status role has fg, tint, border, solid and on-solid in both themes', () => {
  for (const theme of ['dark', 'light']) {
    const props = resolveContext(rules, { theme });
    for (const s of STATUSES) {
      for (const part of ['fg', 'tint', 'border', 'solid', 'on-solid']) {
        assert.doesNotThrow(() => tokenColor(props, `${s}-${part}`), `${s}-${part}, ${theme}`);
      }
    }
  }
});

test('only the page gutter changes with the viewport', () => {
  assert.ok(media.length > 0);
  for (const r of media) assert.deepEqual(Object.keys(r.decls), ['--jh-gutter']);
});

test('the violet accent is §5.2’s, as the signed-off mock refines it', () => {
  const value = (theme, role) => {
    const { lch, alpha } = tokenColor(resolveContext(rules, { theme }), role);
    return { lch: lch.map((x) => +x.toFixed(6)), alpha };
  };
  const violet = { lch: [0.541, 0.281, 293.009], alpha: 1 };
  for (const theme of ['dark', 'light']) {
    assert.deepEqual(value(theme, 'accent'), violet, `accent, ${theme}`);
    assert.deepEqual(value(theme, 'on-accent'), { lch: [0.969, 0.016, 293.756], alpha: 1 });
  }
  assert.deepEqual(value('dark', 'focus-ring'), { lch: [0.606, 0.25, 292.717], alpha: 1 });
  // The mock rings light-theme focus in the accent itself (§5.2 said the 0.606 violet).
  assert.deepEqual(value('light', 'focus-ring'), violet);
  // accent-tint: 12–16 % dark, 8–10 % light (§5.2); the mock uses 16 % and 9 %.
  assert.deepEqual(value('dark', 'accent-tint'), { ...violet, alpha: 0.16 });
  assert.deepEqual(value('light', 'accent-tint'), { ...violet, alpha: 0.09 });
  assert.deepEqual(value('dark', 'accent-text'), { lch: [0.79, 0.135, 293], alpha: 1 });
  assert.deepEqual(value('light', 'accent-text'), { lch: [0.48, 0.24, 293], alpha: 1 });
});

test('tailwind.css offers roles as utilities, never palette steps, and each role it names exists', () => {
  const theme = postcss
    .parse(readFileSync(STACK, 'utf8'))
    .nodes.find((n) => n.type === 'atrule' && n.name === 'theme');
  assert.ok(theme, 'expected an @theme block in tailwind.css');
  const read = new Set();
  theme.walkDecls((d) => {
    for (const [, name] of d.value.matchAll(/var\(\s*(--jh-[\w-]+)/g)) read.add(name);
  });
  for (const name of read) {
    assert.ok(!PALETTE.test(name), `${name} is a palette step: map a role to it instead`);
    assert.ok(name in base.decls, `${name} is not declared in tokens.css`);
  }
  // Every colour role has a utility (bg-, text-, border-...): roles, not the palette.
  for (const prop of Object.keys(base.decls)) {
    if (!prop.startsWith('--jh-') || PALETTE.test(prop) || !isColour(base.decls[prop])) continue;
    assert.ok(read.has(prop), `${prop} has no utility: map it in tailwind.css's @theme block`);
  }
});

test('no component reads a palette step', () => {
  const files = readdirSync(path.join(ROOT, 'src/ui'), { recursive: true }).filter(
    (f) => /\.(jsx?|css)$/.test(f) && f !== 'tokens.css'
  );
  for (const f of files) {
    const src = readFileSync(path.join(ROOT, 'src/ui', f), 'utf8');
    const hit = src.match(/--jh-(graphite|violet|green|amber|red|steel|blue)-\d+|--jh-white\b/);
    assert.equal(hit, null, `src/ui/${f} reads ${hit?.[0]}: use a role`);
  }
});

test("Tailwind's default palette, sizes, fonts, radii, shadows and blurs are gone (rule 9)", async () => {
  const fresh = () =>
    compile(readFileSync(STACK, 'utf8'), { base: path.join(ROOT, 'src/ui'), onDependency() {} });
  // A compiler keeps every class it has seen, so each class gets its own.
  const compiles = async (cls) => {
    const compiler = await fresh();
    const empty = compiler.build([]).length;
    return compiler.build([cls]).length > empty;
  };
  for (const cls of [
    'bg-red-500',
    'text-white',
    'text-sm',
    'font-serif',
    'rounded-2xl',
    'shadow-md',
    'text-shadow-sm',
    'text-shadow-lg',
    'blur-sm',
    'backdrop-blur-md',
  ]) {
    assert.equal(await compiles(cls), false, `${cls} still compiles`);
  }
  for (const cls of [
    'bg-surface-1',
    'text-text-2',
    'text-crit-fg',
    'font-sans',
    'font-mono',
    'font-bold',
    'rounded-xl',
    'shadow-pop',
  ]) {
    assert.equal(await compiles(cls), true, `${cls} should compile`);
  }
  // The stack as built: no blurred or frosted surface, text shadow or gradient
  // text (text clipped to its background) anywhere.
  const compiler = await fresh();
  const css = compiler.build(new Scanner({ sources: compiler.sources }).scan());
  assert.doesNotMatch(css, /backdrop-filter|blur\(/);
  assert.doesNotMatch(css, /(?<![-\w])text-shadow\s*:/);
  assert.doesNotMatch(css, /background-clip\s*:\s*text/);
  // The guards bite: each banned effect, built, matches them.
  const banned = (await fresh()).build(['text-shadow-[0_1px_0_red]', 'bg-clip-text']);
  assert.match(banned, /(?<![-\w])text-shadow\s*:/);
  assert.match(banned, /background-clip\s*:\s*text/);
});

test("shadcn's accent-foreground is never used: here accent is the violet, not a hover surface", () => {
  const files = readdirSync(path.join(ROOT, 'src/ui'), { recursive: true }).filter(
    (f) => /\.(jsx?|css)$/.test(f) && !/\.test\.jsx?$/.test(f) && f !== 'tailwind.css'
  );
  assert.ok(files.length > 0);
  for (const f of files) {
    const hit = readFileSync(path.join(ROOT, 'src/ui', f), 'utf8').match(
      /[\w:[\]=-]*accent-foreground\b/
    );
    assert.equal(
      hit,
      null,
      `src/ui/${f} uses ${hit?.[0]}: a stock shadcn highlight. Use bg-row-hover or ` +
        'bg-surface-2 with text-text-1 (docs/design-system.md, "shadcn/ui names")'
    );
  }
});

function isColour(value) {
  if (/^var\(/.test(value)) return true;
  try {
    parseColor(value);
    return true;
  } catch {
    return false;
  }
}
