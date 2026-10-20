/**
 * The component gallery (#289, docs/GALLERY.md) stays out of production, and
 * its container stays pinned in one place.
 *
 *  - The production build (vite.config.js, as `npm run build` runs it) emits
 *    index.html alone and carries no gallery code or route; the gallery's own
 *    build does carry them, so the markers looked for are real.
 *  - The Playwright version, the container image CI's gallery job runs in and
 *    the one `npm run gallery:test` runs agree (gallery/container.mjs).
 *  - The gallery draws with the production stylesheet unchanged, which holds
 *    only the classes src/ui/ uses, so the few classes it writes itself must
 *    be among them (anything else would compile to nothing there).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { build } from 'vite';
import { GALLERY_IMAGE, IMAGE_ENV, PLAYWRIGHT_VERSION } from '../gallery/container.mjs';
import { READY_ATTRIBUTE, STATE_ATTRIBUTE } from '../gallery/catalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

// Strings only gallery code holds: its page's attributes, one of its errors and
// one of its states' words.
const MARKERS = [
  READY_ATTRIBUTE,
  STATE_ATTRIBUTE,
  'gallery: no state',
  'Paperless-ngx document archive',
];

/** Every file under `dir`, relative to it. */
function files(dir, rel = '') {
  return readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(dir, path.join(rel, e.name)) : [path.join(rel, e.name)]
  );
}

/** Builds with `configFile` into a temporary folder; returns its files and their text. */
async function built(configFile) {
  const outDir = mkdtempSync(path.join(tmpdir(), 'jh-gallery-build-'));
  try {
    await build({
      root: ROOT,
      configFile: path.join(ROOT, configFile),
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    });
    const list = files(outDir);
    const text = list
      .filter((f) => /\.(html|js|css|json|webmanifest|txt)$/.test(f))
      .map((f) => readFileSync(path.join(outDir, f), 'utf8'))
      .join('\n');
    return { list, text };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

test('the production build has no gallery page, code or route', async () => {
  const { list, text } = await built('vite.config.js');
  assert.deepEqual(
    list.filter((f) => f.endsWith('.html')),
    ['index.html'],
    'the only page is the app'
  );
  assert.deepEqual(
    list.filter((f) => /gallery/i.test(f)),
    [],
    'no file named for the gallery'
  );
  for (const marker of MARKERS) {
    assert.ok(!text.includes(marker), `the production build carries "${marker}"`);
  }
});

test("the gallery's own build carries the markers the production check looks for", async () => {
  const { list, text } = await built('vite.gallery.config.js');
  assert.ok(list.includes(path.join('gallery', 'index.html')), list.join(', '));
  for (const marker of MARKERS) assert.ok(text.includes(marker), `"${marker}" is not in it`);
});

test('the Playwright version and the container image agree everywhere', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const name of ['@playwright/test', 'playwright-core']) {
    assert.equal(pkg.devDependencies[name], PLAYWRIGHT_VERSION, `${name} in package.json`);
  }
  const lock = JSON.parse(read('package-lock.json'));
  for (const name of ['playwright', 'playwright-core', '@playwright/test']) {
    assert.equal(lock.packages[`node_modules/${name}`]?.version, PLAYWRIGHT_VERSION, name);
  }
  assert.match(
    GALLERY_IMAGE,
    new RegExp(`^mcr\\.microsoft\\.com/playwright:v${PLAYWRIGHT_VERSION}-noble@sha256:[0-9a-f]{64}$`),
    'an exact tag, pinned by digest'
  );
  const job = yaml.load(read('.gitea/workflows/check.yml')).jobs.gallery;
  assert.ok(job, 'check.yml has a gallery job');
  assert.equal(job.container.image, GALLERY_IMAGE, "the gallery job's container");
  assert.equal(job.env[IMAGE_ENV], GALLERY_IMAGE, `the gallery job's ${IMAGE_ENV}`);
});

test('the classes the gallery writes are ones the production stylesheet has', () => {
  const ui = readdirSync(path.join(ROOT, 'src/ui'))
    .filter((f) => /\.jsx?$/.test(f) && !/\.test\./.test(f))
    .map((f) => read(`src/ui/${f}`))
    .join('\n');
  const used = new Set();
  for (const f of readdirSync(path.join(ROOT, 'gallery')).filter((f) => /\.jsx?$/.test(f))) {
    for (const [, classes] of read(`gallery/${f}`).matchAll(/className="([^"]*)"/g)) {
      for (const c of classes.split(/\s+/).filter(Boolean)) used.add(c);
    }
  }
  assert.ok(used.size > 0, 'expected a few classes in the gallery');
  const escape = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const c of used) {
    assert.match(ui, new RegExp(`['"\`\\s]${escape(c)}['"\`\\s]`), `${c} is not used in src/ui/`);
  }
});
