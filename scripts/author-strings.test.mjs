// No author-specific defaults in the shipped web and Android code (#272): a
// fresh install must not show the author's dashboard name, UPS model or node
// names. Tests and fixtures may name them (they test the migration of old
// layouts, for example); the code they test may not fall back to them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src', 'mobile/src'];
const EXTS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.html', '.css'];

const AUTHOR_STRINGS = ['JAG-NET', 'APC Back-UPS ES 600M1', '(Gateway, Production, Staging)'];

const isTest = (rel) => /\.test\.[cm]?[jt]sx?$/.test(rel);
const isFixture = (rel) => rel.split('/').some((part) => /^(__)?fixtures?(__)?$/.test(part));

/** Repo-relative source files under `dir`, tests and fixtures left out. */
function sources(dir) {
  const out = [];
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || isFixture(rel)) continue;
      out.push(...sources(rel));
    } else if (EXTS.includes(path.extname(e.name)) && !isTest(rel) && !isFixture(rel)) {
      out.push(rel);
    }
  }
  return out;
}

test('the scan covers the web and Android sources', () => {
  const files = DIRS.flatMap(sources);
  assert.ok(files.includes('src/components/NavBar.jsx'), 'src/ is scanned');
  assert.ok(files.includes('mobile/src/MobileApp.jsx'), 'mobile/src/ is scanned');
  assert.ok(!files.some(isTest), 'tests are left out');
});

test('no web or Android source falls back to an author-specific string', () => {
  const hits = [];
  for (const rel of DIRS.flatMap(sources)) {
    const lines = readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const s of AUTHOR_STRINGS) if (line.includes(s)) hits.push(`${rel}:${i + 1}: ${s}`);
    });
  }
  assert.deepEqual(hits, []);
});
