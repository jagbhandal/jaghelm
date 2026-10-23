/*
 * The command palette in a real browser (#315), on the demo's board at
 * 1440px: ⌘K finds the current issues first, then services, nodes, Settings
 * sections and Quick Launch links, and opens each as the page does.
 *
 *  - An entity: Enter opens its drawer at its URL over the page; Escape
 *    closes it and focus is back on the header's search button.
 *  - A Ctrl-click or a middle click on an entity opens its URL in a new tab,
 *    and the palette stays.
 *  - A Quick Launch link: Enter opens its address in a new tab with no
 *    opener, as the panel's link does.
 *  - axe finds nothing with the palette open, dark and light.
 *
 * Below 768px there is no search button (the phone's header has none), so
 * the palette is only ⌘K or Ctrl K on a keyboard: no test here.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { THEMES, WIDTHS, axeFindings, openApp } from './app.mjs';

test.use({ viewport: WIDTHS.desktop });

const url = (page) => page.evaluate(() => location.pathname + location.search);
const searchButton = (page) =>
  page
    .getByRole('banner')
    .getByRole('button', { name: /^Search or jump to/ })
    .first();

/** Opens the palette from the header's search button. */
async function openPalette(page) {
  await searchButton(page).click();
  const field = page.getByRole('combobox', { name: 'Search' });
  await expect(field).toBeFocused();
  return field;
}

test('the issues come first; a service opens its drawer at its URL, and Escape gives focus back', async ({
  page,
}) => {
  await openApp(page);
  const field = await openPalette(page);
  await expect(page.getByRole('option').first()).toHaveAccessibleName(/^Jellyfin, Issue, Down/);
  await field.fill('gitea');
  await expect(page.getByRole('option').first()).toHaveAccessibleName('Gitea, Service, Up, apps');
  await page.keyboard.press('Enter');
  await expect.poll(() => url(page)).toBe('/?entity=services/apps:gitea');
  await expect(page.locator('[data-slot="drawer"]')).toContainText('Gitea');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => url(page)).toBe('/');
  await expect(searchButton(page)).toBeFocused();
});

test('a Ctrl-click or a middle click opens an entity in a new tab; the palette stays', async ({
  page,
  context,
}) => {
  await openApp(page);
  const field = await openPalette(page);
  await field.fill('network edge');
  const row = page.getByRole('option', { name: /^Network Edge, Node/ });
  for (const click of [{ modifiers: ['Control'] }, { button: 'middle' }]) {
    const [tab] = await Promise.all([context.waitForEvent('page'), row.click(click)]);
    await expect.poll(() => tab.url()).toMatch(/\/\?entity=nodes\/edge$/);
    await tab.close();
  }
  await expect(field).toBeVisible();
  expect(await url(page)).toBe('/');
});

test('Enter on a Quick Launch link opens its address in a new tab, with no opener', async ({
  page,
  context,
}) => {
  await context.route('https://status.example.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Kuma</title>' })
  );
  await openApp(page);
  const field = await openPalette(page);
  await field.fill('status.example');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toHaveAccessibleName(
    'Open Uptime Kuma, Link, Dev & Monitoring, status.example.com'
  );
  const [tab] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('Enter')]);
  await tab.waitForLoadState();
  expect(tab.url()).toBe('https://status.example.com/');
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  expect(await url(page)).toBe('/');
});

for (const theme of Object.values(THEMES)) {
  test(`axe finds nothing with the palette open, ${theme}`, async ({ page }) => {
    await openApp(page, '/', { theme });
    const field = await openPalette(page);
    expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
    await field.fill('gr');
    expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
    await field.fill('nothing at all');
    await expect(page.getByRole('status').filter({ hasText: 'Nothing matches' })).toBeVisible();
    expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
  });
}
