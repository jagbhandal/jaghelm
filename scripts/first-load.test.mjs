// scripts/first-load.mjs (#444): what the first screen fetches, as sent. The
// browser check that it is the right list is e2e/first-load.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  BUDGET,
  FACES,
  LEGACY_FACES,
  LOGO,
  builtAsset,
  firstLoad,
  formatReport,
  htmlPulls,
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

test('a source file is found among the built assets by its name, never a longer one', () => {
  assert.equal(
    builtAsset(ASSETS, 'manrope-latin-wght.woff2'),
    '/assets/manrope-latin-wght-FFFFFFFF.woff2'
  );
  assert.equal(
    builtAsset(ASSETS, 'dm-sans-latin-wght.woff2'),
    '/assets/dm-sans-latin-wght-HHHHHHHH.woff2'
  );
  assert.throws(() => builtAsset(ASSETS, 'inter-latin-wght.woff2'), /not in the build/);
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
  assert.equal(
    report.total,
    report.items.reduce((sum, i) => sum + i.bytes, 0)
  );
  assert.equal(report.items.find((i) => i.kind === 'font').bytes, 1000);
  assert.ok(report.items.find((i) => i.kind === 'script').bytes < 100, 'gzipped');
  assert.equal(report.budget, BUDGET);
  assert.equal(BUDGET, 200_000);
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

test('the table: one line a file without its hash, a line a kind, the total against the budget', () => {
  const report = {
    items: [
      { kind: 'page', url: '/index.html', bytes: 1234 },
      { kind: 'script', url: '/assets/index-AAAAAAAA.js', bytes: 61000 },
      { kind: 'script', url: '/assets/vendor-react-B-b_BBBB.js', bytes: 59700 },
      { kind: 'font', url: '/assets/manrope-latin-wght-FFFFFFFF.woff2', bytes: 24836 },
    ],
    total: 146770,
    budget: 200_000,
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
      '  total                                    146.8 kB',
      '  under the 200.0 kB budget by 53.2 kB',
    ].join('\n')
  );
  assert.match(
    formatReport({ ...report, total: 212345 }),
    /\n {2}OVER the 200\.0 kB budget by 12\.3 kB$/
  );
});
