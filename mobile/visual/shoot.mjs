/**
 * Dev tool. Requires Playwright available to require() — run with
 * NODE_PATH=/tmp/shotter/node_modules (or your own `npm i -D playwright`, not committed).
 * Not part of build/CI.
 *
 * Usage:
 *   cd mobile
 *   NODE_PATH=/tmp/shotter/node_modules node visual/shoot.mjs
 *
 * Produces: mobile/visual/out/<state>.png (gitignored)
 */
import { createRequire } from 'module';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

// Resolve playwright via NODE_PATH (not a dev dependency in mobile/package.json).
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const OUT = fileURLToPath(new URL('./out/', import.meta.url));
const MOBILE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const VITE_CONFIG = fileURLToPath(new URL('../vite.config.mobile.js', import.meta.url));

// States to shoot: each is a ?state= value recognised by mount.jsx
const STATES = [
  'overview-calm',
  'overview-degraded',
  'overview-multi',
  'services-down',
  'node-detail',
  'incident-detail',
  'alerts-multi',
  'infra-calm',
];

// Start Vite dev server (reuse mobile's vite config so @shared alias + React plugin work)
const server = await createServer({
  configFile: VITE_CONFIG,
  root: MOBILE_ROOT,
  server: { port: 5199, strictPort: true },
  // Override build outDir so a stale `vite preview` can't conflict
  build: { outDir: 'dist' },
});
await server.listen();
console.log('Vite dev server listening on http://localhost:5199');

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});

for (const state of STATES) {
  const url = `http://localhost:5199/visual/render.html?state=${encodeURIComponent(state)}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(1000);
  const outPath = `${OUT}${state}.png`;
  await page.screenshot({ path: outPath, fullPage: true });
  console.log('shot', state);
}

await browser.close();
await server.close();
console.log('SHOTS_DONE');
process.exit(0);
