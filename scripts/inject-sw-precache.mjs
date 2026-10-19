// Post-build step: fill the service worker's PRECACHE_ASSETS list with the
// content-hashed first-paint bundles, its BUILD_ASSETS list with every file in
// dist/assets, and stamp APP_VERSION from package.json.
//
// Run after `vite build` (wired into the `build` npm script). The hashed asset
// filenames are only known after the bundle is built, so this rewrites the
// built copy at dist/sw.js — the source public/sw.js keeps inert placeholders.
//
// Pure helpers are exported and unit-tested; main() does the file I/O and only
// runs when the script is invoked directly.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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
 * The build's asset list: every file Vite wrote to dist/assets (lazy chunks
 * included), as the sorted /assets/ URL paths the worker caches them under. The
 * worker's activate trims cached /assets/ files missing from it, which by
 * construction are an earlier build's. Pure: takes the file paths relative to
 * dist/assets.
 */
export function listBuildAssets(files) {
  return files.map((file) => `/assets/${file}`).sort();
}

/**
 * Why a build asset list can't ship, or null when it can. An empty list would
 * make the worker trim every cached /assets/ file, and a precached bundle missing
 * from it would be trimmed again right after install. Pure.
 */
export function buildAssetsProblem(precache, buildAssets) {
  if (buildAssets.length === 0) return 'dist/assets has no files';
  const missing = precache.filter((path) => !buildAssets.includes(path));
  if (missing.length > 0) return `precached bundle(s) missing from dist/assets: ${missing.join(', ')}`;
  return null;
}

/**
 * Inject the precache list, the build asset list and the version into a
 * service-worker source by replacing the `PRECACHE_ASSETS = []` and
 * `BUILD_ASSETS = []` placeholders and the `APP_VERSION` literal. Returns the
 * rewritten source; leaves anything it can't find untouched (never throws).
 */
export function injectIntoSw(swSource, assets, version, buildAssets = []) {
  // Use replacement FUNCTIONS, not strings: a string replacement interprets
  // `$&`/`$1`/`$$` as match back-references, which would corrupt the output if
  // an asset path ever contained one. A function inserts the value verbatim.
  return swSource
    .replace(/const PRECACHE_ASSETS = \[\];/, () => `const PRECACHE_ASSETS = ${JSON.stringify(assets)};`)
    .replace(/const BUILD_ASSETS = \[\];/, () => `const BUILD_ASSETS = ${JSON.stringify(buildAssets)};`)
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
  // Recursive in case Vite ever nests a folder under assets/; only files are URLs.
  const assetsDir = resolve(root, 'dist', 'assets');
  const files = existsSync(assetsDir)
    ? readdirSync(assetsDir, { recursive: true }).filter((file) => statSync(resolve(assetsDir, file)).isFile())
    : [];
  const buildAssets = listBuildAssets(files);
  const problem = buildAssetsProblem(assets, buildAssets);
  if (problem) {
    console.error(`[sw] ${problem} — refusing to ship a worker that would trim the current build.`);
    process.exit(1);
  }
  const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
  writeFileSync(swPath, injectIntoSw(readFileSync(swPath, 'utf8'), assets, version, buildAssets));
  console.log(
    `[sw] precaching ${assets.length} of ${buildAssets.length} build asset(s); version ${version}`
  );
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
