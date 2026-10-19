import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractPrecacheAssets,
  listBuildAssets,
  buildAssetsProblem,
  injectIntoSw,
} from './inject-sw-precache.mjs';

test('extractPrecacheAssets pulls js+css under /assets from script src, modulepreload, and stylesheet href', () => {
  const html = `<!doctype html><html><head>
    <link rel="modulepreload" href="/assets/vendor-react-ABC.js">
    <link rel="stylesheet" href="/assets/index-DEF.css">
    <script type="module" src="/assets/index-GHI.js"></script>
    <link rel="icon" href="/favicon.svg">
    <img src="/logo.svg">
  </head></html>`;
  assert.deepEqual(extractPrecacheAssets(html), [
    '/assets/index-DEF.css',
    '/assets/index-GHI.js',
    '/assets/vendor-react-ABC.js',
  ]);
});

test('extractPrecacheAssets dedupes and ignores non-/assets paths and non-js/css files', () => {
  const html = `<script src="/assets/a.js"></script><script src="/assets/a.js"></script>
    <link href="/assets/font.woff2"><script src="/other/b.js"></script>`;
  assert.deepEqual(extractPrecacheAssets(html), ['/assets/a.js']);
});

test('listBuildAssets turns every dist/assets file into its sorted /assets/ URL path', () => {
  assert.deepEqual(listBuildAssets(['index-B.js', 'SettingsView-C.js', 'index-A.css', 'sub/font-D.woff2']), [
    '/assets/SettingsView-C.js',
    '/assets/index-A.css',
    '/assets/index-B.js',
    '/assets/sub/font-D.woff2',
  ]);
});

test('buildAssetsProblem refuses an empty build or one missing a precached bundle', () => {
  const build = ['/assets/a.js', '/assets/b.css', '/assets/lazy.js'];
  assert.equal(buildAssetsProblem(['/assets/a.js', '/assets/b.css'], build), null);
  assert.match(buildAssetsProblem([], []), /no files/);
  assert.match(buildAssetsProblem(['/assets/a.js', '/assets/gone.js'], build), /\/assets\/gone\.js/);
});

test('injectIntoSw replaces both placeholder lists and the version literal', () => {
  const src = `const APP_VERSION = '0.0.0';\nconst PRECACHE_ASSETS = [];\nconst BUILD_ASSETS = [];\n`;
  const out = injectIntoSw(src, ['/assets/a.js', '/assets/b.css'], '1.2.0', [
    '/assets/a.js',
    '/assets/b.css',
    '/assets/lazy.js',
  ]);
  assert.match(out, /const APP_VERSION = '1\.2\.0';/);
  assert.match(out, /const PRECACHE_ASSETS = \["\/assets\/a\.js","\/assets\/b\.css"\];/);
  assert.match(
    out,
    /const BUILD_ASSETS = \["\/assets\/a\.js","\/assets\/b\.css","\/assets\/lazy\.js"\];/
  );
});

test('the real public/sw.js carries all three markers injectIntoSw fills', () => {
  const sw = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sw.js'), 'utf8');
  const out = injectIntoSw(sw, ['/assets/a.js'], '7.7.7', ['/assets/a.js', '/assets/lazy.js']);
  assert.match(out, /const APP_VERSION = '7\.7\.7';/);
  assert.match(out, /const PRECACHE_ASSETS = \["\/assets\/a\.js"\];/);
  assert.match(out, /const BUILD_ASSETS = \["\/assets\/a\.js","\/assets\/lazy\.js"\];/);
});

test('injectIntoSw leaves source unchanged when the markers are absent (no throw)', () => {
  const src = '// a worker with no markers';
  assert.equal(injectIntoSw(src, ['/assets/a.js'], '1.2.0'), src);
});

test('injectIntoSw inserts asset paths literally even if one contains a $ sequence', () => {
  // String .replace would expand `$&` as a back-reference; a function inserts it
  // verbatim. (Vite hashes never contain `$`, but this locks in the safe form.)
  const out = injectIntoSw('const PRECACHE_ASSETS = [];', ['/assets/weird-$&-AB.js'], '1.0.0');
  assert.match(out, /\["\/assets\/weird-\$&-AB\.js"\]/);
});
