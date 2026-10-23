/*
 * Settings in a real browser (#317, spec §7): the production build, every
 * /api request answered with the demo server's own answers (app.mjs), at
 * 390 and 1440px, dark and light.
 *
 *  - /settings is an index of the sections; the search narrows it by what
 *    they hold ("font" finds Appearance, by its Font Family), and a card
 *    opens its section at its own address; Back finds the search's words.
 *  - An old tab's address (/settings/widgets) lands on its section's.
 *  - No page scrolls sideways.
 *  - axe finds nothing on the index (the new UI throughout) or on a
 *    section's head and list of sections; a section's content is today's
 *    Settings markup until its card rebuilds it (#318–#323).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { THEMES, WIDTHS, axeFindings, openApp } from './app.mjs';

const search = (page) => page.getByRole('searchbox', { name: 'Search settings' });
const cards = (page) => page.locator('[data-slot="settings-card"]');

async function noSideScroll(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, `${page.url()} scrolls sideways`).toBeLessThanOrEqual(0);
}

for (const [name, viewport] of Object.entries(WIDTHS)) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport });

    test('the index, its search, a section and an old address', async ({ page }) => {
      await openApp(page, '/settings');
      await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
      await expect(cards(page)).toHaveCount(5);
      await noSideScroll(page);

      await search(page).fill('font');
      await expect(cards(page)).toHaveCount(1);
      const appearance = page.getByRole('link', { name: 'Appearance' });
      await expect(appearance).toContainText('Matches: Font Family');
      await appearance.click();
      await expect(page).toHaveURL(/\/settings\/appearance$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Appearance' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Font Family' })).toBeVisible();
      // The list of sections from 768px; on a phone the index is the way between them.
      const nav = page.getByRole('navigation', { name: 'Settings sections' });
      if (name === 'phone') await expect(nav).toBeHidden();
      else
        await expect(nav.getByRole('link', { name: 'Appearance' })).toHaveAttribute(
          'aria-current',
          'page'
        );
      await noSideScroll(page);
      await page.goBack();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(search(page)).toHaveValue('font');

      await page.goto('/settings/widgets');
      await expect(page).toHaveURL(/\/settings\/appearance$/);
      await expect(page.getByRole('heading', { name: 'Weather' })).toBeVisible();
    });

    for (const theme of Object.keys(THEMES)) {
      test(`axe: the index and a section's frame, ${theme}`, async ({ page }) => {
        await openApp(page, '/settings', { theme });
        await expect(cards(page)).toHaveCount(5);
        expect(await axeFindings(new AxeBuilder({ page })), 'the index').toEqual([]);

        await page.goto('/settings/system');
        await expect(page.getByRole('heading', { level: 1, name: 'System' })).toBeVisible();
        const frame = new AxeBuilder({ page }).include(
          '[data-slot="settings-section-page"] [data-slot="shell-section"]'
        );
        expect(await axeFindings(frame), "a section's head and list").toEqual([]);
      });
    }
  });
}
