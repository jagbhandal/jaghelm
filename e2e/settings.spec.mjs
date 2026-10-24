/*
 * Settings in a real browser (#317, spec §7): the production build, every
 * /api request answered with the demo server's own answers (app.mjs), at
 * 390 and 1440px, dark and light.
 *
 *  - /settings is an index of the sections; the search narrows it by what
 *    they hold ("font" finds Appearance, by its Font family), and a card
 *    opens its section at that part (/settings/appearance#font), scrolled
 *    to it; Back finds the search's words.
 *  - An old tab's address (/settings/widgets) lands on its section's, at
 *    the part it held (#weather), scrolled to it.
 *  - No page scrolls sideways.
 *  - axe finds nothing on the index (the new UI throughout) or on a
 *    section's head and list of sections; a section's content is today's
 *    Settings markup until its card rebuilds it (#318–#323).
 *  - Notifications (#320), built on the new UI throughout, with two phones
 *    and a test push delivered: axe finds nothing on it, and a link to its
 *    Devices part opens it there, under the header.
 *  - Sources (#318): "prometheus" opens it at its row, which says what the
 *    demo's status says of it; axe finds nothing on it (the new UI).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { THEMES, WIDTHS, axeFindings, openApp } from './app.mjs';

const search = (page) => page.getByRole('searchbox', { name: 'Search settings' });

// Settings → Notifications' phones (#320), as GET /api/push/devices gives them:
// the demo has push off, so a server with two phones and a test push delivered.
const PREFS = {
  enabled: true,
  notifyRecoveries: true,
  categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
};
const PHONES = {
  enabled: true,
  stalled: null,
  defaults: PREFS,
  devices: [
    {
      id: '3f9a1c77e0b2',
      name: 'Pixel 8',
      model: 'Pixel 8',
      os: '15',
      platform: 'android',
      appVersion: '1.3.0',
      registeredAt: '2026-10-11T12:00:00.000Z',
      lastSeenAt: '2026-10-23T10:00:00.000Z',
      lastDeliveredAt: '2026-10-23T11:59:00.000Z',
      lastError: null,
      prefs: PREFS,
    },
    {
      id: '8c2d4e6f0a1b',
      name: 'Galaxy Tab S9',
      model: 'Galaxy Tab S9',
      os: '14',
      platform: 'android',
      appVersion: '1.2.0',
      registeredAt: '2026-09-13T12:00:00.000Z',
      lastSeenAt: '2026-10-22T10:00:00.000Z',
      lastDeliveredAt: '2026-10-22T10:00:00.000Z',
      lastError: {
        at: '2026-10-22T16:00:00.000Z',
        sentence: "Google's push service didn't take it; JagHelm tries again",
      },
      prefs: { ...PREFS, enabled: false },
    },
  ],
  test: {
    at: '2026-10-23T11:59:00.000Z',
    device: null,
    historyId: '41',
    done: true,
    sentence: 'Delivered to 1 of 2 phones.',
    results: [
      {
        device: '3f9a1c77e0b2',
        state: 'sent',
        sentence:
          'Delivered: Google accepted it for this phone. Android shows it unless JagHelm is open on screen.',
      },
      {
        device: '8c2d4e6f0a1b',
        state: 'off',
        sentence: 'Not sent: push is switched off in the JagHelm app on this phone.',
      },
    ],
  },
  cooldownS: 30,
};
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

    test('the Font family changes the font of the whole page, on this device and the next (#660)', async ({
      page,
    }) => {
      const fonts = [];
      page.on('request', (r) => {
        if (/\.woff2(\?|$)/.test(r.url())) fonts.push(r.url());
      });
      await openApp(page, '/settings/appearance');
      const group = page.getByRole('radiogroup', { name: 'Font family' });
      await expect(group.getByRole('radio', { name: 'Manrope' })).toBeChecked();
      const family = (loc) => loc.evaluate((el) => getComputedStyle(el).fontFamily);
      const title = page.getByRole('heading', { level: 1, name: 'Appearance' });
      expect(await family(title)).toMatch(/^"?Manrope Variable/);

      await group.getByRole('radio', { name: 'Montserrat' }).click();
      await expect(
        page.getByRole('banner').locator('xpath=ancestor-or-self::*[@data-typeface]')
      ).toHaveAttribute('data-typeface', 'montserrat');
      expect(await family(title)).toMatch(/^"?Montserrat Variable/);
      expect(fonts.some((f) => /montserrat-latin-wght/.test(f))).toBe(true);

      // Another device: the server's copy alone draws it, everywhere.
      const other = await page.context().newPage();
      await openApp(other, '/overview', { config: { typeface: 'montserrat' } });
      await expect(
        other.getByRole('banner').locator('xpath=ancestor-or-self::*[@data-typeface]')
      ).toHaveAttribute('data-typeface', 'montserrat');
      expect(
        await other.getByRole('banner').evaluate((el) => getComputedStyle(el).fontFamily)
      ).toMatch(/^"?Montserrat Variable/);
    });

    test('the index, its search, a section and an old address', async ({ page }) => {
      await openApp(page, '/settings');
      await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
      await expect(cards(page)).toHaveCount(7);
      await noSideScroll(page);

      await search(page).fill('font');
      await expect(cards(page)).toHaveCount(1);
      const appearance = page.getByRole('link', { name: 'Appearance' });
      await expect(appearance).toContainText('Matches: Font family');
      await appearance.click();
      await expect(page).toHaveURL(/\/settings\/appearance#font$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Appearance' })).toBeAttached();
      await expect(page.getByRole('heading', { name: 'Font family' })).toBeInViewport();
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
      await expect(page).toHaveURL(/\/settings\/appearance#weather$/);
      await expect(page.getByRole('heading', { name: 'Weather' })).toBeInViewport();
      // Under the header, not behind it.
      const header = await page.getByRole('banner').boundingBox();
      const weather = await page.getByRole('heading', { name: 'Weather' }).boundingBox();
      expect(weather.y).toBeGreaterThanOrEqual(header.y + header.height);

      // Custom groups sit under Nodes and Services, which land after the page
      // draws: it follows the part down as they do.
      await page.goto('/settings/sections');
      await expect(page).toHaveURL(/\/settings\/nodes#custom-groups$/);
      await expect(page.getByText(/prometheus: edge/)).toBeAttached();
      await expect(page.getByRole('heading', { name: 'Custom groups' })).toBeInViewport();
    });

    // #318: a source's name finds Sources and opens it at its row, which
    // says what the board's status says of it.
    test('Sources: found by a source’s name, opened at its row', async ({ page }) => {
      await openApp(page, '/settings');
      await search(page).fill('prometheus');
      const sources = page.getByRole('link', { name: 'Sources' });
      await expect(sources).toContainText('Matches: Prometheus');
      await sources.click();
      await expect(page).toHaveURL(/\/settings\/sources#prometheus$/);
      await expect(page.getByRole('heading', { name: 'Prometheus' })).toBeInViewport();
      await expect(page.locator('#prometheus')).toContainText('Answering');
      // The demo's incident: a failed backup beside ok jobs, so the link opens
      // the whole Overview, where both are listed; a phone's Infrastructure
      // tab lists both.
      const cron = page.locator('#cron-reporters');
      await expect(cron).toContainText('Backups: 1 failed');
      await expect(cron.getByRole('link', { name: 'Open Jobs and Backups' })).toHaveAttribute(
        'href',
        name === 'phone' ? '/infrastructure' : '/'
      );
      await noSideScroll(page);
    });

    for (const theme of Object.keys(THEMES)) {
      test(`Notifications: axe, no sideways scroll, its parts by address, ${theme}`, async ({
        page,
      }) => {
        await openApp(page, '/settings/notifications#devices', {
          theme,
          // Not the demo, which saves nothing and draws no buttons for it.
          answers: {
            '/api/push/devices': PHONES,
            '/api/auth/check': { authenticated: true, authRequired: false, demo: false },
          },
        });
        await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Pixel 8' })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Warning at' })).toHaveCount(4);
        await expect(page.getByRole('button', { name: 'Remove Pixel 8' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Devices' })).toBeInViewport();
        await noSideScroll(page);
        const section = new AxeBuilder({ page }).include('[data-slot="settings-section-body"]');
        expect(await axeFindings(section), 'Notifications').toEqual([]);
      });

      test(`Apps & links: adding an app that blocks embedding says so before saving, axe, ${theme}`, async ({
        page,
      }) => {
        await openApp(page, '/settings/apps', {
          theme,
          answers: {
            // The app's server refuses to be framed, as the real check reads it.
            '/api/embed-check': (request) => ({
              url: request.postDataJSON().url,
              verdict: 'blocked',
              header: 'X-Frame-Options: DENY',
            }),
            '/api/auth/check': { authenticated: true, authRequired: false, demo: false },
          },
        });
        await expect(page.getByRole('heading', { level: 1, name: 'Apps & links' })).toBeVisible();
        await page.getByRole('button', { name: 'Add app' }).click();
        await page.getByRole('textbox', { name: 'Name' }).fill('Paperless');
        await page.getByRole('textbox', { name: 'URL' }).fill('paperless.lan');
        await page.getByRole('button', { name: 'Check embedding and add' }).click();
        await expect(page.getByText('Paperless won’t show inside JagHelm')).toBeVisible();
        // Nothing saved yet: the sidebar has no Paperless.
        await expect(page.getByRole('link', { name: /^Paperless/ })).toHaveCount(0);
        await noSideScroll(page);
        const section = new AxeBuilder({ page }).include('[data-slot="settings-section-body"]');
        expect(await axeFindings(section), 'Apps & links').toEqual([]);
        await page.getByRole('button', { name: 'Open in a new tab instead' }).click();
        await expect(page.getByRole('list', { name: 'Embedded apps' })).toContainText('Paperless');
      });

      test(`axe: Sources, ${theme}`, async ({ page }) => {
        await openApp(page, '/settings/sources', { theme });
        await expect(page.locator('#prometheus')).toContainText('Answering');
        const section = new AxeBuilder({ page }).include(
          '[data-slot="settings-section-page"] [data-slot="shell-section"]'
        );
        expect(await axeFindings(section), 'Sources').toEqual([]);
      });

      test(`axe: the index and a section's frame, ${theme}`, async ({ page }) => {
        await openApp(page, '/settings', { theme });
        await expect(cards(page)).toHaveCount(7);
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
