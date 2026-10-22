/*
 * The first load in a real browser (#444), on the incident fixture at 1440px:
 *
 *  - the first screen fetches exactly what scripts/first-load.mjs counts, the
 *    app's data aside: so the script's total is what a person downloads, and
 *    no face of a retired theme comes back unnoticed;
 *  - the floating layer (src/ui/lib/floating.jsx) is not among it: it comes
 *    with the first input;
 *  - a tooltip focused by keyboard before the layer has come opens once it
 *    has, on the trigger that kept focus, placed by that trigger from the
 *    first frame it shows in (never drawn unplaced first).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { WIDTHS, openApp } from './app.mjs';
import { E2E_OUT_DIR } from '../playwright.e2e.config.mjs';
import { firstLoad } from '../scripts/first-load.mjs';

const LAYER = /\/assets\/layer-[\w-]+\.js$/;

test.use({ viewport: WIDTHS.desktop });

/** What the first load script counts for the build these tests run on. */
function counted() {
  const report = firstLoad({
    html: readFileSync(join(E2E_OUT_DIR, 'index.html'), 'utf8'),
    assets: readdirSync(join(E2E_OUT_DIR, 'assets')),
    read: (url) => readFileSync(join(E2E_OUT_DIR, url)),
  });
  return report.items.map((i) => (i.url === '/index.html' ? '/' : i.url)).sort();
}

test('the first screen fetches what scripts/first-load.mjs counts, and the floating layer only on input', async ({
  page,
}) => {
  const origin = new URL(test.info().project.use.baseURL).origin;
  const fetched = new Set();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin) return;
    if (/^\/(api|embedded)\//.test(url.pathname)) return;
    fetched.add(url.pathname);
  });
  await openApp(page);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  expect(
    [...fetched].sort(),
    'the first screen fetches what scripts/first-load.mjs counts: update its list (FACES, ' +
      'LEGACY_FACES, LOGO) when the first screen draws something else'
  ).toEqual(counted());
  expect([...fetched].some((path) => LAYER.test(path))).toBe(false);

  const layer = page.waitForRequest(LAYER);
  await page.mouse.move(400, 300);
  await layer;
});

test('a tooltip focused before the layer comes opens once it has, placed from its first frame', async ({
  page,
}) => {
  let arrive;
  const held = new Promise((resolve) => {
    arrive = resolve;
  });
  let asked = false;
  await page.route(LAYER, async (route) => {
    asked = true;
    await held;
    await route.continue();
  });
  await openApp(page);
  const settings = page.getByRole('banner').getByRole('link', { name: 'Settings' });
  // The first key press asks for the layer, which is held back; Tab on until
  // the Settings link, a tooltip's trigger, has focus.
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if (await settings.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(settings).toBeFocused();
  expect(asked).toBe(true);
  await expect(page.locator('[data-slot="tooltip"]')).toHaveCount(0);

  // Every frame from the one the tooltip first shows in: where it is.
  await page.evaluate(() => {
    window.__tipFrames = [];
    const tick = () => {
      const tip = document.querySelector('[data-slot="tooltip"]');
      if (tip) {
        const r = tip.getBoundingClientRect();
        window.__tipFrames.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
      }
      if (window.__tipFrames.length < 8) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  arrive();

  const tip = page.locator('[data-slot="tooltip"]');
  await expect(tip).toHaveText('Settings');
  await expect(settings).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__tipFrames.length)).toBe(8);
  const at = await settings.boundingBox();
  const frames = await page.evaluate(() => window.__tipFrames);
  for (const f of frames) {
    // Beside the trigger, 6px off it above or below, and across its middle.
    const gap = Math.min(Math.abs(at.y - f.bottom), Math.abs(f.top - (at.y + at.height)));
    expect(gap, JSON.stringify({ frame: f, trigger: at })).toBeLessThanOrEqual(8);
    const middle = at.x + at.width / 2;
    expect(f.left).toBeLessThan(middle);
    expect(f.right).toBeGreaterThan(middle);
  }
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await expect(settings).toBeFocused();
});
