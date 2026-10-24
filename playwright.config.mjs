/*
 * The component gallery's tests (#289, docs/GALLERY.md): a screenshot of every
 * state against its committed baseline, and axe on it, in Chromium.
 *
 * Deterministic by construction, so a baseline is exact and a diff is real:
 *
 *  - Only inside the pinned Playwright container (gallery/container.mjs), in CI
 *    and locally (`npm run gallery:test`): one Chromium build, one set of
 *    system libraries and fonts. Run anywhere else, this config refuses.
 *  - Chromium's flags, shared with the shell's tests
 *    (CHROMIUM_ARGS, gallery/container.mjs): Skia's CPU-specific code paths
 *    off, so two machines with different CPUs draw the same pixels; sRGB
 *    colour, no LCD (subpixel) text, no hinting; every tile rastered whole.
 *  - Only self-hosted fonts: the page loads JagHelm's own woff2 files and waits
 *    for them; a request to any other origin is aborted and fails the test.
 *  - Reduced motion (the base style cuts every transition and animation in a
 *    .jh-ui root to nothing), animations off for the shot, the caret hidden.
 *  - A frozen clock (Date), a fixed time zone and locale, a fixed viewport at
 *    a device scale of 1.
 *  - Its own server on a free port per run, so runs side by side never meet.
 *  - No retries: a state that only passes the second time is a bug.
 *  - Exact comparison: a threshold of 0 and no pixel allowance.
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { defineConfig } from '@playwright/test';
import { CHROMIUM_ARGS, GALLERY_IMAGE, IMAGE_ENV } from './gallery/container.mjs';

if (process.env[IMAGE_ENV] !== GALLERY_IMAGE || !existsSync('/ms-playwright')) {
  throw new Error(
    'The gallery renders only in its pinned container, so its screenshots match the ' +
      'baselines: run `npm run gallery:test` (or `npm run gallery:update`). See docs/GALLERY.md.'
  );
}

// The gallery's server takes a free port, picked once per run in the main
// process and handed to the workers through the environment, which they
// inherit. A fixed port collided when two runs shared a network (CI's runner
// runs several jobs in one network namespace): one run failed at random, or
// tested the other's build. `strictPort` (vite.gallery.config.js) and no
// reused server make a lost race fail loudly rather than test another build.
const PORT_ENV = 'JH_GALLERY_PORT';
if (!process.env[PORT_ENV]) {
  process.env[PORT_ENV] = String(
    await new Promise((resolve, reject) => {
      const probe = createServer().once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address();
        probe.close(() => resolve(port));
      });
    })
  );
}
export const PORT = Number(process.env[PORT_ENV]);

export default defineConfig({
  testDir: 'gallery',
  testMatch: '*.spec.mjs',
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  outputDir: 'test-results/gallery',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: '50%',
  reporter: process.env.CI
    ? [['line']]
    : [['list'], ['html', { open: 'never', outputFolder: 'test-results/gallery-report' }]],
  // In CI a missing or changed baseline fails; nothing is written.
  updateSnapshots: process.env.CI ? 'none' : 'missing',
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      threshold: 0,
      maxDiffPixels: 0,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  use: {
    browserName: 'chromium',
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 960, height: 600 },
    deviceScaleFactor: 1,
    locale: 'en-GB',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    forcedColors: 'none',
    serviceWorkers: 'block',
    launchOptions: { args: [...CHROMIUM_ARGS] },
  },
  webServer: {
    command: `npx vite build --config vite.gallery.config.js --logLevel warn && npx vite preview --config vite.gallery.config.js --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/gallery/index.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
