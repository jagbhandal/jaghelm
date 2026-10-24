/*
 * A Compose stack in a real browser (#642), on the server's own board for
 * Jag's vm-103 (server/testing/stackBoard.js: Immich 4 containers with its
 * Redis down, Nextcloud 5 with Collabora its own row, Wiki.js, Loki), dark and
 * light, at 1440 and 390:
 *
 *  - a stack is one row with its "+3 · 1 down" chip, named in words; the
 *    Services tile, the page's count and Attention count rows, and name the
 *    failing container;
 *  - the row is one tab stop (the chip takes none); Enter opens the panel with
 *    the containers, each with its own state; Escape closes it and focus is
 *    back on the row;
 *  - Details opens a container over the stack's panel and Back returns to it;
 *  - at 390 the sheet shows the same list;
 *  - axe finds nothing with the panel open.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { THEMES, WIDTHS, axeFindings, openApp } from './app.mjs';
import { stackBoard } from '../server/testing/stackBoard.js';

const BOARD = stackBoard({ redis: 'down' });
const ANSWERS = { '/api/status': BOARD.status, '/api/services': BOARD.services };
const LEAD = 'services/vm103:immich_server';
const ROW = `[data-slot="entity-row"][data-entity="${LEAD}"]`;
const NAME = 'Immich, stack of 4 containers, degraded: Immich Redis is down';

const panel = (page, width) =>
  page.locator(width >= 768 ? '[data-slot="drawer"]' : '[data-slot="phone-sheet"]');

for (const [themeName, theme] of Object.entries(THEMES)) {
  test.describe(`${themeName}, 1440px`, () => {
    test.use({ viewport: WIDTHS.desktop });

    test('one row for the stack, its chip, its words; rows are counted', async ({ page }) => {
      await openApp(page, '/services', { theme, answers: ANSWERS });
      const row = page.locator(ROW);
      await expect(row).toHaveAttribute('aria-label', NAME);
      await expect(row.locator('[data-slot="entity-stack"]')).toHaveText('+3 · 1 down');
      // Immich's other containers are no rows.
      await expect(page.locator('[data-entity="services/vm103:immich_redis"]')).toHaveCount(0);
      await expect(page.locator('[data-entity="services/vm103:collabora"]')).toHaveCount(1);
      await expect(page.getByText('7 monitored · 1 degraded')).toBeVisible();
    });

    test('the Overview counts stacks and Attention names the failing container', async ({
      page,
    }) => {
      await openApp(page, '/', { theme, answers: ANSWERS });
      const attention = page.locator('[data-slot="attention-panel"]');
      await expect(attention).toContainText('Immich Redis is down · 1 of 4 containers');
      await expect(attention).toContainText('Stack · vm103');
      await expect(page.locator('[data-slot="subsystem-strip"]')).toContainText('6 / 7');
    });

    test('Enter on the row opens the panel; Escape closes it and focus returns to the row', async ({
      page,
    }) => {
      await openApp(page, '/services', { theme, answers: ANSWERS });
      const row = page.locator(ROW);
      await row.focus();
      await page.keyboard.press('Enter');
      const drawer = panel(page, 1440);
      await expect(drawer.getByRole('heading', { name: 'Immich', exact: true })).toBeVisible();
      const list = drawer.getByRole('region', { name: 'Containers of Immich' });
      await expect(list.getByRole('listitem')).toHaveCount(4);
      await expect(list.getByRole('listitem').nth(3)).toContainText('Immich Redis');
      await expect(list.getByRole('listitem').nth(3)).toContainText('Kuma: down');
      await expect(drawer).toContainText('Immich Redis is down');
      expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(row).toBeFocused();
    });

    test('Details opens the container over the stack and Back returns to the stack', async ({
      page,
    }) => {
      await openApp(page, '/services', { theme, answers: ANSWERS });
      await page.locator(ROW).click();
      const drawer = panel(page, 1440);
      await drawer.getByRole('button', { name: 'Details of Immich Postgres' }).click();
      await expect(
        drawer.getByRole('heading', { name: 'Immich Postgres', exact: true })
      ).toBeVisible();
      await page.goBack();
      await expect(drawer.getByRole('heading', { name: 'Immich', exact: true })).toBeVisible();
    });

    test('the chip is no tab stop: one Tab from the row leaves it', async ({ page }) => {
      await openApp(page, '/services', { theme, answers: ANSWERS });
      await page.locator(ROW).focus();
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() =>
        document.activeElement?.getAttribute('data-entity')
      );
      expect(focused).not.toBe(LEAD);
      expect(
        await page.evaluate(() => document.activeElement?.closest('[data-slot="entity-stack"]'))
      ).toBeNull();
    });
  });

  test.describe(`${themeName}, 390px`, () => {
    test.use({ viewport: WIDTHS.phone });

    test('the sheet is the stack, with its containers', async ({ page }) => {
      await openApp(page, '/services', { theme, answers: ANSWERS });
      await page.getByRole('button', { name: NAME }).click();
      const sheet = panel(page, 390);
      await expect(sheet.getByRole('heading', { name: 'Immich', exact: true })).toBeVisible();
      const list = sheet.getByRole('region', { name: 'Containers of Immich' });
      await expect(list.getByRole('listitem')).toHaveCount(4);
      expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(wide).toBe(false);
    });
  });
}
