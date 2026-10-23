// scripts/first-load.mjs (#444): what the first screen fetches, as sent. The
// browser check that it is the right list is e2e/first-load.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  BUDGETS,
  FACES,
  LOGO,
  PHONE_CHUNK,
  PALETTE_IDLE_CHUNK,
  PHONE_IDLE_CHUNK,
  builtAsset,
  DESKTOP_CHUNKS,
  firstLoad,
  formatReport,
  htmlPulls,
  overBudget,
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
      'image /logo.svg',
    ]
  );
  // Never the floating layer, a latin-ext file or a face nobody draws (the
  // old board's DM Sans and Outfit among them, #306).
  for (const url of ['layer-', 'latin-ext', 'italic', 'dm-sans', 'outfit']) {
    assert.ok(!report.items.some((i) => i.url.includes(url)), url);
  }
  // Two totals: the fonts, and everything else.
  const sum = (keep) => report.items.filter(keep).reduce((total, i) => total + i.bytes, 0);
  assert.deepEqual(report.code, {
    total: sum((i) => i.kind !== 'font'),
    budget: BUDGETS.code,
  });
  assert.deepEqual(report.fonts, { total: 3000, budget: BUDGETS.fonts });
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

test("a phone's first load (#303): the phone screens' chunk and what only it imports", () => {
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

test("a phone's details (#309): fetched once the browser is idle after the first screen, listed apart, in no total", () => {
  const build = fakeBuild();
  const files = {
    '/assets/PhoneView-PPPPPPPP.js': 'import{a}from"./index-AAAAAAAA.js";',
    '/assets/PhoneDetail-RRRRRRRR.js':
      'import{a}from"./index-AAAAAAAA.js";import{d}from"./detail-parts-SSSSSSSS.js";',
    '/assets/detail-parts-SSSSSSSS.js': '',
  };
  const phone = {
    ...build,
    assets: [
      ...build.assets,
      'PhoneView-PPPPPPPP.js',
      'PhoneDetail-RRRRRRRR.js',
      'detail-parts-SSSSSSSS.js',
    ],
    read: (url) => (files[url] ? Buffer.from(files[url]) : build.read(url)),
  };
  assert.equal(PHONE_IDLE_CHUNK, 'PhoneDetail.js');
  const report = firstLoad(phone, { phone: true });
  assert.deepEqual(
    report.idle.map((i) => `${i.kind} ${i.url}`),
    ['script /assets/PhoneDetail-RRRRRRRR.js', 'script /assets/detail-parts-SSSSSSSS.js']
  );
  assert.ok(!report.items.some((i) => /PhoneDetail|detail-parts/.test(i.url)));
  const bare = firstLoad(
    { ...phone, assets: phone.assets.filter((a) => !/PhoneDetail|detail-parts/.test(a)) },
    { phone: true }
  );
  assert.equal(report.code.total, bare.code.total);
  assert.deepEqual(bare.idle, []);
  assert.deepEqual(firstLoad(phone).idle, []);
  assert.match(
    formatReport(report),
    /\n {2}After the first screen, once the browser is idle \(in no total\):\n {2}script \/assets\/PhoneDetail\.js +\d+\.\d kB\n {2}script \/assets\/detail-parts\.js +\d+\.\d kB$/
  );
});

test("the palette's index (#611): fetched once the browser is idle at either width, listed apart, in no total", () => {
  const build = fakeBuild();
  const files = {
    '/assets/CommandPaletteIndex-QQQQQQQQ.js':
      'import{a}from"./index-AAAAAAAA.js";import{t}from"./sectionTerms-TTTTTTTT.js";',
    '/assets/sectionTerms-TTTTTTTT.js': '',
  };
  const withPalette = {
    ...build,
    assets: [...build.assets, 'CommandPaletteIndex-QQQQQQQQ.js', 'sectionTerms-TTTTTTTT.js'],
    read: (url) => (files[url] ? Buffer.from(files[url]) : build.read(url)),
  };
  assert.equal(PALETTE_IDLE_CHUNK, 'CommandPaletteIndex.js');
  const desktop = firstLoad(withPalette);
  assert.deepEqual(
    desktop.idle.map((i) => i.url),
    ['/assets/CommandPaletteIndex-QQQQQQQQ.js', '/assets/sectionTerms-TTTTTTTT.js']
  );
  assert.ok(!desktop.items.some((i) => /CommandPaletteIndex|sectionTerms/.test(i.url)));
  assert.equal(desktop.code.total, firstLoad(build).code.total);
});

test("the faces counted are the default sans's and the mono's latin files, the only faces shipped beside the presets' (#306)", () => {
  assert.deepEqual(FACES, [
    TYPEFACES.find((t) => t.id === DEFAULT_TYPEFACE).file,
    MONO_TYPEFACE.file,
  ]);
  assert.deepEqual(FACES, ['manrope-latin-wght.woff2', 'jetbrains-mono-latin-wght.woff2']);
  for (const file of FACES) {
    assert.ok(existsSync(path.join(ROOT, 'src/fonts', file)), file);
  }
  // The old board's faces are gone, files and all.
  for (const file of ['dm-sans-latin-wght.woff2', 'outfit-latin-wght.woff2']) {
    assert.ok(!existsSync(path.join(ROOT, 'src/fonts', file)), file);
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
  assert.match(
    formatReport({ ...report, fonts: { total: 125500, budget: 60_000 } }),
    /\n {2}fonts +125\.5 kB {2}OVER its 60\.0 kB budget by 65\.5 kB$/
  );
});

test('over budget: overBudget names each total over its own budget, at the byte', () => {
  const at = (code, fonts) => ({
    code: { total: code, budget: 200_000 },
    fonts: { total: fonts, budget: 60_000 },
  });
  assert.deepEqual(overBudget(at(200_000, 60_000)), []);
  assert.deepEqual(overBudget(at(200_001, 60_000)), ['code']);
  assert.deepEqual(overBudget(at(1, 60_001)), ['fonts']);
  assert.deepEqual(overBudget(at(250_000, 125_500)), ['code', 'fonts']);
});

// The CI gate (#306): the script itself, on a build in a folder, exits 1
// when a total is over its budget at either width, and 0 when both are in.
test('the script exits 1 on a build over budget, naming what is over, and 0 on one within it', () => {
  const run = (sizes) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'first-load-'));
    try {
      mkdirSync(path.join(dir, 'assets'));
      const html =
        '<!doctype html><html><head><script type="module" src="/assets/index-AAAAAAAA.js"></script></head></html>';
      writeFileSync(path.join(dir, 'index.html'), html);
      // Random bytes: gzip can't shrink them, so the size sent is the size written.
      const noise = (n) => Buffer.from(Array.from({ length: n }, () => (Math.random() * 256) | 0));
      writeFileSync(path.join(dir, 'assets', 'index-AAAAAAAA.js'), noise(sizes.script));
      writeFileSync(path.join(dir, 'assets', 'PhoneView-PPPPPPPP.js'), 'export{}');
      for (const face of FACES) {
        const name = face.replace(/\.woff2$/, '-FFFFFFFF.woff2');
        writeFileSync(path.join(dir, 'assets', name), noise(sizes.font));
      }
      writeFileSync(path.join(dir, 'logo.svg'), '<svg/>');
      return spawnSync(
        process.execPath,
        [path.join(ROOT, 'scripts/first-load.mjs'), '--dist', dir],
        {
          encoding: 'utf8',
        }
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const within = run({ script: 150_000, font: 25_000 });
  assert.equal(within.status, 0, within.stderr);
  const code = run({ script: 210_000, font: 25_000 });
  assert.equal(code.status, 1);
  assert.match(
    code.stderr,
    /Over the first-load budget \(spec §4\): code at 1440px, code at 390px/
  );
  const fonts = run({ script: 150_000, font: 31_000 });
  assert.equal(fonts.status, 1);
  assert.match(fonts.stderr, /fonts at 1440px, fonts at 390px/);
});

test("a desktop's first load (#578, #532): the Jobs section's and the rail's chunks and what only they import; a phone's never", () => {
  const build = fakeBuild();
  const files = {
    '/assets/OverviewJobs-OOOOOOOO.js':
      'import{a}from"./index-AAAAAAAA.js";import{j}from"./jobs-section-KKKKKKKK.js";',
    '/assets/jobs-section-KKKKKKKK.js': 'import{a}from"./index-AAAAAAAA.js";',
    '/assets/OverviewRail-RRRRRRRR.js':
      'import{a}from"./index-AAAAAAAA.js";import{u}from"./Utilities-UUUUUUUU.js";',
    '/assets/Utilities-UUUUUUUU.js': 'import{j}from"./jobs-section-KKKKKKKK.js";',
    '/assets/PhoneView-PPPPPPPP.js': 'import{a}from"./index-AAAAAAAA.js";',
  };
  const both = {
    ...build,
    assets: [
      ...build.assets,
      'OverviewJobs-OOOOOOOO.js',
      'jobs-section-KKKKKKKK.js',
      'OverviewRail-RRRRRRRR.js',
      'Utilities-UUUUUUUU.js',
      'PhoneView-PPPPPPPP.js',
    ],
    read: (url) => (files[url] ? Buffer.from(files[url]) : build.read(url)),
  };
  assert.deepEqual(DESKTOP_CHUNKS, ['OverviewJobs.js', 'OverviewRail.js']);
  const scripts = (report) => report.items.filter((i) => i.kind === 'script').map((i) => i.url);
  assert.deepEqual(scripts(firstLoad(both)), [
    '/assets/index-AAAAAAAA.js',
    '/assets/vendor-react-BBBBBBBB.js',
    '/register-sw.js',
    '/assets/OverviewJobs-OOOOOOOO.js',
    '/assets/jobs-section-KKKKKKKK.js',
    // A script both import is counted once.
    '/assets/OverviewRail-RRRRRRRR.js',
    '/assets/Utilities-UUUUUUUU.js',
  ]);
  assert.ok(
    !scripts(firstLoad(both, { phone: true })).some((u) =>
      /OverviewJobs|jobs-section|OverviewRail|Utilities/.test(u)
    )
  );
  // A build without them counts what it has.
  assert.deepEqual(scripts(firstLoad(build)), [
    '/assets/index-AAAAAAAA.js',
    '/assets/vendor-react-BBBBBBBB.js',
    '/register-sw.js',
  ]);
});
