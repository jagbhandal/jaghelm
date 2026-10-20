/*
 * The app shell's browser tests (#296, e2e/): the production build served by
 * `vite preview`, every /api request answered in the test (the demo server's
 * own answers, and the status model's fixtures for /api/status), at phone and
 * desktop widths, with axe. docs/ARCHITECTURE.md §8 says what they cover.
 *
 * Like the gallery (playwright.config.mjs), they run only in the pinned
 * Playwright container, in CI's gallery job and locally (`npm run test:e2e`),
 * so the browser and its fonts are CI's; each run serves on a free port.
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { defineConfig } from '@playwright/test';
import { GALLERY_IMAGE, IMAGE_ENV } from './gallery/container.mjs';

if (process.env[IMAGE_ENV] !== GALLERY_IMAGE || !existsSync('/ms-playwright')) {
  throw new Error(
    "The shell's browser tests run only in the pinned Playwright container: run " +
      '`npm run test:e2e`. See docs/ARCHITECTURE.md §8.'
  );
}

// A free port, picked once in the main process and inherited by the workers.
const PORT_ENV = 'JH_E2E_PORT';
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

/** Where the build for these tests goes (git-ignored), apart from the real one. */
export const E2E_OUT_DIR = 'dist-e2e';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.mjs',
  outputDir: 'test-results/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: '50%',
  reporter: process.env.CI ? [['line']] : [['list']],
  expect: { timeout: 10_000 },
  use: {
    browserName: 'chromium',
    baseURL: `http://127.0.0.1:${PORT}`,
    deviceScaleFactor: 1,
    locale: 'en-GB',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    launchOptions: {
      args: [
        '--disable-skia-runtime-opts',
        '--force-color-profile=srgb',
        '--disable-lcd-text',
        '--font-render-hinting=none',
      ],
    },
  },
  webServer: {
    command:
      `npx vite build --outDir ${E2E_OUT_DIR} --emptyOutDir --logLevel warn && ` +
      `npx vite preview --outDir ${E2E_OUT_DIR} --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
