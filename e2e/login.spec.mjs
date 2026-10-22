/*
 * The sign-in page in a real browser (#305): the production build, with a
 * server that asks for a sign-in (/api/auth/check says authRequired) and
 * takes one username and password (/api/auth/login); every other /api
 * request gets the demo's answer, as app.mjs gives it. At 390 and 1440px:
 *
 *  - axe finds nothing on the page, dark and light, blank, with a wrong
 *    password's error on its field, and with JagHelm not answering;
 *  - a wrong password, sent with Enter, is the error on the password field,
 *    with focus on it; the right one opens the shell with the token stored;
 *  - nothing scrolls sideways;
 *  - JagHelm's logo loads, the lockup for the theme (#530), and on a 390 ×
 *    667 phone the page fits without scrolling, blank and with an error.
 *
 * Screenshots of the page, dark and light, blank and with the error, for the
 * PR, in test-results/e2e/shots/.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { THEMES, WIDTHS, axeFindings, demo } from './app.mjs';

const USER = 'admin';
const PASS = 'right-one'; // pragma: allowlist secret
const TOKEN = 'e2e-token';

/**
 * Opens the app signed out, in `theme`. The login answers 200 with a token
 * for USER and PASS, 401 otherwise, or fails as a network error when
 * `server.down`. Returns the server's state.
 */
async function openSignedOut(page, { theme = 'dark' } = {}) {
  const server = { down: false, logins: 0 };
  const origin = new URL(test.info().project.use.baseURL).origin;
  await page.route(
    (url) => url.origin !== origin,
    (route) => route.abort()
  );
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/auth/check') {
      const authenticated = request.headers()['x-auth-token'] === TOKEN;
      return route.fulfill({ json: { authenticated, authRequired: true } });
    }
    if (url.pathname === '/api/auth/login') {
      server.logins += 1;
      if (server.down) return route.abort('connectionrefused');
      const { username, password } = request.postDataJSON() ?? {};
      return username === USER && password === PASS
        ? route.fulfill({ json: { token: TOKEN, user: USER } })
        : route.fulfill({ status: 401, json: { error: 'Invalid credentials' } });
    }
    if (url.pathname === '/api/icons/cached') return route.fulfill({ status: 404, json: {} });
    const out = demo(url.pathname, {
      method: request.method(),
      query: Object.fromEntries(url.searchParams),
    });
    return route.fulfill({ status: out.status, json: out.body ?? {} });
  });
  await page.addInitScript((id) => localStorage.setItem('jaghelm-theme', id), THEMES[theme]);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'JagHelm' })).toBeVisible();
  return server;
}

const username = (page) => page.getByRole('textbox', { name: 'Username' });
const password = (page) => page.getByLabel('Password');
const submit = (page) => page.getByRole('button', { name: /^Sign(ing)? in/ });

async function noSidewaysScroll(page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, 'the page scrolls sideways').toBeLessThanOrEqual(client);
}

for (const theme of Object.keys(THEMES)) {
  for (const viewport of Object.values(WIDTHS)) {
    test(`axe: the sign-in page at ${viewport.width}px, ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const server = await openSignedOut(page, { theme });
      const screen = page.locator('[data-slot="login-screen"]');
      if (theme === 'light') await expect(screen).toHaveAttribute('data-theme', 'light');
      else await expect(screen).not.toHaveAttribute('data-theme');
      expect(await axeFindings(new AxeBuilder({ page })), 'blank').toEqual([]);
      await noSidewaysScroll(page);

      await username(page).fill(USER);
      await password(page).fill('wrong');
      await password(page).press('Enter');
      await expect(password(page)).toHaveAttribute('aria-invalid', 'true');
      expect(await axeFindings(new AxeBuilder({ page })), 'a wrong password').toEqual([]);

      server.down = true;
      await submit(page).click();
      await expect(page.getByRole('alert')).toContainText("Couldn't sign in");
      expect(await axeFindings(new AxeBuilder({ page })), "JagHelm didn't answer").toEqual([]);
      await noSidewaysScroll(page);
    });
  }
}

const LOCKUP = { dark: '/logo-login.svg', light: '/logo-login-light.svg' };

for (const theme of Object.keys(THEMES)) {
  test(`the logo loads, and the page fits a 390 x 667 phone, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 667 });
    await openSignedOut(page, { theme });
    const logo = page.getByRole('heading', { level: 1, name: 'JagHelm' }).locator('img');
    await expect(logo).toHaveAttribute('src', LOCKUP[theme]);
    await expect
      .poll(() => logo.evaluate((img) => img.complete && img.naturalWidth), 'the lockup loaded')
      .toBeGreaterThan(0);
    await expect(logo).toHaveJSProperty('height', 156);
    const fits = () =>
      page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollHeight <= doc.clientHeight;
      });
    expect(await fits(), 'blank: the page scrolls').toBe(true);

    await username(page).fill(USER);
    await password(page).fill('wrong');
    await password(page).press('Enter');
    await expect(password(page)).toHaveAttribute('aria-invalid', 'true');
    expect(await fits(), 'with the error: the page scrolls').toBe(true);
  });
}

test('a wrong password: the error on its field, focus there; the right one signs in', async ({
  page,
}) => {
  await page.setViewportSize(WIDTHS.desktop);
  const server = await openSignedOut(page);
  await expect(username(page)).toBeFocused();
  await username(page).fill(USER);
  await password(page).fill('wrong');
  await password(page).press('Enter');

  await expect(password(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(password(page)).toHaveAccessibleDescription('Wrong username or password.');
  await expect(password(page)).toBeFocused();
  expect(server.logins).toBe(1);

  // Focus is on the password, its text selected: typing replaces it.
  await page.keyboard.type(PASS);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('banner')).toBeVisible();
  expect(server.logins).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('jaghelm-token'))).toBe(TOKEN);
});

test('screenshots of the sign-in page, for the PR', async ({ page }) => {
  const dir = join(test.info().project.outputDir, 'shots');
  mkdirSync(dir, { recursive: true });
  for (const theme of Object.keys(THEMES)) {
    for (const [name, viewport] of Object.entries(WIDTHS)) {
      await page.setViewportSize(viewport);
      await openSignedOut(page, { theme });
      await username(page).blur();
      await page.screenshot({ path: `${dir}/login-${name}-${theme}.png` });
      await username(page).fill(USER);
      await password(page).fill('wrong');
      await password(page).press('Enter');
      await expect(password(page)).toHaveAttribute('aria-invalid', 'true');
      await expect(password(page)).toBeFocused();
      await page.screenshot({ path: `${dir}/login-error-${name}-${theme}.png` });
    }
  }
});
