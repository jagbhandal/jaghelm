/*
 * The Android app's screens (#546, mobile/visual/, docs/mobile/DESIGN.md
 * "Android screenshots"): the app as the APK runs it, each screen in each state
 * #303 has to keep, at 390 × 844, against its committed baseline in
 * mobile/visual/baselines/, pixel for pixel.
 *
 * The same runner as the gallery (playwright.config.mjs) and the shell's
 * browser tests: only inside the pinned Playwright container, in CI's gallery
 * job and locally (`npm run test:android-shots`), with the same Chromium
 * flags (and one more, below), a frozen clock, a fixed time zone and locale,
 * reduced motion, no retries and a threshold of 0. What differs is the app:
 * the Android build (mobile/vite.config.mobile.js, through
 * mobile/visual/vite.config.visual.js), from mobile/'s own packages, on a
 * phone's viewport with touch.
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { defineConfig } from '@playwright/test';
import { GALLERY_IMAGE, IMAGE_ENV } from './gallery/container.mjs';

if (process.env[IMAGE_ENV] !== GALLERY_IMAGE || !existsSync('/ms-playwright')) {
  throw new Error(
    "The Android screens render only in the gallery's pinned container, so their " +
      'screenshots match the baselines: run `npm run test:android-shots`. See docs/mobile/DESIGN.md.'
  );
}
if (!existsSync('mobile/node_modules/vite')) {
  throw new Error(
    "The Android screens build with the app's own packages: run `npm --prefix mobile ci` first."
  );
}

// A free port, picked once in the main process and inherited by the workers.
const PORT_ENV = 'JH_ANDROID_PORT';
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
const PORT = Number(process.env[PORT_ENV]);

export default defineConfig({
  testDir: 'mobile/visual',
  testMatch: '*.spec.mjs',
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  outputDir: 'test-results/android',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: '50%',
  reporter: process.env.CI ? [['line']] : [['list']],
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
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: 'en-GB',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    forcedColors: 'none',
    serviceWorkers: 'block',
    // The page's CSP allows requests to its own origin only: on the phone the
    // app's requests leave through native HTTP, which it doesn't govern. Here
    // they are fetches to the stubbed server's address, answered in the test.
    bypassCSP: true,
    launchOptions: {
      args: [
        '--disable-skia-runtime-opts',
        '--force-color-profile=srgb',
        '--disable-lcd-text',
        '--font-render-hinting=none',
        // Every tile rastered whole, never patched over a part rastered
        // earlier: otherwise a screen's first paint can stick, by how busy the
        // machine is, with corners a level or two off (the Services chips').
        '--disable-partial-raster',
      ],
    },
  },
  webServer: {
    cwd: 'mobile',
    command:
      'npx vite build --config visual/vite.config.visual.js --logLevel warn && ' +
      `npx vite preview --config visual/vite.config.visual.js --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
