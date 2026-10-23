// Settings' places (#317): Settings became sections behind an index, so every
// UI string, link and living doc that names a place in it names a section it
// has (src/components/settings/sections.js), never one of the 13 tabs
// before; and no button wears `.settings-btn`, a class no stylesheet
// defines, which drew four of them unstyled (#276).
//
// Code strings and JSX text are read with TypeScript's parser, so a code
// comment that names an old tab (code history) is left alone and a string
// can't hide in one; src/, mobile/src/ and the gallery are checked, tests not
// (a test may name an old address on purpose, to follow its redirect). The
// README and docs/ are read whole, except the historical records (specs,
// plans, dated audits), which describe the past. A place is written
// "Settings → X" (or ›, ->, >), "Settings' X tab" or "the X tab in Settings".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  SETTINGS_SECTIONS,
  MOVED_ANCHORS,
  MOVED_SECTIONS,
  isSettingsAnchor,
} from '../src/components/settings/sections.js';
import { SETTINGS_LINKS } from '../src/shell/detail/settingsLinks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODE_DIRS = ['src', 'mobile/src', 'gallery'];
const SOURCE = /\.(jsx?|mjs|tsx?)$/;
const TEST = /\.(test|spec)\.(jsx?|mjs|tsx?)$/;
// Records of the past, as scripts/doc-counts.test.mjs keeps them.
const HISTORICAL = [
  /^docs\/superpowers\//,
  /(^|\/)plans\//,
  /^docs\/IMPROVEMENT-PLAN\.md$/,
  /^docs\/PHASE3-INTEGRATIONS\.md$/,
  /^docs\/UI-UX-ANALYSIS\.md$/,
];

// Places in another app's settings, not JagHelm's.
const OTHER_APPS = [
  // IframeView.jsx: where Uptime Kuma's own settings allow embedding.
  'Uptime Kuma: in Settings → General',
  // A GitHub repository's settings (PUSH-SETUP.md, KEYSTORE.md).
  'Settings → Secrets and variables',
  // An Android phone's settings (KEYSTORE.md).
  'Settings → Apps → Special access',
];
// Sections their cards add (#320), which docs may already name.
const PLANNED = ['Notifications'];

function walk(dir, keep) {
  const out = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'baselines') out.push(...walk(rel, keep));
    } else if (keep(rel)) {
      out.push(rel);
    }
  }
  return out;
}

const CODE = CODE_DIRS.flatMap((d) => walk(d, (f) => SOURCE.test(f) && !TEST.test(f)));
const DOCS = [
  'README.md',
  ...walk('docs', (f) => f.endsWith('.md') && !HISTORICAL.some((h) => h.test(f))),
];

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

/** A doc's text, a paragraph at a time, its emphasis and line breaks gone. */
function paragraphs(file) {
  const text = readFileSync(path.join(ROOT, file), 'utf8');
  const out = [];
  let line = 1;
  for (const para of text.split(/\n\s*\n/)) {
    out.push({ value: para.replace(/[*_`]/g, '').replace(/\s+/g, ' '), where: `${file}:${line}` });
    line += para.split('\n').length + 1;
  }
  return out;
}

const CODE_STRINGS = CODE.flatMap(strings);
const ALL = [...CODE_STRINGS, ...DOCS.flatMap(paragraphs)];
const LABELS = SETTINGS_SECTIONS.map((s) => s.label);
const IDS = new Set(SETTINGS_SECTIONS.map((s) => s.id));
const NAMED = [...LABELS, ...PLANNED];

/** The places in `value` that name no section, as "Settings → X". */
export function stalePlaces(value) {
  const stale = [];
  if (OTHER_APPS.some((other) => value.includes(other))) return stale;
  const named = (name) => NAMED.some((label) => name.startsWith(label));
  for (const [, place] of value.matchAll(/Settings\s*(?:→|›|->|>)\s*([^.,;:)"'(—\n]+)/g)) {
    if (!named(place.trim())) stale.push(`Settings → ${place.trim()}`);
  }
  for (const [, place] of value.matchAll(
    /Settings['’]\s+([A-Z][\w]*(?: & [\w]+)?)\s+(?:tab|section)\b/g
  )) {
    if (!named(place)) stale.push(`Settings' ${place}`);
  }
  // Settings has no tabs since #317: "the Links tab in Settings" is always stale.
  for (const [whole] of value.matchAll(
    /\b[A-Z][\w]*(?: & [\w]+)?\s+tabs?\s+(?:in|of)\s+Settings\b/g
  )) {
    stale.push(whole);
  }
  return stale;
}

test('the files are found: strings and docs that name a Settings section', () => {
  assert.ok(CODE_STRINGS.length > 1000);
  assert.ok(DOCS.includes('README.md') && DOCS.includes('docs/GET-STARTED.md'));
  assert.ok(!DOCS.some((f) => f.startsWith('docs/superpowers/')));
  assert.ok(ALL.some((s) => /Settings → Nodes & Services/.test(s.value)));
});

test('it reads every way of writing a place', () => {
  assert.deepEqual(stalePlaces('add one in Settings → Sections'), ['Settings → Sections']);
  assert.deepEqual(stalePlaces('see Settings -> Layout.'), ['Settings → Layout']);
  assert.deepEqual(stalePlaces('Open Settings > Tabs (or Add app)'), ['Settings → Tabs']);
  assert.deepEqual(stalePlaces('Settings › Widgets'), ['Settings → Widgets']);
  assert.deepEqual(stalePlaces('in Settings’ Links tab'), ["Settings' Links"]);
  assert.deepEqual(stalePlaces('the Links tab in Settings'), ['Links tab in Settings']);
  assert.deepEqual(stalePlaces('Settings → Nodes & Services → Custom groups'), []);
  assert.deepEqual(stalePlaces('Settings > Apps & links > Quick Launch links'), []);
  assert.deepEqual(stalePlaces('repo → Settings → Secrets and variables → Actions'), []);
});

test('every place a string or doc names in Settings is a section it has', () => {
  const stale = ALL.flatMap(({ value, where }) =>
    stalePlaces(value).map((place) => `${where}: ${place}`)
  );
  assert.deepEqual(stale, []);
});

test('every link to a Settings address names a section it has, and a part of it', () => {
  const stale = [];
  for (const { value, where } of CODE_STRINGS) {
    for (const [, id, anchor] of value.matchAll(/^\/settings\/([a-z][^/?#\s]*)(?:#([\w-]+))?/g)) {
      if (!IDS.has(id)) stale.push(`${where}: /settings/${id}`);
      else if (anchor && !isSettingsAnchor(id, anchor))
        stale.push(`${where}: /settings/${id}#${anchor}`);
    }
  }
  for (const file of CODE) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of text.matchAll(/pathTo\(\s*'settings'\s*,\s*\{\s*section:\s*'([^']+)'/g)) {
      if (!IDS.has(m[1])) stale.push(`${file}: pathTo('settings', { section: '${m[1]}' })`);
    }
    for (const m of text.matchAll(/settingsHref\(\s*'([^']+)'(?:\s*,\s*'([^']+)')?\s*\)/g)) {
      if (!IDS.has(m[1]) || (m[2] && !isSettingsAnchor(m[1], m[2])))
        stale.push(`${file}: settingsHref('${m[1]}'${m[2] ? `, '${m[2]}'` : ''})`);
    }
  }
  assert.deepEqual(stale, []);
});

test('the ids passed through tables are live: the detail drawer’s links, the old addresses', () => {
  for (const [kind, [words, section, part]] of Object.entries(SETTINGS_LINKS)) {
    assert.ok(IDS.has(section), `${kind}: ${words} → ${section}`);
    if (part != null) assert.ok(isSettingsAnchor(section, part), `${kind}: ${section}#${part}`);
  }
  for (const [old, section] of Object.entries(MOVED_SECTIONS)) {
    assert.ok(IDS.has(section), `/settings/${old} → ${section}`);
    const anchor = MOVED_ANCHORS[old];
    if (anchor != null)
      assert.ok(isSettingsAnchor(section, anchor), `/settings/${old} → #${anchor}`);
  }
});

test('no button wears the undefined .settings-btn class (#276)', () => {
  const worn = [];
  for (const { value, where } of CODE_STRINGS) {
    if (/(^|\s)settings-btn(\s|$)/.test(value)) worn.push(where);
  }
  assert.deepEqual(worn, []);
  const css = readFileSync(path.join(ROOT, 'src/styles/global.css'), 'utf8');
  assert.doesNotMatch(css, /\.settings-btn[\s{,:]/, 'global.css defines no bare .settings-btn');
});
