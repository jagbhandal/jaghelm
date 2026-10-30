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
 *  - Over an open detail drawer: Ctrl K puts the palette on top, focused and
 *    seen by assistive tech; Escape closes it alone, focus back in the
 *    drawer; a row chosen there opens in the drawer.
 *  - axe finds nothing with the palette open, dark and light.
 *
 * Below 768px there is no search button (the phone's header has none), so
 * the palette is only ⌘K or Ctrl K on a keyboard: no test here.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { THEMES, WIDTHS, axeFindings, openApp, openedTab } from './app.mjs';

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
  browser,
}) => {
  await openApp(page);
  const field = await openPalette(page);
  await field.fill('network edge');
  const row = page.getByRole('option', { name: /^Network Edge, Node/ });
  // The list as the query leaves it, the row highlighted under the pointer.
  await expect(page.getByRole('option')).toHaveCount(1);
  await row.hover();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  for (const click of [{ modifiers: ['Control'] }, { button: 'middle' }]) {
    const tab = await openedTab(browser, () => row.click(click), /\/\?entity=nodes\/edge$/);
    await tab.close();
  }
  await expect(field).toBeVisible();
  expect(await url(page)).toBe('/');
});

test('Enter on a Quick Launch link opens its address in a new tab, with no opener', async ({
  page,
  context,
  browser,
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
  const tab = await openedTab(
    browser,
    () => page.keyboard.press('Enter'),
    /^https:\/\/status\.example\.com\/$/
  );
  expect(tab.canAccessOpener).toBe(false);
  await tab.close();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  expect(await url(page)).toBe('/');
});

test('over an open drawer: on top and focused; Escape closes it alone, focus back in the drawer', async ({
  page,
}) => {
  await openApp(page);
  await page.goto('/?entity=services/apps:gitea');
  const drawer = page.locator('[data-slot="drawer"]');
  await expect(drawer).toContainText('Gitea');
  const focusIn = (el) => el.evaluate((d) => d.contains(document.activeElement));
  await expect.poll(() => focusIn(drawer)).toBe(true);

  await page.keyboard.press('Control+k');
  const field = page.getByRole('combobox', { name: 'Search' });
  await expect(field).toBeFocused();
  // Drawn over the drawer, where a click lands, and not hidden from assistive tech.
  const topmost = await field.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el;
  });
  expect(topmost).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Search or jump to' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(drawer).toContainText('Gitea');
  expect(await url(page)).toBe('/?entity=services/apps:gitea');
  await expect.poll(() => focusIn(drawer)).toBe(true);

  // A row chosen over the drawer opens there.
  await page.keyboard.press('Control+k');
  await field.fill('network edge');
  await page.keyboard.press('Enter');
  await expect.poll(() => url(page)).toBe('/?entity=nodes/edge');
  await expect(drawer).toContainText('Network Edge');
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
