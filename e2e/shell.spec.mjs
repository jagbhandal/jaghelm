/*
 * The app shell in a real browser (#296): the production build, every /api
 * request answered here with the demo server's own answers (demoResponse), in
 * its incident scenario, /api/status included (the status model of the demo's
 * board, #437), and two embedded apps served here, at 390 and 1440px.
 *
 *  - The header says the model's incident sentence, and steel "No signal"
 *    when the backend can't be reached.
 *  - Every nav entry opens its page, and every old view is reachable: the
 *    dashboard, Settings (and its Tabs section, "Add app"), each embedded app,
 *    under its app bar (Reload, Open in new tab).
 *  - Back, Forward and a reload keep the page.
 *  - The theme (#304): the header's toggle switches it and a reload keeps it,
 *    an old theme saved before #304 opens as its new one, and System follows
 *    the device as it changes.
 *  - No page scrolls sideways.
 *  - axe finds nothing on the shell, at both widths, dark and light: the whole
 *    Alerts page (a page of the new UI), and the shell's chrome and the
 *    status (#297) around today's Overview board, which later cards rebuild
 *    (#298–#300).
 *
 * The Overview's status itself is in overview.spec.mjs; app.mjs holds what
 * both share.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { THEMES, WIDTHS, axeFindings, demo, openApp } from './app.mjs';

/** The demo's status in its incident scenario: what the header must say. */
const INCIDENT = demo('/api/status').body;

const headerStatus = (page) => page.getByRole('banner').locator('[data-slot="header-status"] a');
const sidebar = (page) => page.getByRole('navigation', { name: 'Main' });
const phoneTabs = (page) => page.getByRole('navigation', { name: 'Tabs' });

/** The page scrolls up and down only. */
async function noSideScroll(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, `${page.url()} scrolls sideways`).toBeLessThanOrEqual(0);
}

/** Each page, as it shows when open. */
const SHOWS = {
  // Today's board's node panel: the node's name is on its card in the
  // Infrastructure section too (#299).
  overview: (page) =>
    expect(page.locator('.section-title', { hasText: 'Network Edge' })).toBeVisible(),
  // A phone's (#303): the phone screens, their Overview's status card.
  phoneOverview: (page) =>
    expect(page.locator('[data-slot="phone-view"] [data-slot="attention-panel"]')).toBeVisible(),
  page: (title) => (page) =>
    expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible(),
  alerts: (page) => expect(page.getByRole('heading', { level: 1, name: 'Alerts' })).toBeVisible(),
  settings: (page) =>
    expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible(),
  tabs: (page) => expect(page.getByRole('heading', { name: /Tabs/ })).toBeVisible(),
  app: (name) => async (page) => {
    const frame = page.locator(`iframe[title="${name}"]`);
    await expect(frame).toBeVisible();
    await expect(page.frameLocator(`iframe[title="${name}"]`).locator('p')).toContainText(
      'Embedded'
    );
  },
};

async function expectAt(page, path, shows) {
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[/]/g, '\\/')}$`));
  await shows(page);
  await noSideScroll(page);
}

test.describe('the header', () => {
  test.use({ viewport: WIDTHS.desktop });

  test("shows the status model's incident sentence, a link to Alerts", async ({ page }) => {
    expect(INCIDENT.overall.state).toBe('crit');
    await openApp(page);
    const status = headerStatus(page);
    await expect(status).toHaveAttribute('data-state', 'crit');
    await expect(status).toContainText('Critical');
    await expect(status).toContainText(INCIDENT.overall.sentence);
    await status.click();
    await expectAt(page, '/alerts', SHOWS.alerts);
  });

  test('is steel "No signal" with the backend down', async ({ page }) => {
    await openApp(page, '/', { down: true });
    const status = headerStatus(page);
    await expect(status).toHaveAttribute('data-state', 'unknown');
    await expect(status).toContainText('No signal');
    await expect(status).toContainText("Can't reach JagHelm");
    await expect(status.locator('[data-slot="status-lamp"]')).toHaveAttribute('data-shape', 'ring');
    // Steel: the word in the unknown role's colour, as the Android app draws it.
    const [word, steel] = await page.getByRole('banner').evaluate((header) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--jh-unknown-fg)';
      header.append(probe);
      const said = [...header.querySelectorAll('span')].find((s) => s.textContent === 'No signal');
      const out = [getComputedStyle(said).color, getComputedStyle(probe).color];
      probe.remove();
      return out;
    });
    expect(word).toBe(steel);
  });

  test('goes to "No signal" when the backend stops answering, and back', async ({ page }) => {
    await page.clock.install();
    const server = await openApp(page);
    await expect(headerStatus(page)).toHaveAttribute('data-state', 'crit');
    server.down = true;
    await page.clock.runFor(30_000);
    await expect(headerStatus(page)).toHaveAttribute('data-state', 'unknown');
    server.down = false;
    await page.clock.runFor(30_000);
    await expect(headerStatus(page)).toHaveAttribute('data-state', 'crit');
  });
});

test.describe('the theme (#304)', () => {
  test.use({ viewport: WIDTHS.desktop });

  const html = (page) => page.locator('html');
  const headerRoot = (page) => page.locator('.jh-ui:has(> header)');

  test("the header's toggle switches it, and a reload keeps it", async ({ page }) => {
    await openApp(page, '/', { theme: null });
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(headerRoot(page)).not.toHaveAttribute('data-theme');
    const banner = page.getByRole('banner');
    await banner.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(headerRoot(page)).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await banner.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(banner.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  });

  test('an old theme saved before #304 opens as its new one', async ({ page }) => {
    await openApp(page, '/', { theme: 'solarized-light' });
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('jaghelm-theme'))).toBe('light');
  });

  test('System, picked in Settings → Appearance, follows the device as it changes', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openApp(page, '/settings/appearance', { theme: 'dark' });
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('radio', { name: 'System' }).click();
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
    await expect(headerRoot(page)).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
    await expect(headerRoot(page)).not.toHaveAttribute('data-theme');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(html(page)).toHaveAttribute('data-theme', 'light');
  });
});

test.describe('at 1440px', () => {
  test.use({ viewport: WIDTHS.desktop });

  test('every sidebar entry opens its page; every old view is reachable', async ({ page }) => {
    await openApp(page);
    await expectAt(page, '/', SHOWS.overview);
    const nav = sidebar(page);
    // [entry, where it goes, what shows, the entry marked current there]
    const steps = [
      ['Alerts', '/alerts', SHOWS.alerts],
      ['Grafana', '/apps/grafana', SHOWS.app('Grafana')],
      ['Uptime Kuma', '/apps/kuma', SHOWS.app('Uptime Kuma')],
      ['Add app', '/settings/tabs', SHOWS.tabs, 'Settings'],
      ['Settings', '/settings', SHOWS.settings],
      ['Overview', '/', SHOWS.overview],
    ];
    for (const [name, path, shows, current = name] of steps) {
      await nav.getByRole('link', { name: new RegExp(`^${name}`) }).click();
      await expectAt(page, path, shows);
      await expect(nav.getByRole('link', { name: new RegExp(`^${current}`) })).toHaveAttribute(
        'aria-current',
        'page'
      );
    }
    // The header's own links.
    const header = page.getByRole('banner');
    await header.getByRole('link', { name: 'Settings' }).click();
    await expectAt(page, '/settings', SHOWS.settings);
    await header.getByRole('link', { name: 'JagHelm' }).click();
    await expectAt(page, '/', SHOWS.overview);
  });

  test('Back, Forward and a reload keep the page', async ({ page }) => {
    await openApp(page);
    const nav = sidebar(page);
    await nav.getByRole('link', { name: /^Alerts/ }).click();
    await expectAt(page, '/alerts', SHOWS.alerts);
    await nav.getByRole('link', { name: /^Grafana/ }).click();
    await expectAt(page, '/apps/grafana', SHOWS.app('Grafana'));
    await page.goBack();
    await expectAt(page, '/alerts', SHOWS.alerts);
    await page.goForward();
    await expectAt(page, '/apps/grafana', SHOWS.app('Grafana'));
    await page.reload();
    await expectAt(page, '/apps/grafana', SHOWS.app('Grafana'));
    await page.goto('/settings/tabs');
    await page.reload();
    await expectAt(page, '/settings/tabs', SHOWS.tabs);
  });

  test("the app bar: the app's name and address, Reload, Open in new tab", async ({ page }) => {
    await openApp(page, '/apps/grafana');
    await SHOWS.app('Grafana')(page);
    const bar = page
      .getByRole('region', { name: 'Grafana, open inside JagHelm' })
      .locator('[data-slot="app-bar"]');
    await expect(bar).toContainText('Grafana');
    await expect(bar).toContainText('/embedded/grafana');
    await expect(bar).toContainText('Stays loaded when you switch away');
    const open = bar.getByRole('link', { name: 'Open in new tab' });
    await expect(open).toHaveAttribute('target', '_blank');
    await expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    const before = await page.locator('iframe[title="Grafana"]').elementHandle();
    await bar.getByRole('button', { name: 'Reload Grafana' }).click();
    await expect.poll(() => before.evaluate((el) => el.isConnected)).toBe(false);
    await SHOWS.app('Grafana')(page);
  });

  test('the command palette opens an app', async ({ page }) => {
    await openApp(page);
    // The apps come with the server's config.
    await expect(sidebar(page).getByRole('link', { name: /^Uptime Kuma/ })).toBeVisible();
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('open uptime');
    await page.getByRole('option', { name: /Open Uptime Kuma/ }).click();
    await expectAt(page, '/apps/kuma', SHOWS.app('Uptime Kuma'));
  });
});

test.describe('at 390px', () => {
  test.use({ viewport: WIDTHS.phone });

  test('no sidebar; every tab and More entry opens its page; every old view is reachable', async ({
    page,
  }) => {
    await openApp(page);
    await expect(sidebar(page)).toBeHidden();
    await expectAt(page, '/', SHOWS.phoneOverview);
    const tabs = phoneTabs(page);
    // The spec's five tabs (§7, #303): four screens, then More.
    for (const [name, path, title] of [
      ['Services', '/services', 'Services'],
      ['Infrastructure', '/infrastructure', 'Infrastructure'],
      [/^Alerts/, '/alerts', 'Alerts'],
    ]) {
      await tabs.getByRole('link', { name }).click();
      await expectAt(page, path, SHOWS.page(title));
    }
    const more = [
      ['Grafana', '/apps/grafana', SHOWS.app('Grafana')],
      ['Uptime Kuma', '/apps/kuma', SHOWS.app('Uptime Kuma')],
      ['Add app', '/settings/tabs', SHOWS.tabs],
      ['Settings', '/settings', SHOWS.settings],
    ];
    for (const [name, path, shows] of more) {
      await tabs.getByRole('button', { name: 'More' }).click();
      const sheet = page.getByRole('dialog', { name: 'More' });
      await sheet.getByRole('link', { name: new RegExp(`^${name}`) }).click();
      await expect(sheet).toBeHidden();
      await expectAt(page, path, shows);
    }
    await tabs.getByRole('link', { name: 'Overview' }).click();
    await expectAt(page, '/', SHOWS.phoneOverview);
  });

  test('Back, Forward and a reload keep the page', async ({ page }) => {
    await openApp(page);
    await phoneTabs(page)
      .getByRole('link', { name: /^Alerts/ })
      .click();
    await expectAt(page, '/alerts', SHOWS.alerts);
    await page.goBack();
    await expectAt(page, '/', SHOWS.phoneOverview);
    await page.goForward();
    await expectAt(page, '/alerts', SHOWS.alerts);
    await page.reload();
    await expectAt(page, '/alerts', SHOWS.alerts);
  });
});

for (const theme of Object.keys(THEMES)) {
  for (const [name, viewport] of Object.entries(WIDTHS)) {
    test(`axe: the shell at ${viewport.width}px, ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openApp(page, '/alerts', { theme });
      await SHOWS.alerts(page);
      await expect(headerStatus(page)).toHaveAttribute('data-state', 'crit');
      // The Alerts page is the new UI throughout: the whole page.
      expect(await axeFindings(new AxeBuilder({ page })), 'Alerts').toEqual([]);

      // The Overview is today's board inside the shell, under its status (#297):
      // the shell's chrome and the status, the new UI on it. A phone's is the
      // phone screens', all of it the new UI (#303).
      await page.goto('/');
      await (name === 'phone' ? SHOWS.phoneOverview : SHOWS.overview)(page);
      await expect(page.getByRole('region', { name: 'Needs attention' })).toBeVisible();
      const chrome = new AxeBuilder({ page })
        .include('[data-slot="app-header"]')
        .include(name === 'phone' ? '[data-slot="bottom-tabs"]' : '[data-slot="side-nav"]')
        .include(name === 'phone' ? '[data-slot="phone-view"]' : '[data-slot="overview-status"]');
      expect(await axeFindings(chrome), "the shell and the Overview's status").toEqual([]);

      if (name === 'phone') {
        await phoneTabs(page).getByRole('button', { name: 'More' }).click();
        await expect(page.getByRole('dialog', { name: 'More' })).toBeVisible();
        const sheet = new AxeBuilder({ page }).include('[data-slot="drawer"]');
        expect(await axeFindings(sheet), 'the More sheet').toEqual([]);
      }
    });
  }
}

test('screenshots of the incident, dark, for the PR', async ({ page }) => {
  const dir = join(test.info().project.outputDir, 'shots');
  mkdirSync(dir, { recursive: true });
  await page.setViewportSize(WIDTHS.desktop);
  await openApp(page);
  await SHOWS.overview(page);
  await page.screenshot({ path: `${dir}/desktop-overview.png` });
  await page.goto('/alerts');
  await SHOWS.alerts(page);
  await page.screenshot({ path: `${dir}/desktop-alerts.png` });
  await page.goto('/apps/grafana');
  await SHOWS.app('Grafana')(page);
  await page.screenshot({ path: `${dir}/desktop-app.png` });
  await page.setViewportSize(WIDTHS.phone);
  await page.goto('/');
  await SHOWS.phoneOverview(page);
  await page.screenshot({ path: `${dir}/phone-overview.png` });
  await page.goto('/alerts');
  await SHOWS.alerts(page);
  await page.screenshot({ path: `${dir}/phone-alerts.png` });
});
