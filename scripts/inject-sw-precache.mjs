// Post-build step: fill the service worker's PRECACHE_ASSETS list with the
// content-hashed first-paint bundles, and stamp APP_VERSION from package.json.
//
// Run after `vite build` (wired into the `build` npm script). The hashed asset
// filenames are only known after the bundle is built, so this rewrites the
// built copy at dist/sw.js — the source public/sw.js keeps inert placeholders.
//
// Pure helpers are exported and unit-tested; main() does the file I/O and only
// runs when the script is invoked directly.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Extract the eager first-paint build assets referenced by the built index.html:
 * the entry script, its modulepreloaded vendor chunks, and stylesheet links
 * under /assets/. These are what the app shell needs to boot offline; lazy async
 * chunks (e.g. the Settings tabs) are left to be runtime-cached on first use.
 * Pure — no I/O.
 */
export function extractPrecacheAssets(html) {
  const urls = new Set();
  const re = /(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g;
  let m;
  while ((m = re.exec(html)) !== null) urls.add(m[1]);
  return [...urls].sort();
}

/**
 * Inject the precache list + version into a service-worker source by replacing
 * the `PRECACHE_ASSETS = []` placeholder and the `APP_VERSION` literal. Returns
 * the rewritten source; leaves anything it can't find untouched (never throws).
 */
export function injectIntoSw(swSource, assets, version) {
  // Use replacement FUNCTIONS, not strings: a string replacement interprets
  // `$&`/`$1`/`$$` as match back-references, which would corrupt the output if
  // an asset path ever contained one. A function inserts the value verbatim.
  return swSource
    .replace(/const PRECACHE_ASSETS = \[\];/, () => `const PRECACHE_ASSETS = ${JSON.stringify(assets)};`)
    .replace(/const APP_VERSION = '[^']*';/, () => `const APP_VERSION = '${version}';`);
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const htmlPath = resolve(root, 'dist', 'index.html');
  const swPath = resolve(root, 'dist', 'sw.js');
  if (!existsSync(htmlPath) || !existsSync(swPath)) {
    console.error('[sw] dist/index.html or dist/sw.js missing — run `vite build` first.');
    process.exit(1);
  }
  const html = readFileSync(htmlPath, 'utf8');
  const assets = extractPrecacheAssets(html);
  // Fail loud if the HTML clearly references hashed bundles but we extracted
  // none — a silent empty precache (e.g. after a Vite `base` change makes paths
  // no longer start with /assets/) would ship a broken offline shell otherwise.
  if (/(?:src|href)="\/assets\//.test(html) && assets.length === 0) {
    console.error('[sw] index.html references /assets/ but none were extracted — refusing to ship an empty precache.');
    process.exit(1);
  }
  const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
  writeFileSync(swPath, injectIntoSw(readFileSync(swPath, 'utf8'), assets, version));
  console.log(`[sw] precaching ${assets.length} build asset(s); version ${version}`);
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
