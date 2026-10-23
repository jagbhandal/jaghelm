// Settings' places (#317): Settings became sections behind an index, so every
// UI string and link that names a place in it names a section it has
// (src/components/settings/sections.js), never one of the 13 tabs before; and
// no button wears `.settings-btn`, a class no stylesheet defines, which drew
// four of them unstyled (#276).
//
// Strings and JSX text are read with TypeScript's parser, so a comment that
// names an old tab (code history) is left alone and a string can't hide in
// one. src/, mobile/src/ and the gallery are checked; tests are not (a test
// may name an old address on purpose, to follow its redirect).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { SETTINGS_SECTIONS } from '../src/components/settings/sections.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src', 'mobile/src', 'gallery'];
const SOURCE = /\.(jsx?|mjs|tsx?)$/;
const TEST = /\.(test|spec)\.(jsx?|mjs|tsx?)$/;

// Strings that name a place in another app's settings, not JagHelm's.
const OTHER_APPS = [
  // IframeView.jsx: where Uptime Kuma's own settings allow embedding.
  'Uptime Kuma: in Settings → General',
];

function files(dir) {
  const out = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'baselines') out.push(...files(rel));
    } else if (SOURCE.test(entry.name) && !TEST.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

/** Each string literal, template part and JSX text in `file`, with its line. */
function strings(file) {
  const text = readFileSync(path.join(ROOT, file), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = [];
  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      out.push({ value: node.text, where: `${file}:${line}` });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const ALL = DIRS.flatMap(files).flatMap(strings);
const LABELS = SETTINGS_SECTIONS.map((s) => s.label);
const IDS = new Set(SETTINGS_SECTIONS.map((s) => s.id));

test('the files are found: some strings in src/ name a Settings section', () => {
  assert.ok(ALL.length > 1000);
  assert.ok(ALL.some((s) => /Settings → Nodes & Services/.test(s.value)));
});

test('every "Settings → <place>" in a string names a section Settings has', () => {
  const stale = [];
  // JSX text may break the line between the arrow and the place.
  const place = /Settings\s*[→›>]\s*([^.,;:)"'\n]+)/g;
  for (const { value, where } of ALL) {
    if (OTHER_APPS.some((other) => value.includes(other))) continue;
    for (const [, named] of value.matchAll(place)) {
      const name = named.trim();
      if (!LABELS.some((label) => name.startsWith(label))) stale.push(`${where}: Settings → ${name}`);
    }
  }
  assert.deepEqual(stale, []);
});

test('every link to a Settings address names a section Settings has', () => {
  const stale = [];
  for (const { value, where } of ALL) {
    for (const [, id] of value.matchAll(/^\/settings\/([a-z][^/?#\s]*)/g)) {
      if (!IDS.has(id)) stale.push(`${where}: /settings/${id}`);
    }
  }
  for (const file of DIRS.flatMap(files)) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of text.matchAll(/pathTo\(\s*'settings'\s*,\s*\{\s*section:\s*'([^']+)'/g)) {
      if (!IDS.has(m[1])) stale.push(`${file}: pathTo('settings', { section: '${m[1]}' })`);
    }
  }
  assert.deepEqual(stale, []);
});

test('no button wears the undefined .settings-btn class (#276)', () => {
  const worn = [];
  for (const { value, where } of ALL) {
    if (/(^|\s)settings-btn(\s|$)/.test(value)) worn.push(where);
  }
  assert.deepEqual(worn, []);
  const css = readFileSync(path.join(ROOT, 'src/styles/global.css'), 'utf8');
  assert.doesNotMatch(css, /\.settings-btn[\s{,:]/, 'global.css defines no bare .settings-btn');
});
