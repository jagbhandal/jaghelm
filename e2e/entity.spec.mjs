/*
 * Entity URLs in a real browser (#309, spec §7, §8): `?entity=<id>` over the
 * page opens that entity's detail, the drawer from 768px and the phone's
 * sheet below it, on the demo's own status model, at 1440 and 390.
 *
 *  - Opened from its URL (a link loaded into the tab), over the page it
 *    names: a reload draws it again; Escape closes it, leaving the page's URL.
 *  - Opened from a row: Back closes it, focus back on the row; Forward opens
 *    it again, and Escape goes back.
 *  - Behind a sign-in: the sign-in screen keeps the URL, and once signed in
 *    the entity is open over its page.
 *  - An id the model has nothing by: "No longer monitored".
 *  - The server's SPA fallback serves every such URL (vite preview here; the
 *    server's own in server/assets.static.test.js).
 *  - axe finds nothing with the drawer or the sheet open, dark and light.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { THEMES, WIDTHS, axeFindings, demo, openApp } from './app.mjs';

const USER = 'admin';
const PASS = 'right-one'; // pragma: allowlist secret
const TOKEN = 'e2e-token';

const url = (page) => page.evaluate(() => location.pathname + location.search);
/** The open detail: the drawer from 768px, the phone's sheet below it. */
const detail = (page, width, name) =>
  page.locator(width >= 768 ? '[data-slot="drawer"]' : '[data-slot="phone-sheet"]').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });

/**
 * Loads `link` into a tab that has the app open: what a link pasted into the
 * address bar does. (openApp waits for the header, which an open detail
 * makes inert.)
 */
async function openLink(page, link, options) {
  await openApp(page, '/', options);
  await page.goto(link);
}

/** Opens the app at `path` asking for a sign-in (#305), the demo's answers once signed in. */
async function openSignedOut(page, path) {
  const origin = new URL(test.info().project.use.baseURL).origin;
  await page.route(
    (u) => u.origin !== origin,
    (route) => route.abort()
  );
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const u = new URL(request.url());
    if (u.pathname === '/api/auth/check') {
      const authenticated = request.headers()['x-auth-token'] === TOKEN;
      return route.fulfill({ json: { authenticated, authRequired: true } });
    }
    if (u.pathname === '/api/auth/login') {
      const { username, password } = request.postDataJSON() ?? {};
      return username === USER && password === PASS
        ? route.fulfill({ json: { token: TOKEN, user: USER } })
        : route.fulfill({ status: 401, json: { error: 'Invalid credentials' } });
    }
    if (u.pathname === '/api/icons/cached') return route.fulfill({ status: 404, json: {} });
    const out = demo(u.pathname, {
      method: request.method(),
      query: Object.fromEntries(u.searchParams),
    });
    return route.fulfill({ status: out.status, json: out.body ?? {} });
  });
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: 'JagHelm' })).toBeVisible();
}

for (const viewport of Object.values(WIDTHS)) {
  const width = viewport.width;
  test.describe(`at ${width}px`, () => {
    test.beforeEach(({ page }) => page.setViewportSize(viewport));

    test('an entity opened from its URL: over its page, a reload keeps it, Escape closes it to the page', async ({
      page,
    }) => {
      const at = width >= 768 ? '/alerts' : '/infrastructure';
      const link = `${at}?entity=backups/storage:nightly-backup`;
      await openLink(page, link);
      const open = detail(page, width, 'nightly-backup');
      await expect(open).toBeVisible();
      await expect(open.locator('[data-slot="detail-status"]')).toContainText('Failed');
      // Over the page it names.
      await expect(
        page.getByRole('heading', {
          level: 1,
          name: width >= 768 ? 'Alerts' : 'Infrastructure',
          includeHidden: true,
        })
      ).toHaveCount(1);
      expect(await page.title()).toBe('nightly-backup — JagHelm');

      await page.reload();
      await expect(open).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(open).toHaveCount(0);
      expect(await url(page)).toBe(at);
    });

    test('a row opens its entity; Back closes it, focus back on the row; Forward opens it, Escape goes back', async ({
      page,
    }) => {
      await openApp(page, '/');
      const row =
        width >= 768
          ? page
              .getByRole('region', { name: 'Needs attention' })
              .getByRole('link', { name: /^Jellyfin, Down/ })
          : page
              .locator('[data-slot="phone-view"]')
              .getByRole('region', { name: 'Needs attention' })
              .getByRole('button', { name: /^Jellyfin, Down/ });
      await row.click();
      await expect(detail(page, width, 'Jellyfin')).toBeVisible();
      expect(await url(page)).toBe('/?entity=services/apps:jellyfin');
      await page.goBack();
      await expect(detail(page, width, 'Jellyfin')).toHaveCount(0);
      expect(await url(page)).toBe('/');
      await expect(row).toBeFocused();
      await page.goForward();
      await expect(detail(page, width, 'Jellyfin')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(detail(page, width, 'Jellyfin')).toHaveCount(0);
      expect(await url(page)).toBe('/');
    });

    test('an id the model has nothing by says it is no longer monitored', async ({ page }) => {
      await openLink(page, '/?entity=services/apps:removed-long-ago');
      // The drawer's title says it; the phone's Service sheet, its line.
      const open = page.getByRole('dialog');
      await expect(open).toBeVisible();
      await expect(open).toContainText(/no longer monitored/i);
      if (width >= 768) {
        await expect(open).toHaveAccessibleName('No longer monitored');
        await expect(open).toContainText('removed or renamed, or the link is old');
      }
    });

    test('a deep link survives the sign-in: signed in, the entity is open over its page', async ({
      page,
    }) => {
      const link = '/?entity=nodes/storage';
      await openSignedOut(page, link);
      expect(await url(page)).toBe(link);
      await page.getByRole('textbox', { name: 'Username' }).fill(USER);
      await page.getByLabel('Password').fill(PASS);
      await page.getByLabel('Password').press('Enter');
      await expect(detail(page, width, 'Storage')).toBeVisible();
      expect(await url(page)).toBe(link);
    });

    if (width < 768) {
      // #309: the detail screens are a chunk of their own; held back, a sheet
      // has its Back, focused, and "Loading…", never a blank dialog.
      const holdDetails = async (page) => {
        let release;
        const held = new Promise((resolve) => (release = resolve));
        await page.route(/\/assets\/PhoneDetail-[\w-]+\.js$/, async (route) => {
          await held;
          await route.continue();
        });
        return release;
      };

      test('a deep link while the details are on their way: Back, focused, and "Loading…", then the detail', async ({
        page,
      }) => {
        await openApp(page, '/');
        const release = await holdDetails(page);
        await page.goto('/?entity=services/apps:jellyfin');
        const waiting = page.getByRole('dialog', { name: 'Loading…' });
        await expect(waiting).toBeVisible();
        await expect(waiting.getByRole('button', { name: 'Back' })).toBeFocused();
        release();
        await expect(detail(page, width, 'Jellyfin')).toBeVisible();
      });

      test('the first detail opened before they are in: Back, focused, and "Loading…"; Back closes it', async ({
        page,
      }) => {
        const release = await holdDetails(page);
        await openApp(page, '/');
        await page
          .locator('[data-slot="phone-view"]')
          .getByRole('region', { name: 'Needs attention' })
          .getByRole('button', { name: /^Jellyfin, Down/ })
          .click();
        const waiting = page.getByRole('dialog', { name: 'Loading…' });
        await expect(waiting).toBeVisible();
        const back = waiting.getByRole('button', { name: 'Back' });
        await expect(back).toBeFocused();
        await back.click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(await url(page)).toBe('/');
        release();
      });
    }

    for (const theme of Object.keys(THEMES)) {
      test(`axe: the detail open, ${theme}`, async ({ page }) => {
        await openLink(page, '/?entity=services/apps:jellyfin', { theme });
        await expect(detail(page, width, 'Jellyfin')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
      });
    }
  });
}
