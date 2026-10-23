/*
 * The Overview's Infrastructure section in a real browser (#299), at 1440 ×
 * 900 and at 768 × 1024, the narrowest window that draws it (below 768px the
 * web draws the phone screens, #303, e2e/phone.spec.mjs), dark and light, on
 * two boards:
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
 * meter and its reason, and nothing is red. A node's issue row, and its
 * card, open its detail drawer (#309). Screenshots of both boards in cards and table, at 1440 and 768, dark
 * and light, for the PR, in test-results/e2e/shots/.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { axeFindings, openApp, statusHues } from './app.mjs';
import { nasDiskIncident } from '../src/testing/statusFixtures.js';
import { VIEW_PREF } from '../src/shell/infrastructureView.js';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
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

/**
 * Opens the Overview on `board` ('healthy' or 'incident'), with the section
 * drawn: in `view` when this browser kept one, under `config`.
 */
async function openBoard(page, board, theme, { view, config } = {}) {
  const nas = nasDiskIncident();
  const answers =
    board === 'incident' ? { '/api/status': nas.status, '/api/services': nas.services } : {};
  if (view) await page.addInitScript(([key, v]) => localStorage.setItem(key, v), [VIEW_PREF, view]);
  await openApp(page, '/', { scenario: board, theme, answers, config });
  await expect(section(page).getByRole('article').first()).toBeVisible();
  await expect(page.locator('[data-slot="node-card"]', { hasText: 'Network Edge' })).toBeVisible();
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

// A layout the old grid board saved (#306 removed it): each node panel 12 rows.
const OLD_LAYOUT = Object.fromEntries(
  [
    ['lg', 24],
    ['md', 20],
  ].map(([bp, cols]) => {
    const w = cols / 2;
    const at = (i, x, y, width, h, minH = 3) => ({ i, x, y, w: width, h, minW: 4, minH });
    return [
      bp,
      [
        at('node-edge', 0, 0, w, 12),
        at('node-apps', w, 0, w, 12),
        at('node-storage', 0, 12, cols, 12),
        at('pipeline', 0, 24, w, 7),
        at('cron-jobs', w, 24, w, 7),
        at('ups', 0, 31, w, 7),
        at('todos', w, 31, w, 7),
        at('quicklaunch', 0, 38, cols, 4, 2),
      ],
    ];
  })
);

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
        await shoot(page, `infrastructure-healthy-cards-${size}-${theme}`, { whole: true });

        // The table needs 720px of section: a tablet's draws the cards (below).
        if (size !== 'desktop') return;
        await section(page).getByRole('radio', { name: 'Table' }).click();
        await expect(section(page).getByRole('table', { name: 'Nodes' })).toBeVisible();
        expect(await clipping(page)).toEqual([]);
        expect((await statusHues(section(page), { skip: SWATCH })).found).toEqual([]);
        expect(
          await axeFindings(
            new AxeBuilder({ page }).include('[data-slot="infrastructure-section"]')
          )
        ).toEqual([]);
        await shoot(page, `infrastructure-healthy-table-${size}-${theme}`);
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
        await shoot(page, `infrastructure-incident-cards-${size}-${theme}`, { whole: true });

        if (size !== 'desktop') return;
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
        await shoot(page, `infrastructure-incident-table-${size}-${theme}`);
      });
    }

    if (size !== 'desktop') {
      test('the table chosen: the cards here, the NAS warning and its 94 % in view, no sideways scroll', async ({
        page,
      }) => {
        await openBoard(page, 'incident', 'dark', { view: 'table' });
        await expect(section(page)).toHaveAttribute('data-view', 'cards');
        await expect(section(page).getByRole('table')).toHaveCount(0);
        await expect(section(page).getByRole('radiogroup', { name: 'Node view' })).toHaveCount(0);
        const nas = card(page, 'Storage');
        const word = nas.locator('[data-slot="node-state"]');
        const disk = nas.locator('[data-reading="disk"]');
        await expect(word).toHaveText('Warning');
        await expect(disk).toHaveText(/94%/);
        for (const el of [word, disk]) {
          await el.scrollIntoViewIfNeeded();
          await expect(el).toBeInViewport({ ratio: 1 });
          const box = await el.boundingBox();
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        }
        expect(await clipping(page)).toEqual([]);
      });
    }

    test('a layout the old board saved draws nothing, and this browser keeps none (#306)', async ({
      page,
    }) => {
      await openBoard(page, 'healthy', 'dark', {
        config: { gridLayout: OLD_LAYOUT, gridColumns: 24 },
      });
      await expect(page.locator('.helmgrid, .glass-card')).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('jaghelm-config'))))
        .not.toHaveProperty('gridLayout');
      const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('jaghelm-config')));
      expect(kept).not.toHaveProperty('gridColumns');
      expect(await clipping(page)).toEqual([]);
    });

    test("a node's issue row and its card open its detail drawer (#309)", async ({ page }) => {
      await openBoard(page, 'incident', 'dark');
      const row = page
        .getByRole('region', { name: 'Needs attention' })
        .getByRole('link', { name: /^Storage, Warning/ });
      await expect(row).toHaveAttribute('href', '/?entity=nodes/storage');
      await row.click();
      const drawer = page.getByRole('dialog', { name: 'Storage' });
      await expect(drawer).toBeVisible();
      await expect(page).toHaveURL(/\/\?entity=nodes\/storage$/);
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
      await expect(row).toBeFocused();
      const name = card(page, 'Storage').getByRole('link', { name: 'Storage' });
      await name.click();
      await expect(drawer).toBeVisible();
      await page.goBack();
      await expect(drawer).toHaveCount(0);
      await expect(name).toBeFocused();
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
