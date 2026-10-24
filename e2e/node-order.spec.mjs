/*
 * Node order in a real browser (#667): Settings → Nodes & Services → Nodes moves
 * a node, the display config keeps it (versioned, as the route does, #547), and
 * after a reload the Infrastructure page and the Services page list the nodes in
 * the new order, and so does a second device reading the same config.
 */
import { test, expect } from '@playwright/test';
import { openApp, reply } from './app.mjs';

const NOT_DEMO = { authenticated: true, authRequired: false, demo: false };

/** The server's state, and the answers for openApp. */
function keeper(config = {}) {
  const server = { config, version: 1 };
  const etag = () => `"v${server.version}"`;
  const displayConfig = (request) => {
    if (request.method() !== 'POST') return reply(200, server.config, { ETag: etag() });
    if (request.headers()['if-match'] !== etag())
      return reply(409, { error: 'Stale', stale: true }, { ETag: etag() });
    server.config = request.postDataJSON();
    server.version += 1;
    return reply(200, { ok: true }, { ETag: etag() });
  };
  return { server, answers: { '/api/auth/check': NOT_DEMO, '/api/display-config': displayConfig } };
}

const infrastructure = (page) =>
  page.locator('[data-slot="infrastructure-section"]').getByRole('article');
const serviceGroups = (page) =>
  page.locator('[data-slot="services-section"]').getByRole('heading', { level: 3 });

test.describe('node order', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('move a node, reload: the order changed on Infrastructure and Services, and on another device', async ({
    page,
    browser,
  }) => {
    const { server, answers } = keeper({});

    await openApp(page, '/infrastructure', { answers });
    await expect(infrastructure(page).first()).toBeVisible();
    const before = await infrastructure(page).evaluateAll((all) =>
      all.map((el) => el.getAttribute('aria-label') ?? el.textContent.slice(0, 20))
    );
    expect(before.length).toBeGreaterThan(2);

    await page.goto('/settings/nodes');
    const rows = page.locator('[data-node-row]');
    const keys = () => rows.evaluateAll((all) => all.map((el) => el.dataset.nodeRow));
    await expect(rows.first()).toBeVisible();
    const start = await keys();
    const last = start.at(-1);
    const lastName = await rows.last().locator('.settings-item-title').innerText();

    // The last node up to the top, one press at a time: each press changes the list.
    for (let i = 1; i < start.length; i++) {
      await page.getByRole('button', { name: `Move ${lastName} up` }).click();
      await expect.poll(async () => (await keys()).indexOf(last)).toBe(start.length - 1 - i);
    }
    await expect(page.getByRole('button', { name: `Move ${lastName} up` })).toBeDisabled();
    await expect(
      page.getByRole('status').filter({ hasText: 'moved to position 1 of' })
    ).toHaveCount(1);
    await expect.poll(() => server.config.nodeOrder?.[0]).toBe(last);

    // Move down once: the button does the opposite, then back up.
    await page.getByRole('button', { name: `Move ${lastName} down` }).click();
    await expect.poll(async () => (await keys()).indexOf(last)).toBe(1);
    await page.getByRole('button', { name: `Move ${lastName} up` }).click();
    await expect.poll(async () => (await keys()).indexOf(last)).toBe(0);
    await expect.poll(() => server.config.nodeOrder).toEqual([last, ...start.slice(0, -1)]);

    // A reload keeps it, on Infrastructure and on Services.
    await page.goto('/infrastructure');
    await expect(infrastructure(page).first()).toBeVisible();
    const after = await infrastructure(page).evaluateAll((all) =>
      all.map((el) => el.getAttribute('aria-label') ?? el.textContent.slice(0, 20))
    );
    expect(after).toEqual([before.at(-1), ...before.slice(0, -1)]);
    await page.reload();
    await expect(infrastructure(page).first()).toBeVisible();
    expect(
      await infrastructure(page).evaluateAll((all) =>
        all.map((el) => el.getAttribute('aria-label') ?? el.textContent.slice(0, 20))
      )
    ).toEqual(after);

    await page.goto('/services');
    await expect(serviceGroups(page).first()).toBeVisible();
    const groups = await serviceGroups(page).allInnerTexts();
    expect(groups[0].toLowerCase()).toContain(lastName.toLowerCase());

    // Another device reading the same config lists them the same way.
    const other = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await openApp(other, '/infrastructure', { answers });
    await expect(infrastructure(other).first()).toBeVisible();
    expect(
      await infrastructure(other).evaluateAll((all) =>
        all.map((el) => el.getAttribute('aria-label') ?? el.textContent.slice(0, 20))
      )
    ).toEqual(after);
  });

  test('two quick clicks both move the node, and the keyboard can press Move down twice', async ({
    page,
  }) => {
    const { server, answers } = keeper({});
    await openApp(page, '/settings/nodes', { answers });
    const rows = page.locator('[data-node-row]');
    const keys = () => rows.evaluateAll((all) => all.map((el) => el.dataset.nodeRow));
    await expect(rows.first()).toBeVisible();
    const start = await keys();
    expect(start.length).toBeGreaterThanOrEqual(3);

    // Two clicks in the same tick (no render between them): neither move is lost.
    const last = start.at(-1);
    const lastName = await rows.last().locator('.settings-item-title').innerText();
    await page.getByRole('button', { name: `Move ${lastName} up` }).evaluate((el) => {
      el.click();
      el.click();
    });
    await expect.poll(async () => (await keys()).indexOf(last)).toBe(start.length - 3);
    await expect.poll(() => server.config.nodeOrder?.indexOf(last)).toBe(start.length - 3);

    // Enter twice on Move down: focus stays on the button, so the second press lands.
    const now = await keys();
    const first = now[0];
    const firstName = await rows.first().locator('.settings-item-title').innerText();
    const down = page.getByRole('button', { name: `Move ${firstName} down` });
    await down.focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await keys()).indexOf(first)).toBe(1);
    await expect(down).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await keys()).indexOf(first)).toBe(2);
    // Now last, Move down is off: focus goes to the row's Move up.
    await expect(page.getByRole('button', { name: `Move ${firstName} up` })).toBeFocused();
  });
});
