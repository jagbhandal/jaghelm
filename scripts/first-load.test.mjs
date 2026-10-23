// scripts/first-load.mjs (#444): what the first screen fetches, as sent. The
// browser check that it is the right list is e2e/first-load.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  BUDGETS,
  FACES,
  LEGACY_FACES,
  LOGO,
  PHONE_CHUNK,
  builtAsset,
  firstLoad,
  formatReport,
  htmlPulls,
  staticImports,
  transferSize,
} from './first-load.mjs';
import { DEFAULT_TYPEFACE, MONO_TYPEFACE, TYPEFACES } from '../src/ui/typefaces.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HTML = `<!doctype html><html><head>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="manifest" href="/manifest.json" />
  <script type="application/ld+json">{"@type": "SoftwareApplication"}</script>
  <script type="module" crossorigin src="/assets/index-AAAAAAAA.js"></script>
  <link rel="modulepreload" crossorigin href="/assets/vendor-react-BBBBBBBB.js">
  <link rel="modulepreload" crossorigin href="/assets/index-AAAAAAAA.js">
  <link rel="stylesheet" crossorigin href="/assets/index-CCCCCCCC.css">
  <link rel="preload" as="font" type="font/woff2" crossorigin href="/assets/x-DDDDDDDD.woff2">
</head><body><div id="root"></div><script src="/register-sw.js"></script></body></html>`;

const ASSETS = [
  'index-AAAAAAAA.js',
  'vendor-react-BBBBBBBB.js',
  'index-CCCCCCCC.css',
  'x-DDDDDDDD.woff2',
  'manrope-latin-ext-wght-EEEEEEEE.woff2',
  'manrope-latin-wght-FFFFFFFF.woff2',
  'jetbrains-mono-latin-wght-GGGGGGGG.woff2',
  'dm-sans-latin-wght-bold-ZZZZZZZZ.woff2',
  'dm-sans-latin-wght-HHHHHHHH.woff2',
  'dm-sans-latin-300-italic-IIIIIIII.woff2',
  'outfit-latin-wght-JJJJJJJJ.woff2',
  'layer-KKKKKKKK.js',
];

/** A build whose every file is `size` bytes of one repeated letter (text) or noise (fonts). */
function fakeBuild(size = 1000) {
  const files = new Map();
  return {
    html: HTML,
    assets: ASSETS,
    read(url) {
      if (url === '/index.html') return Buffer.from(HTML);
      if (!files.has(url)) {
        files.set(
          url,
          /\.woff2$/.test(url)
            ? Buffer.from(Array.from({ length: size }, (_, i) => (i * 7919) % 251))
            : Buffer.from('a'.repeat(size))
        );
      }
      return files.get(url);
    },
  };
}

test("index.html's pulls: scripts, module preloads, stylesheets and preloads, each once", () => {
  assert.deepEqual(htmlPulls(HTML), [
    { kind: 'script', url: '/assets/index-AAAAAAAA.js' },
    { kind: 'script', url: '/assets/vendor-react-BBBBBBBB.js' },
    { kind: 'style', url: '/assets/index-CCCCCCCC.css' },
    { kind: 'font', url: '/assets/x-DDDDDDDD.woff2' },
    { kind: 'script', url: '/register-sw.js' },
  ]);
});

test('a source file is found among the built assets by its whole name, never a longer one', () => {
  assert.equal(
    builtAsset(ASSETS, 'manrope-latin-wght.woff2'),
    '/assets/manrope-latin-wght-FFFFFFFF.woff2'
  );
  assert.equal(
    builtAsset(ASSETS, 'dm-sans-latin-wght.woff2'),
    '/assets/dm-sans-latin-wght-HHHHHHHH.woff2'
  );
  assert.throws(() => builtAsset(ASSETS, 'inter-latin-wght.woff2'), /not in the build/);
  // A longer name that starts the same is another file.
  assert.throws(
    () => builtAsset(['dm-sans-latin-wght-bold-ZZZZZZZZ.woff2'], 'dm-sans-latin-wght.woff2'),
    /not in the build/
  );
  assert.throws(() => builtAsset(['x-AAAAAAAA.js'], 'x.woff2'), /not in the build/);
});

test('text is counted gzipped, as the server sends it; fonts and images as they are', () => {
  const text = Buffer.from('const a = 1;\n'.repeat(200));
  assert.equal(transferSize('/assets/index-AAAAAAAA.js', text), gzipSync(text).length);
  assert.equal(transferSize('/logo.svg', text), gzipSync(text).length);
  assert.equal(transferSize('/assets/x-DDDDDDDD.woff2', text), text.length);
  assert.equal(transferSize('/og-image.png', text), text.length);
});

test("the first load: the page, its pulls, the first screen's faces and the logo", () => {
  const build = fakeBuild();
  const report = firstLoad(build);
  assert.deepEqual(
    report.items.map((i) => `${i.kind} ${i.url}`),
    [
      'page /index.html',
      'script /assets/index-AAAAAAAA.js',
      'script /assets/vendor-react-BBBBBBBB.js',
      'script /register-sw.js',
      'style /assets/index-CCCCCCCC.css',
      'font /assets/x-DDDDDDDD.woff2',
      'font /assets/manrope-latin-wght-FFFFFFFF.woff2',
      'font /assets/jetbrains-mono-latin-wght-GGGGGGGG.woff2',
      'font /assets/dm-sans-latin-wght-HHHHHHHH.woff2',
      'font /assets/outfit-latin-wght-JJJJJJJJ.woff2',
      'image /logo.svg',
    ]
  );
  // Never the floating layer, a latin-ext file or a face nobody draws.
  for (const url of ['layer-', 'latin-ext', 'italic']) {
    assert.ok(!report.items.some((i) => i.url.includes(url)), url);
  }
  // Two totals: the fonts, and everything else.
  const sum = (keep) => report.items.filter(keep).reduce((total, i) => total + i.bytes, 0);
  assert.deepEqual(report.code, {
    total: sum((i) => i.kind !== 'font'),
    budget: BUDGETS.code,
  });
  assert.deepEqual(report.fonts, { total: 5000, budget: BUDGETS.fonts });
  assert.equal(report.items.find((i) => i.kind === 'font').bytes, 1000);
  assert.ok(report.items.find((i) => i.kind === 'script').bytes < 100, 'gzipped');
  // Spec §4 (Jag, 2026-10-22): 200 KB for the code, 60 KB for the faces.
  assert.deepEqual(BUDGETS, { code: 200_000, fonts: 60_000 });
});

test("a built script's static imports, by their /assets/ URL, each once; never a dynamic import()", () => {
  const code =
    'import{a as b}from"./shared-AAAAAAAA.js";import"./rolldown-runtime-BBBBBBBB.js";' +
    'export{x}from"./shared-AAAAAAAA.js";const l=()=>import("./layer-CCCCCCCC.js");';
  assert.deepEqual(staticImports(code), [
    '/assets/shared-AAAAAAAA.js',
    '/assets/rolldown-runtime-BBBBBBBB.js',
  ]);
  assert.deepEqual(staticImports('const a = 1;'), []);
});

test("a phone's first load (#303): the phone screens' chunk and what only it imports, none of the board's faces", () => {
  const build = fakeBuild();
  const files = {
    '/assets/PhoneView-PPPPPPPP.js':
      'import{a}from"./index-AAAAAAAA.js";import{b}from"./phone-only-QQQQQQQQ.js";',
    '/assets/phone-only-QQQQQQQQ.js': 'import{a}from"./index-AAAAAAAA.js";',
  };
  const phone = {
    ...build,
    assets: [...build.assets, 'PhoneView-PPPPPPPP.js', 'phone-only-QQQQQQQQ.js'],
    read: (url) => (files[url] ? Buffer.from(files[url]) : build.read(url)),
  };
  assert.equal(PHONE_CHUNK, 'PhoneView.js');
  const report = firstLoad(phone, { phone: true });
  assert.deepEqual(
    report.items.map((i) => `${i.kind} ${i.url}`),
    [
      'page /index.html',
      'script /assets/index-AAAAAAAA.js',
      'script /assets/vendor-react-BBBBBBBB.js',
      'script /register-sw.js',
      'script /assets/PhoneView-PPPPPPPP.js',
      'script /assets/phone-only-QQQQQQQQ.js',
      'style /assets/index-CCCCCCCC.css',
      'font /assets/x-DDDDDDDD.woff2',
      'font /assets/manrope-latin-wght-FFFFFFFF.woff2',
      'font /assets/jetbrains-mono-latin-wght-GGGGGGGG.woff2',
      'image /logo.svg',
    ]
  );
  // A desktop's never has the chunk.
  assert.ok(!firstLoad(phone).items.some((i) => i.url.includes('PhoneView')));
});

test("the faces counted are the default sans's and the mono's latin files, and today's board's", () => {
  assert.deepEqual(FACES, [
    TYPEFACES.find((t) => t.id === DEFAULT_TYPEFACE).file,
    MONO_TYPEFACE.file,
  ]);
  assert.deepEqual(FACES, ['manrope-latin-wght.woff2', 'jetbrains-mono-latin-wght.woff2']);
  for (const file of [...FACES, ...LEGACY_FACES]) {
    assert.ok(existsSync(path.join(ROOT, 'src/fonts', file)), file);
  }
  assert.ok(existsSync(path.join(ROOT, 'public', LOGO.slice(1))));
});

test('the table: one line a file without its hash, a line a kind, each total against its budget', () => {
  const report = {
    items: [
      { kind: 'page', url: '/index.html', bytes: 1234 },
      { kind: 'script', url: '/assets/index-AAAAAAAA.js', bytes: 61000 },
      { kind: 'script', url: '/assets/vendor-react-B-b_BBBB.js', bytes: 59700 },
      { kind: 'font', url: '/assets/manrope-latin-wght-FFFFFFFF.woff2', bytes: 24836 },
    ],
    code: { total: 121934, budget: 200_000 },
    fonts: { total: 24836, budget: 60_000 },
  };
  assert.equal(
    formatReport(report),
    [
      'First load: what the first screen fetches, as sent (kB = 1,000 bytes)',
      '',
      '  page   /index.html                         1.2 kB',
      '  script /assets/index.js                   61.0 kB',
      '  script /assets/vendor-react.js            59.7 kB',
      '  font   /assets/manrope-latin-wght.woff2   24.8 kB',
      '',
      '  pages                                      1.2 kB',
      '  scripts                                  120.7 kB',
      '  fonts                                     24.8 kB',
      '',
      '  code: page, scripts, styles, images      121.9 kB  under its 200.0 kB budget by 78.1 kB',
      '  fonts                                     24.8 kB  under its 60.0 kB budget by 35.2 kB',
    ].join('\n')
  );
  // Over is said, not failed: the fonts are over until today's board goes (#306).
  assert.match(
    formatReport({ ...report, fonts: { total: 125500, budget: 60_000 } }),
    /\n {2}fonts +125\.5 kB {2}OVER its 60\.0 kB budget by 65\.5 kB$/
  );
});
