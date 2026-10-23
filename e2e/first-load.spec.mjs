/*
 * The first load in a real browser (#444), on the incident fixture at 1440px:
 *
 *  - the first screen fetches exactly what scripts/first-load.mjs counts, the
 *    app's data aside: so the script's total, CI's budget gate (#306), is
 *    what a person downloads, and no face of a retired theme comes back
 *    unnoticed; at 390px too, a phone's first screen (#303): the phone
 *    screens' chunk; then, once the browser is idle, the detail screens'
 *    chunk (#309), which the script lists apart;
 *  - the floating layer (src/ui/lib/floating.jsx) is not among it: it comes
 *    with the first input;
 *  - a trigger focused by keyboard before the layer has come keeps focus,
 *    the same element, when it comes; its tooltip opens on the next focus,
 *    placed by the trigger from the first frame it shows in (never drawn
 *    unplaced first).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { WIDTHS, openApp } from './app.mjs';
import { E2E_OUT_DIR } from '../playwright.e2e.config.mjs';
import { firstLoad } from '../scripts/first-load.mjs';

const LAYER = /\/assets\/layer-[\w-]+\.js$/;

test.use({ viewport: WIDTHS.desktop });

/** The first load script's report on the build these tests run on (a phone's, with `phone`). */
const reportOf = (options) =>
  firstLoad(
    {
      html: readFileSync(join(E2E_OUT_DIR, 'index.html'), 'utf8'),
      assets: readdirSync(join(E2E_OUT_DIR, 'assets')),
      read: (url) => readFileSync(join(E2E_OUT_DIR, url)),
    },
    options
  );

/** What the first load script counts for the build these tests run on (a phone's, with `phone`). */
function counted(options) {
  return reportOf(options)
    .items.map((i) => (i.url === '/index.html' ? '/' : i.url))
    .sort();
}

/** Every file of this origin the page fetches, the app's data and the embedded apps aside. */
function recordFetches(page) {
  const origin = new URL(test.info().project.use.baseURL).origin;
  const fetched = new Set();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin) return;
    if (/^\/(api|embedded)\//.test(url.pathname)) return;
    fetched.add(url.pathname);
  });
  return fetched;
}

test('at 390px, a phone, the first screen fetches what scripts/first-load.mjs counts for one (#303)', async ({
  page,
}) => {
  await page.setViewportSize(WIDTHS.phone);
  const fetched = recordFetches(page);
  await openApp(page);
  await expect(
    page.locator('[data-slot="phone-view"] [data-slot="attention-panel"]')
  ).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  // The detail screens come once the browser is idle (#309): listed apart.
  const idle = reportOf({ phone: true }).idle.map((i) => i.url);
  expect(idle.length).toBeGreaterThan(0);
  expect(
    [...fetched].filter((path) => !idle.includes(path)).sort(),
    "a phone's first screen fetches what scripts/first-load.mjs --phone counts"
  ).toEqual(counted({ phone: true }));
  expect([...fetched].some((path) => LAYER.test(path))).toBe(false);
  await expect
    .poll(() => idle.every((path) => fetched.has(path)), 'the details, once idle')
    .toBe(true);
});

test('the first screen fetches what scripts/first-load.mjs counts, and the floating layer only on input', async ({
  page,
}) => {
  const fetched = recordFetches(page);
  await openApp(page);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  expect(
    [...fetched].sort(),
    'the first screen fetches what scripts/first-load.mjs counts: update its list (FACES, ' +
      'LOGO, DESKTOP_CHUNK) when the first screen draws something else'
  ).toEqual(counted());
  expect([...fetched].some((path) => LAYER.test(path))).toBe(false);

  const layer = page.waitForRequest(LAYER);
  await page.mouse.move(400, 300);
  await layer;
});

test('a trigger focused before the layer comes keeps focus; its tooltip shows on the next focus, placed from its first frame', async ({
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
  await settings.evaluate((el) => {
    window.__focused = el;
  });

  // The layer comes: the focused link stays the same element, so focus never
  // moves and a screen reader hears nothing again; no tooltip yet.
  const loaded = page.waitForResponse(LAYER);
  arrive();
  await loaded;
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  expect(await page.evaluate(() => document.activeElement === window.__focused)).toBe(true);
  const tip = page.locator('[data-slot="tooltip"]');
  await expect(tip).toHaveCount(0);

  // Every frame from the one the tooltip first shows in: where it is.
  await page.evaluate(() => {
    window.__tipFrames = [];
    const tick = () => {
      const shown = document.querySelector('[data-slot="tooltip"]');
      if (shown) {
        const r = shown.getBoundingClientRect();
        window.__tipFrames.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
      }
      if (window.__tipFrames.length < 8) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // Away and back: Base UI's trigger now, and its tooltip opens on focus.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(settings).toBeFocused();
  await expect(tip).toHaveText('Settings');
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
