/*
 * The top of the Overview on a phone, in a real browser (#484, spec §8 "Phone
 * width"): below 768px the attention panel is drawn in two parts with the
 * subsystem strip between them, as the Phone board orders it (status card,
 * strip, issue list), so a real incident's rows can't push the strip below
 * the fold. The board is the demo's incident with four more services down
 * (sixIssueIncident, src/testing/statusFixtures.js, built through the model),
 * six issues, answered in place of the demo's /api/status and /api/services.
 *
 *  - At 360 × 780 and 390 × 844: the strip fully on screen at scroll 0, under
 *    the panel's heading, and every issue row under the strip; the focus goes
 *    from "All alerts" to each tile, then to each row; axe finds nothing.
 *  - No signal on the split: no red, amber or green anywhere in the status
 *    area, every lamp the steel ring, the strip still between (#480's rule).
 *  - At 800 (a tablet) and 1440: one panel, its rows in it, the strip under
 *    it, as before.
 *  - Screenshots of the split, the quiet line and No signal, at both phone
 *    widths, dark and light, for the PR, in test-results/e2e/shots/.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { axeFindings, openApp, statusHues } from './app.mjs';
import { sixIssueIncident } from '../src/testing/statusFixtures.js';

const PHONES = {
  360: { width: 360, height: 780 },
  390: { width: 390, height: 844 },
};
const WIDER = {
  tablet: { width: 800, height: 1024 },
  desktop: { width: 1440, height: 900 },
};

const statusArea = (page) => page.locator('[data-slot="overview-status"]');
const panel = (page) => statusArea(page).getByRole('region', { name: 'Needs attention' });
const header = (page) => panel(page).locator('[data-slot="attention-panel-header"]');
const strip = (page) => statusArea(page).getByRole('region', { name: 'Subsystems' });
const rows = (page) => statusArea(page).locator('[data-slot="issue-row"]');
const allAlerts = (page) => statusArea(page).getByRole('link', { name: /^All alerts/ });

/** The Overview on the six-issue incident, the board under it loaded, so nothing moves. */
async function openSix(page, { theme = 'dark', clock = false } = {}) {
  if (clock) await page.clock.install();
  const board = sixIssueIncident();
  const server = await openApp(page, '/', {
    theme,
    answers: { '/api/status': board.status, '/api/services': board.services },
  });
  await expect(page.locator('.section-title', { hasText: 'Network Edge' })).toBeVisible();
  await expect(rows(page)).toHaveCount(6);
  await expect(strip(page)).toBeVisible();
  return server;
}

/** The part of the window nothing covers: under the sticky header, above the phone's tabs. */
function clearArea(page) {
  return page.evaluate(() => {
    const top = document.querySelector('[data-slot="app-header"]').getBoundingClientRect();
    const tabs = document.querySelector('[data-slot="bottom-tabs"]')?.getBoundingClientRect();
    const tabsTop = tabs && tabs.height > 0 ? tabs.top : window.innerHeight;
    return { top: top.bottom, bottom: Math.min(window.innerHeight, tabsTop), width: innerWidth };
  });
}

const bottom = (box) => box.y + box.height;

for (const [width, viewport] of Object.entries(PHONES)) {
  test.describe(`the Overview at ${width} × ${viewport.height}, six issues`, () => {
    test.use({ viewport });

    test('the strip is fully on screen without scrolling, under the heading, the rows under it', async ({
      page,
    }) => {
      await openSix(page);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await expect(panel(page)).toHaveAttribute('data-layout', 'split');
      await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(
        'Critical · 6 critical'
      );

      const area = await clearArea(page);
      const box = await strip(page).boundingBox();
      expect(box.y, 'the strip: under the header').toBeGreaterThanOrEqual(area.top);
      expect(bottom(box), 'the strip: above the fold').toBeLessThanOrEqual(area.bottom);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(area.width);
      for (const tile of await strip(page).getByRole('button').all()) {
        const t = await tile.boundingBox();
        expect(t.y, 'a tile: on screen').toBeGreaterThanOrEqual(area.top);
        expect(bottom(t), 'a tile: above the fold').toBeLessThanOrEqual(area.bottom);
      }

      const head = await header(page).boundingBox();
      expect(bottom(head), 'the heading’s card above the strip').toBeLessThanOrEqual(box.y);
      const all = await rows(page).all();
      expect(all).toHaveLength(6);
      for (const [i, row] of all.entries()) {
        const r = await row.boundingBox();
        expect(r.y, `issue ${i + 1}: under the strip`).toBeGreaterThanOrEqual(bottom(box));
      }
    });

    test('the focus goes header, strip, rows: All alerts, each tile, then each row', async ({
      page,
    }) => {
      await openSix(page);
      const order = [
        allAlerts(page),
        ...(await strip(page).getByRole('button').all()),
        ...(await rows(page).all()),
      ];
      expect(order.length).toBeGreaterThan(8);
      await order[0].focus();
      for (const el of order.slice(1)) {
        await page.keyboard.press('Tab');
        await expect(el).toBeFocused();
      }
      // And back up the same way.
      for (const el of order.slice(0, -1).reverse()) {
        await page.keyboard.press('Shift+Tab');
        await expect(el).toBeFocused();
      }
    });

    for (const theme of ['dark', 'light']) {
      test(`axe finds nothing in the split, ${theme}`, async ({ page }) => {
        await openSix(page, { theme });
        expect(
          await axeFindings(new AxeBuilder({ page }).include('[data-slot="overview-status"]'))
        ).toEqual([]);
      });
    }

    test('No signal: the split stays steel, every lamp the ring, the strip still between', async ({
      page,
    }) => {
      const server = await openSix(page, { clock: true });
      const fresh = await statusHues(statusArea(page));
      expect(fresh.found).toContainEqual(expect.objectContaining({ hue: 'red' }));

      server.down = true;
      await page.clock.runFor(30_000);
      await expect(panel(page)).toHaveAttribute('data-state', 'unknown');
      await expect(panel(page)).toHaveAttribute('data-layout', 'split');
      await expect(panel(page).getByRole('heading', { level: 2 })).toContainText(
        'No signal · last known'
      );
      const { found, unread, lamps } = await statusHues(statusArea(page));
      expect(unread).toEqual([]);
      expect(found, 'red, amber or green in the status area').toEqual([]);
      expect(lamps.length).toBeGreaterThan(6);
      expect(lamps.filter((l) => l.state !== 'unknown')).toEqual([]);
      const box = await strip(page).boundingBox();
      expect(bottom(await header(page).boundingBox())).toBeLessThanOrEqual(box.y);
      for (const row of await rows(page).all())
        expect((await row.boundingBox()).y).toBeGreaterThanOrEqual(bottom(box));
    });

    for (const theme of ['dark', 'light']) {
      test(`screenshots for the PR, ${theme}: the split, then No signal`, async ({ page }) => {
        const dir = join(test.info().project.outputDir, 'shots');
        mkdirSync(dir, { recursive: true });
        const server = await openSix(page, { theme, clock: true });
        await page.mouse.move(0, 0);
        await page.screenshot({ path: `${dir}/phone-split-incident-${width}-${theme}.png` });
        server.down = true;
        await page.clock.runFor(30_000);
        await expect(panel(page)).toHaveAttribute('data-state', 'unknown');
        await page.screenshot({ path: `${dir}/phone-split-no-signal-${width}-${theme}.png` });
      });

      test(`a screenshot for the PR, ${theme}: the quiet line, the strip under it`, async ({
        page,
      }) => {
        const dir = join(test.info().project.outputDir, 'shots');
        mkdirSync(dir, { recursive: true });
        await openApp(page, '/', { theme, scenario: 'healthy' });
        const line = statusArea(page).getByRole('region', { name: 'Status' });
        await expect(line).toBeVisible();
        await expect(page.locator('.section-title', { hasText: 'Network Edge' })).toBeVisible();
        // Right under it, 24px down, as from 768px.
        const gap = (await strip(page).boundingBox()).y - bottom(await line.boundingBox());
        expect(gap).toBeCloseTo(24, 0);
        await page.mouse.move(0, 0);
        await page.screenshot({ path: `${dir}/phone-split-healthy-${width}-${theme}.png` });
      });
    }
  });
}

for (const [name, viewport] of Object.entries(WIDER)) {
  test.describe(`the Overview at ${viewport.width} × ${viewport.height} (${name}), six issues`, () => {
    test.use({ viewport });

    test('one panel, its rows in it, the strip under it, as before', async ({ page }) => {
      await openSix(page);
      await expect(panel(page)).not.toHaveAttribute('data-layout', 'split');
      await expect(header(page)).toHaveCount(0);
      await expect(panel(page).locator('[data-slot="issue-row"]')).toHaveCount(6);
      await expect(panel(page).getByRole('region', { name: 'Subsystems' })).toHaveCount(0);
      const box = await panel(page).boundingBox();
      expect((await strip(page).boundingBox()).y, 'the strip under the panel').toBeGreaterThan(
        bottom(box)
      );
    });
  });
}
