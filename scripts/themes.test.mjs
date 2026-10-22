// Guards the two themes (#304; docs/design-system.md, "Switches"): today's
// stylesheet defines dark (`:root`) and light (`:root[data-theme="light"]`)
// and nothing else, the light block sets every colour the dark one does, so
// no dark colour shows through in light, and the old indigo accent, #6366f1,
// is gone from src/ in every spelling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { LEGACY_THEMES } from '../src/shell/theme.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GLOBAL = 'src/styles/global.css';
const TEXT = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.css', '.html', '.json', '.md', '.svg'];

/** Repo-relative text files under `dir`, tests included. */
function walk(dir) {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return walk(rel);
    return TEXT.some((x) => e.name.endsWith(x)) ? [rel] : [];
  });
}

const rules = () => {
  const out = [];
  postcss.parse(readFileSync(path.join(ROOT, GLOBAL), 'utf8')).walkRules((r) => out.push(r));
  return out;
};

const props = (rule) => {
  const out = new Map();
  rule.walkDecls(/^--/, (d) => out.set(d.prop, d.value));
  return out;
};

const isColour = (value) => /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|oklab|color-mix)\(/i.test(value);

test('no #6366f1, the old indigo accent, anywhere in src/', () => {
  const indigo = /#6366f1\b|\b99\s*,\s*102\s*,\s*241\b/i;
  const found = walk('src').filter((f) => indigo.test(readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(found, []);
});

test("today's stylesheet has two themes: dark on :root, light on :root[data-theme='light']", () => {
  const themed = rules()
    .filter((r) => r.selector.includes('data-theme'))
    .map((r) => r.selector.replace(/"/g, "'"));
  assert.deepEqual(themed, [":root[data-theme='light']"]);
  assert.equal(rules().filter((r) => r.selector === ':root').length, 1);
});

test('no old theme name is left as a data-theme value in src/', () => {
  const names = Object.keys(LEGACY_THEMES).filter((n) => n !== 'dark');
  const pattern = new RegExp(`data-theme=["']?(${names.join('|')})\\b`);
  const found = walk('src').filter((f) => pattern.test(readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(found, []);
});

test('the light theme sets every colour the dark one does', () => {
  const all = rules();
  const dark = props(all.find((r) => r.selector === ':root'));
  const light = props(all.find((r) => r.selector.includes('data-theme')));
  const colours = [...dark].filter(([, v]) => isColour(v)).map(([k]) => k);
  assert.ok(colours.length > 10, 'the dark theme sets its colours');
  assert.deepEqual(
    colours.filter((k) => !light.has(k)),
    [],
    'colours the light theme leaves dark'
  );
  assert.deepEqual(
    [...light.keys()].filter((k) => !dark.has(k)),
    [],
    'the light theme sets only what the dark one does'
  );
});
