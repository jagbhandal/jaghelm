import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPrecacheAssets, injectIntoSw } from './inject-sw-precache.mjs';

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

test('injectIntoSw replaces the placeholder list and the version literal', () => {
  const src = `const APP_VERSION = '0.0.0';\nconst PRECACHE_ASSETS = [];\n`;
  const out = injectIntoSw(src, ['/assets/a.js', '/assets/b.css'], '1.2.0');
  assert.match(out, /const APP_VERSION = '1\.2\.0';/);
  assert.match(out, /const PRECACHE_ASSETS = \["\/assets\/a\.js","\/assets\/b\.css"\];/);
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
