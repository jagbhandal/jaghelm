#!/usr/bin/env node
/**
 * Runs the component gallery's Playwright tests in their pinned container
 * (gallery/container.mjs), the one CI uses, so a local run draws the same
 * pixels as CI's (docs/GALLERY.md):
 *
 *   npm run gallery:test                  screenshots and axe, as CI runs them
 *   npm run gallery:update                rewrite the baselines that changed
 *                                         and add new ones, then drop the
 *                                         ones no variant has any more
 *   npm run gallery:test -- -g dialog     extra arguments go to Playwright
 *   npm run test:e2e                      the app shell's browser tests (e2e/),
 *                                         in the same container
 *                                         (--config playwright.e2e.config.mjs)
 *
 * It mounts this checkout and uses its node_modules (`npm ci` first), so it
 * needs Docker on a Linux x64 machine, as CI's runner: the native build tools
 * in node_modules are the host's, and Chromium draws on the same CPU family as
 * CI. Files are written as the calling user.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GALLERY_IMAGE, IMAGE_ENV } from '../gallery/container.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINES = path.join(ROOT, 'gallery', 'baselines');

const [mode, ...rest] = process.argv.slice(2);
if (mode !== 'test' && mode !== 'update') {
  console.error('usage: node scripts/gallery.mjs test|update [playwright arguments]');
  process.exit(2);
}
if (process.platform !== 'linux' || process.arch !== 'x64') {
  console.error(
    `The gallery runs on Linux x64, as CI does (this is ${process.platform} ${process.arch}).`
  );
  process.exit(2);
}
if (!existsSync(path.join(ROOT, 'node_modules', '@playwright', 'test'))) {
  console.error("Run `npm ci` first: the container uses this checkout's node_modules.");
  process.exit(2);
}

const update = mode === 'update';

if (update && rest.length === 0 && existsSync(BASELINES)) {
  // First drop the baselines of variants that are gone (a state renamed or
  // removed), which the tests would otherwise report as stale.
  const { VARIANTS } = await import('../gallery/catalog.js');
  const keep = new Set(VARIANTS.map((v) => `${v.id}.png`));
  for (const file of readdirSync(BASELINES)) {
    if (file.endsWith('.png') && !keep.has(file)) {
      rmSync(path.join(BASELINES, file));
      console.log(`removed the baseline of a variant that is gone: gallery/baselines/${file}`);
    }
  }
}

const args = [
  'run',
  '--rm',
  '--init',
  '--user',
  `${process.getuid()}:${process.getgid()}`,
  '-e',
  'HOME=/tmp',
  '-e',
  `${IMAGE_ENV}=${GALLERY_IMAGE}`,
  '-e',
  'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1',
  '-e',
  'NPM_CONFIG_UPDATE_NOTIFIER=false',
  // CI=1 runs it as CI does: nothing written, a missing baseline fails.
  '-e',
  'CI',
  '-v',
  `${ROOT}:/work`,
  '-w',
  '/work',
  GALLERY_IMAGE,
  'npx',
  'playwright',
  'test',
  ...(update ? ['--update-snapshots=changed'] : []),
  ...rest,
];
const run = spawnSync('docker', args, { stdio: 'inherit' });
if (run.error) {
  console.error(`Couldn't start Docker: ${run.error.message}`);
  process.exit(2);
}

process.exit(run.status ?? 1);
