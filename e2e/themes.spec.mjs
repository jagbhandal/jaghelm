/*
 * Custom themes in a real browser (#331): the production build, a server that
 * keeps the display config it is sent (versioned, as the route does, #547).
 *
 *  - A theme pasted into Settings → Appearance → Custom themes is checked as
 *    it is typed, imported, chosen, and then the page itself is drawn in its
 *    colours (read from the browser's computed style, not from the config);
 *    a reload keeps it, and so does the next device's copy of the config.
 *  - A theme that fails the contrast rules is rejected with the pairing named
 *    and Import stays off; a hostile one never reaches a style.
 *  - A rejected theme in the config is listed apart with Remove, and the app
 *    stays on its base.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { THEMES, axeFindings, openApp, reply } from './app.mjs';
const midnight = JSON.parse(
  readFileSync(new URL('../docs/examples/midnight-theme.json', import.meta.url), 'utf8')
);

const NOT_DEMO = { authenticated: true, authRequired: false, demo: false };
const DIM = {
  ...midnight,
  id: 'dim',
  name: 'Dim',
  tokens: { ...midnight.tokens, 'text-2': 'oklch(0.5 0.02 255)' },
};

/** The server's state, and the answers for openApp. */
function keeper(config = {}) {
  const server = { config, version: 1 };
  const etag = () => `"v${server.version}"`;
  const displayConfig = (request) => {
    if (request.method() !== 'POST') return reply(200, server.config, { ETag: etag() });
    const ifMatch = request.headers()['if-match'];
    if (ifMatch !== etag()) return reply(409, { error: 'Stale', stale: true }, { ETag: etag() });
    server.config = request.postDataJSON();
    server.version += 1;
    return reply(200, { ok: true }, { ETag: etag() });
  };
  return { server, answers: { '/api/auth/check': NOT_DEMO, '/api/display-config': displayConfig } };
}

/** The page colour a custom theme sets on the header's root (inline: "" when none is applied). */
const pageColour = (page) =>
  page
    .getByRole('banner')
    .evaluate((el) => el.closest('.jh-ui').style.getPropertyValue('--jh-bg').trim());
/** The colour the browser paints the Theme panel in, computed from the tokens (surface-1). */
const painted = (page) =>
  page
    .getByRole('region', { name: 'Theme', exact: true })
    .evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe('custom themes', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('import, apply, reload: the page is drawn in the theme, here and on the next device', async ({
    page,
    browser,
  }) => {
    const { server, answers } = keeper({});
    // No saved theme: the choice made below must survive the reload on its own.
    await openApp(page, '/settings/appearance', { answers, theme: null });
    const panel = page.getByRole('region', { name: 'Custom themes' });
    await expect(page.getByRole('heading', { level: 1, name: 'Appearance' })).toBeVisible();
    const before = await painted(page);

    await panel.getByRole('textbox', { name: /Theme JSON/ }).fill(JSON.stringify(midnight));
    await expect(panel.getByText(/Midnight: dark base, 8 colours\. Ready to import/)).toBeVisible();
    await panel.getByRole('button', { name: 'Import theme' }).click();
    await expect.poll(() => server.config.themes?.[0]?.id).toBe('midnight');

    const group = page.getByRole('radiogroup', { name: 'Theme' });
    await group.getByRole('radio', { name: /Midnight/ }).click();
    await expect.poll(() => pageColour(page)).toBe('oklch(0.15 0.02 255)');
    // The browser really paints it: the page background is no longer the built-in's.
    await expect.poll(() => painted(page)).not.toBe(before);
    // A dialog portalled from the page is in it too.
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();
    expect(
      await dialog.evaluate((el) => el.closest('.jh-ui').style.getPropertyValue('--jh-bg'))
    ).toBe('oklch(0.15 0.02 255)');
    await page.keyboard.press('Escape');

    // A reload keeps the choice (this browser) and the theme (the config).
    await page.reload();
    await expect(page.getByRole('banner')).toBeVisible();
    await expect.poll(() => pageColour(page)).toBe('oklch(0.15 0.02 255)');

    // Another device has the theme, though it chose nothing: it is offered, not applied.
    const other = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await openApp(other, '/settings/appearance', { answers, theme: null });
    expect(await pageColour(other)).toBe('');
    await other
      .getByRole('radiogroup', { name: 'Theme' })
      .getByRole('radio', { name: /Midnight/ })
      .click();
    await expect.poll(() => pageColour(other)).toBe('oklch(0.15 0.02 255)');
  });

  test('a theme that fails is rejected with the pairing named, Import stays off, and nothing changes', async ({
    page,
  }) => {
    const { server, answers } = keeper({});
    await openApp(page, '/settings/appearance', { answers });
    const panel = page.getByRole('region', { name: 'Custom themes' });
    await panel.getByRole('textbox', { name: /Theme JSON/ }).fill(JSON.stringify(DIM));
    await expect(panel.getByText('Dim would be rejected')).toBeVisible();
    await expect(panel.getByText(/text-2 on surface-1: \d\.\d\d:1, needs 4\.5:1/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Import theme' })).toBeDisabled();
    expect(server.config.themes).toBeUndefined();

    const hostile = { ...midnight, tokens: { bg: 'red; } body { display: none }' } };
    await panel.getByRole('textbox', { name: /Theme JSON/ }).fill(JSON.stringify(hostile));
    await expect(panel.getByText(/bg is not a colour/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Import theme' })).toBeDisabled();
  });

  test('a rejected theme in the config is listed apart, never applied, and can be removed', async ({
    page,
  }) => {
    const { server, answers } = keeper({ themes: [midnight, DIM] });
    await openApp(page, '/settings/appearance', { answers, theme: 'custom:dark:dim' });
    const rejected = page.getByRole('region', { name: 'Rejected' });
    await expect(rejected.getByText('Dim is rejected')).toBeVisible();
    await expect(rejected.getByText(/text-2 on surface-1/)).toBeVisible();
    await expect(page.getByText('Dim is rejected, so Dark is showing')).toBeVisible();
    expect(await pageColour(page)).toBe('');
    await rejected.getByRole('button', { name: 'Remove Dim' }).click();
    await expect.poll(() => server.config.themes.map((t) => t.id)).toEqual(['midnight']);
    await expect(rejected).toHaveCount(0);
  });

  for (const [name, theme] of Object.entries(THEMES)) {
    test(`axe finds nothing on the page in a custom theme, ${name}`, async ({ page }) => {
      const base = theme === 'light' ? 'light' : 'dark';
      const t = {
        ...midnight,
        id: 'x',
        name: 'X',
        base,
        tokens: base === 'dark' ? midnight.tokens : { bg: '#fafafb' },
      };
      const { answers } = keeper({ themes: [t] });
      await openApp(page, '/settings/appearance', { answers, theme: `custom:${base}:x` });
      await expect.poll(() => pageColour(page)).not.toBe('');
      await expect(page.getByRole('heading', { level: 1, name: 'Appearance' })).toBeVisible();
      expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
    });
  }
});
