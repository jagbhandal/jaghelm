// Guards the README, the page's meta tags and the living docs against exact preset,
// integration and test counts (#228). Exact counts went stale: "42 integrations" outlived
// the Watchtower preset and "220 automated tests" outlived ~600 more tests. Say "40+"
// instead; a floor stays true while presets are added. A floor for presets or
// integrations must not exceed the number of presets the registry loads, so removing
// presets can't leave "40+" behind either.
//
// Historical records (CHANGELOG entries, plans, dated audits) describe the past and are
// not checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initRegistry, getPreset } from '../server/integrations/registry.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRESETS_DIR = path.join(ROOT, 'server/integrations/presets');

const TOP_LEVEL = ['README.md', 'KNOWN-ISSUES.md', 'index.html'];
const HISTORICAL = [
  /^docs\/superpowers\//, // design specs and plans
  /(^|\/)plans\//, // implementation plans
  /^docs\/IMPROVEMENT-PLAN\.md$/, // the 2026-06-17 audit
  /^docs\/PHASE3-INTEGRATIONS\.md$/, // the Phase 3 plan
];

// A number (not part of a section or version number such as 4.3), an optional "+",
// up to two words, then the counted noun: "42 app integrations", "~42 third-party
// app APIs", "(42 presets)", "220 automated tests", "1,000+ automated tests".
const COUNT_RE =
  /(?<![\w.,])(\d{1,3}(?:,\d{3})+|\d+)(\+?)\s+(?:[\w'-]+\s+){0,2}?\**(integrations?|presets?|upstreams?|APIs|tests)\b/gi;

/** [{ claim, n, floor, noun, line }] for each count in `text`. */
export function countClaims(text) {
  return [...text.matchAll(COUNT_RE)].map((m) => ({
    claim: m[0].replace(/\s+/g, ' '),
    n: Number(m[1].replace(/,/g, '')),
    floor: m[2] === '+',
    noun: m[3].toLowerCase(),
    line: text.slice(0, m.index).split('\n').length,
  }));
}

/** Problems with the counts in one file: any exact count, or a preset floor above `presetCount`. */
export function countProblems(file, text, presetCount) {
  const problems = [];
  for (const c of countClaims(text)) {
    const where = `${file}:${c.line}: "${c.claim}"`;
    if (!c.floor) {
      problems.push(`${where} is an exact count; write a floor such as "40+" or drop the number`);
    } else if (c.noun !== 'tests' && c.n > presetCount) {
      problems.push(`${where} claims more than the ${presetCount} presets the registry loads`);
    }
  }
  return problems;
}

function docsFiles(dir = 'docs') {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return docsFiles(rel);
    return e.name.endsWith('.md') ? [rel] : [];
  });
}

const checkedFiles = () =>
  [...TOP_LEVEL, ...docsFiles()].filter((f) => !HISTORICAL.some((re) => re.test(f)));

test('countClaims finds exact counts and floors, not section or version numbers', () => {
  const claims = (s) =>
    countClaims(s).map(({ n, floor, noun }) => `${n}${floor ? '+' : ''} ${noun}`);
  assert.deepEqual(claims('and 42 app integrations behind'), ['42 integrations']);
  assert.deepEqual(claims('proxies ~42 third-party\napp APIs'), ['42 apis']);
  assert.deepEqual(claims('IE["engine<br/>(42 presets)"]'), ['42 presets']);
  assert.deepEqual(claims('- **40+ integrations that call**'), ['40+ integrations']);
  assert.deepEqual(claims('signed images · 1,000+ automated tests ·'), ['1000+ tests']);
  assert.deepEqual(claims('### 4.3 Integration engine'), []);
  assert.deepEqual(claims('Settings → Integrations; v2 presets'), []);
});

test('countProblems rejects exact counts and preset floors above the registry', () => {
  assert.equal(countProblems('a.md', '220 automated tests gate the build', 41).length, 1);
  assert.equal(countProblems('a.md', '42 integration presets', 41).length, 1);
  assert.deepEqual(countProblems('a.md', '40+ presets and 1,000+ tests', 41), []);
  assert.match(
    countProblems('a.md', '\n45+ integrations', 41)[0],
    /a\.md:2: "45\+ integrations" claims more than the 41/
  );
});

test('docs and meta tags state no exact preset, integration or test count', async () => {
  await initRegistry();
  const loaded = readdirSync(PRESETS_DIR)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => getPreset(path.basename(f, '.js'))).length;
  assert.ok(loaded > 0, 'the registry loaded no presets');

  const files = checkedFiles();
  assert.ok(files.includes('docs/ARCHITECTURE.md'), 'docs/ were not scanned');
  const problems = files.flatMap((f) =>
    countProblems(f, readFileSync(path.join(ROOT, f), 'utf8'), loaded)
  );
  assert.deepEqual(problems, []);
});
