/*
 * The Services and Infrastructure pages in a real browser (#313), on the
 * demo's incident board (Jellyfin down), dark and light:
 *
 *  - from 768px each is a page in the sidebar's Monitor group, every service
 *    or node, as the Overview's sections draw them;
 *  - the search and the State, Node and Role filters narrow the list and go
 *    in the address: Back undoes a change, and a link opens the page
 *    filtered;
 *  - /services and /infrastructure keep their path and their filters as the
 *    window crosses 768px, both ways (#567's review: the wide layout used to
 *    replace them with /), the phone's Services tab reading the same search
 *    and node;
 *  - axe finds nothing on either page; neither scrolls sideways at 768px.
 *
 * Their unit tests are src/App.pages.test.jsx.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { axeFindings, demo, openApp } from './app.mjs';

const WIDE = { width: 1440, height: 900 };
const SERVICES = demo('/api/status').body.entities.filter((e) => e.subsystem === 'services');

const sidebar = (page) => page.getByRole('navigation', { name: 'Main' });
const region = (page, name) => page.getByRole('region', { name, exact: true });
const filters = (page) => page.getByRole('group', { name: 'Filters' });
const rows = (page) => region(page, 'Services').locator('[data-slot="entity-row"]');
const cards = (page) => region(page, 'Infrastructure').getByRole('article');
const phoneView = (page) => page.locator('[data-slot="phone-view"]');
const url = (page) => {
  const u = new URL(page.url());
  return u.pathname + u.search;
};

async function choose(page, name, option) {
  await filters(page).getByRole('combobox', { name }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('from 768px', () => {
  test.use({ viewport: WIDE });

  test('the sidebar opens both pages, in the mock’s order', async ({ page }) => {
    await openApp(page);
    const monitor = sidebar(page).getByRole('group').first();
    await expect(monitor.getByRole('link')).toHaveText([
      'Overview',
      'Services',
      'Infrastructure',
      /^Alerts/,
    ]);
    await monitor.getByRole('link', { name: 'Services' }).click();
    await expect(page).toHaveURL('/services');
    await expect(rows(page)).toHaveCount(SERVICES.length);
    await monitor.getByRole('link', { name: 'Infrastructure' }).click();
    await expect(page).toHaveURL('/infrastructure');
    await expect(cards(page)).toHaveCount(3);
  });

  test('Services: the search and the State and Node filters, in the address; Back undoes; a link opens it filtered', async ({
    page,
  }) => {
    await openApp(page, '/services');
    await expect(rows(page)).toHaveCount(SERVICES.length);
    // No service has tags yet (#519): no Tag filter.
    await expect(filters(page).getByRole('combobox', { name: 'Tag' })).toHaveCount(0);

    await filters(page).getByRole('searchbox', { name: 'Search services' }).fill('jelly');
    await expect(rows(page)).toHaveCount(1);
    await expect(page).toHaveURL('/services?q=jelly');
    await filters(page).getByRole('searchbox', { name: 'Search services' }).fill('');
    await expect(page).toHaveURL('/services');

    await choose(page, 'State', 'Problems');
    await expect(page).toHaveURL('/services?state=problems');
    await expect(rows(page)).toHaveText([/^Jellyfin/]);
    await choose(page, 'Node', 'Storage');
    await expect(page).toHaveURL('/services?state=problems&node=storage');
    await expect(
      region(page, 'Services').getByText('No services match these filters')
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL('/services?state=problems');
    await expect(rows(page)).toHaveCount(1);
    await page.goBack();
    await expect(rows(page)).toHaveCount(SERVICES.length);

    // A link opens the page filtered; the row opens its detail over it.
    await page.goto('/services?node=apps&q=graf');
    await expect(rows(page)).toHaveText([/^Grafana/]);
    await expect(filters(page).getByRole('combobox', { name: 'Node' })).toHaveText('App Server');
    await rows(page).first().click();
    await expect(page.getByRole('dialog', { name: 'Grafana' })).toBeVisible();
    await expect(page).toHaveURL('/services?node=apps&q=graf&entity=services/apps:grafana');
  });

  test('Services as a table, kept across a reload', async ({ page }) => {
    await openApp(page, '/services');
    await region(page, 'Services')
      .getByRole('radiogroup', { name: 'Service view' })
      .getByRole('radio', { name: 'Table' })
      .click();
    const table = region(page, 'Services').getByRole('table', { name: 'Services' });
    await expect(table.getByRole('rowheader')).toHaveCount(SERVICES.length);
    await page.reload();
    await expect(table.getByRole('rowheader')).toHaveCount(SERVICES.length);
  });

  test('Infrastructure: the search and the State and Role filters, in the address; Back undoes', async ({
    page,
  }) => {
    await openApp(page, '/infrastructure');
    await expect(cards(page)).toHaveCount(3);
    await filters(page).getByRole('searchbox', { name: 'Search nodes' }).fill('edge');
    await expect(cards(page)).toHaveCount(1);
    await expect(page).toHaveURL('/infrastructure?q=edge');
    await filters(page).getByRole('searchbox', { name: 'Search nodes' }).fill('');
    await expect(cards(page)).toHaveCount(3);
    await choose(page, 'Role', 'NAS');
    await expect(page).toHaveURL('/infrastructure?role=NAS');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toHaveAccessibleName('Storage');
    await choose(page, 'State', 'Problems');
    await expect(
      region(page, 'Infrastructure').getByText('No nodes match these filters')
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL('/infrastructure?role=NAS');
    await expect(cards(page)).toHaveCount(1);
  });
});

// #567's review: below 768px /services is the phone's Services tab; crossing
// 768px used to rewrite it to /. Now both widths have the page.
test.describe('crossing 768px', () => {
  for (const [path, check] of [
    [
      '/services?state=problems&q=jelly',
      async (page) => {
        await expect(rows(page)).toHaveText([/^Jellyfin/]);
        await expect(filters(page).getByRole('combobox', { name: 'State' })).toHaveText('Problems');
      },
    ],
    [
      '/infrastructure?role=NAS',
      async (page) => {
        await expect(cards(page)).toHaveCount(1);
        await expect(filters(page).getByRole('combobox', { name: 'Role' })).toHaveText('NAS');
      },
    ],
  ]) {
    test(`${path.split('?')[0]} keeps its path and filters, both ways`, async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 900 });
      await openApp(page, path);
      await check(page);
      await page.setViewportSize({ width: 767, height: 900 });
      await expect(phoneView(page)).toBeVisible();
      await expect(page).toHaveURL(path);
      if (path.startsWith('/services')) {
        // The phone's tab reads the same search.
        await expect(
          phoneView(page).getByRole('searchbox', { name: 'Search services' })
        ).toHaveValue('jelly');
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(phoneView(page)).toHaveCount(0);
      await expect(page).toHaveURL(path);
      await check(page);
      expect(url(page)).toBe(path);
    });
  }

  test("the phone's search and node chip reach the wide page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page, '/services');
    const view = phoneView(page);
    await view.getByRole('button', { name: /^App Server/ }).click();
    await view.getByRole('searchbox', { name: 'Search services' }).fill('jelly');
    await expect(page).toHaveURL('/services?q=jelly&node=apps');
    await page.setViewportSize(WIDE);
    await expect(rows(page)).toHaveText([/^Jellyfin/]);
    await expect(filters(page).getByRole('combobox', { name: 'Node' })).toHaveText('App Server');
  });
});

test.describe('axe and width', () => {
  for (const theme of ['dark', 'light']) {
    test(`axe finds nothing on either page, ${theme}`, async ({ page }) => {
      await page.setViewportSize(WIDE);
      for (const path of ['/services?state=problems', '/infrastructure?role=NAS']) {
        await openApp(page, path, { theme });
        await expect(filters(page)).toBeVisible();
        expect(await axeFindings(new AxeBuilder({ page })), `${path}, ${theme}`).toEqual([]);
      }
    });
  }

  test('neither page scrolls sideways at 768px', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    for (const path of ['/services', '/infrastructure']) {
      await openApp(page, path);
      await expect(filters(page)).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
