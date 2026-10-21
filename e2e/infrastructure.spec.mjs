/*
 * The Overview's Infrastructure section in a real browser (#299), at 1440 ×
 * 900, 390 × 844 and 360 × 780, dark and light, on two boards:
 *
 *  - healthy: the demo's healthy board;
 *  - incident: the demo's incident with its NAS (the storage node) at 94.6 %
 *    disk (src/testing/statusFixtures.js nasDiskIncident), built through the
 *    status model like the demo's own, so its /api/status and /api/services
 *    agree.
 *
 * Each: nothing in the section is cut off (no card or table frame outside the
 * window, no text wider or taller than its box) and the page doesn't scroll
 * sideways, in cards and in the table; axe finds nothing. Healthy, no red,
 * amber or green anywhere in the section but its small ok lamps, so every
 * meter is the accent's; the incident's amber is the NAS's word, its disk
 * meter and its reason, and nothing is red. A node's issue row leads to its
 * card. Screenshots of both boards in cards and table, at 1440 and 390, dark
 * and light, for the PR, in test-results/e2e/shots/.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { axeFindings, openApp, statusHues } from './app.mjs';
import { nasDiskIncident } from '../src/testing/statusFixtures.js';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
  narrow: { width: 360, height: 780 },
};

const section = (page) => page.locator('[data-slot="infrastructure-section"]');
// The user's colour for a node: its own, never a status, and only 10px (spec §5.2).
const SWATCH = '[data-slot="node-swatch"]';

/** Each swatch's size: 10 × 10. */
const swatchSizes = (page) =>
  section(page)
    .locator(SWATCH)
    .evaluateAll((all) =>
      all.map((el) => {
        const box = el.getBoundingClientRect();
        return `${Math.round(box.width)}×${Math.round(box.height)}`;
      })
    );
const card = (page, name) => section(page).getByRole('article', { name });

/** Opens the Overview on `board` ('healthy' or 'incident'), with the section drawn. */
async function openBoard(page, board, theme) {
  const nas = nasDiskIncident();
  const answers =
    board === 'incident' ? { '/api/status': nas.status, '/api/services': nas.services } : {};
  await openApp(page, '/', { scenario: board, theme, answers });
  await expect(section(page).getByRole('article').first()).toBeVisible();
  await expect(page.locator('.section-title', { hasText: 'Network Edge' })).toBeVisible();
  return nas;
}

/**
 * What the section cuts off: a card, or the table's frame, outside the window;
 * any text in it wider or taller than its box; and the page scrolling
 * sideways. The table's frame scrolls inside itself by design, so its own
 * width is not a cut.
 */
function clipping(page) {
  return section(page).evaluate((root) => {
    const out = [];
    const boxes = root.querySelectorAll('[data-slot="node-card"], [data-slot="table"]');
    for (const el of boxes) {
      const box = el.getBoundingClientRect();
      if (box.left < -0.5 || box.right > window.innerWidth + 0.5)
        out.push(`${el.dataset.slot}: outside the window`);
    }
    for (const el of root.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.classList.contains('sr-only') || el.closest('[data-slot="table"]') === el) continue;
      if (getComputedStyle(el).display === 'inline') continue;
      if (el.scrollWidth > el.clientWidth + 0.5 || el.scrollHeight > el.clientHeight + 0.5)
        out.push(`"${el.textContent.trim().slice(0, 40)}" cut off`);
    }
    if (document.documentElement.scrollWidth > window.innerWidth)
      out.push('the page scrolls sideways');
    return out;
  });
}

/** The section, and with `page` the whole Overview from the top, for the PR. */
async function shoot(page, file, { whole = false } = {}) {
  const dir = join(test.info().project.outputDir, 'shots');
  mkdirSync(dir, { recursive: true });
  await page.mouse.move(0, 0);
  // The phone's tabs are fixed over the page: out of the section's picture.
  const style = await page.addStyleTag({
    content: '[data-slot="bottom-tabs"] { visibility: hidden !important; }',
  });
  await section(page).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await section(page).screenshot({ path: `${dir}/${file}.png` });
  await style.evaluate((el) => el.remove());
  if (whole) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${dir}/${file}-page.png`, fullPage: true });
  }
}

for (const [size, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`the Infrastructure section at ${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport });

    for (const theme of ['dark', 'light']) {
      test(`healthy, ${theme}: nothing cut off, and every meter neutral`, async ({ page }) => {
        await openBoard(page, 'healthy', theme);
        expect(await clipping(page)).toEqual([]);
        const meters = section(page).locator('[data-slot="metric-meter"]');
        expect(await meters.count()).toBeGreaterThan(0);
        for (const m of await meters.all()) await expect(m).toHaveAttribute('data-state', 'ok');
        const { found, unread, lamps } = await statusHues(section(page), { skip: SWATCH });
        expect(unread).toEqual([]);
        expect(found, 'red, amber or green in the section').toEqual([]);
        expect(lamps.every((l) => l.size === 10 && l.state === 'ok')).toBe(true);
        const swatches = await swatchSizes(page);
        expect(swatches.length).toBeGreaterThan(0);
        expect(new Set(swatches)).toEqual(new Set(['10×10']));
        expect(
          await axeFindings(
            new AxeBuilder({ page }).include('[data-slot="infrastructure-section"]')
          )
        ).toEqual([]);
        if (size !== 'narrow')
          await shoot(page, `infrastructure-healthy-cards-${size}-${theme}`, { whole: true });

        await section(page).getByRole('radio', { name: 'Table' }).click();
        await expect(section(page).getByRole('table', { name: 'Nodes' })).toBeVisible();
        expect(await clipping(page)).toEqual([]);
        expect((await statusHues(section(page), { skip: SWATCH })).found).toEqual([]);
        expect(
          await axeFindings(
            new AxeBuilder({ page }).include('[data-slot="infrastructure-section"]')
          )
        ).toEqual([]);
        if (size !== 'narrow') await shoot(page, `infrastructure-healthy-table-${size}-${theme}`);
      });

      test(`incident, ${theme}: the NAS warns at 94 %, in amber only there; nothing cut off`, async ({
        page,
      }) => {
        await openBoard(page, 'incident', theme);
        const nas = card(page, 'Storage');
        await expect(nas).toHaveAttribute('data-state', 'warn');
        await expect(nas.locator('[data-slot="node-state"]')).toHaveText('Warning');
        const disk = nas.locator('[data-reading="disk"]');
        await expect(disk).toHaveAttribute('data-state', 'warn');
        await expect(disk).toHaveAttribute('aria-valuetext', '94%, warning above 90%');
        await expect(nas.locator('[data-slot="node-reason"]')).toHaveText(
          'Disk 94 % (warning above 90 %)'
        );
        expect(await clipping(page)).toEqual([]);

        const { found, unread } = await statusHues(section(page), { skip: SWATCH });
        expect(unread).toEqual([]);
        expect(
          found.filter((f) => f.hue !== 'amber'),
          'only amber'
        ).toEqual([]);
        const amber = found.map((f) => f.at);
        expect(amber).toEqual(
          expect.arrayContaining([
            expect.stringContaining('"Warning"'),
            expect.stringContaining('[meter-fill]'),
            expect.stringContaining('"94%"'),
            expect.stringContaining('[node-reason]'),
          ])
        );
        // All of it on the NAS's card.
        const onNas = await nas.evaluate((el) => el.textContent);
        for (const f of found) expect(onNas).toContain(f.text);
        expect(
          await axeFindings(
            new AxeBuilder({ page }).include('[data-slot="infrastructure-section"]')
          )
        ).toEqual([]);
        if (size !== 'narrow')
          await shoot(page, `infrastructure-incident-cards-${size}-${theme}`, { whole: true });

        await section(page).getByRole('radio', { name: 'Table' }).click();
        const table = section(page).getByRole('table', { name: 'Nodes' });
        const row = table.getByRole('row', { name: /^Storage/ });
        await expect(row.getByRole('cell').nth(3)).toHaveText('94%, warning');
        expect(await clipping(page)).toEqual([]);
        expect(
          await axeFindings(
            new AxeBuilder({ page }).include('[data-slot="infrastructure-section"]')
          )
        ).toEqual([]);
        if (size !== 'narrow') await shoot(page, `infrastructure-incident-table-${size}-${theme}`);
      });
    }

    test("a node's issue row brings its card into view, and focuses it", async ({ page }) => {
      await openBoard(page, 'incident', 'dark');
      const row = page
        .getByRole('region', { name: 'Needs attention' })
        .getByRole('link', { name: /^Storage, Warning/ });
      await expect(row).toHaveAttribute('href', '#entity-nodes/storage');
      await row.click();
      const nas = card(page, 'Storage');
      await expect(nas).toBeFocused();
      await expect(nas).toBeInViewport();
      const header = await page.locator('[data-slot="app-header"]').boundingBox();
      expect((await nas.boundingBox()).y, 'clear of the header').toBeGreaterThanOrEqual(
        header.y + header.height
      );
    });
  });
}

test.describe('the Nodes filter', () => {
  test.use({ viewport: VIEWPORTS.desktop });

  test('keeps the section; Services hides it', async ({ page }) => {
    await openBoard(page, 'incident', 'dark');
    const strip = page.getByRole('region', { name: 'Subsystems' });
    await strip.getByRole('button', { name: /^Nodes,/ }).click();
    await expect(page).toHaveURL(/\?subsystem=nodes$/);
    await expect(section(page)).toBeVisible();
    await strip.getByRole('button', { name: /^Services,/ }).click();
    await expect(section(page)).toHaveCount(0);
  });
});
