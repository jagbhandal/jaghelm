/*
 * The utilities in a real browser (#301): Quick Launch, Pipeline and the
 * Checklist, from the demo's own answers (its links, its Gitea commits, its
 * to-dos).
 *
 *  - At 1440px the Overview has its rail beside its sections, the mock's
 *    widths, each panel once; at 1280 there is no rail at all, the Overview
 *    draws none of the three, and the Launch page has all three. Crossing
 *    1440 keeps the sections where they are (no remount).
 *  - No sideways scroll on the Overview or the Launch page at 1280, 1440 and
 *    2560, nor on the Launch page at 390.
 *  - The Checklist adds, ticks and deletes over plain HTTP (#236): the page
 *    has no crypto.randomUUID, as on http://<lan-ip>:3099, and each change
 *    reaches the server, which a reload then shows; on the Launch page at 1280
 *    and in the rail at 1440.
 *  - axe finds nothing on the Launch page, nor on the Overview's shell,
 *    status and rail at 1440, dark and light.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { THEMES, axeFindings, openApp } from './app.mjs';

const AT = {
  phone: { width: 390, height: 844 },
  narrow: { width: 1280, height: 900 },
  rail: { width: 1440, height: 900 },
  wide: { width: 2560, height: 1440 },
};
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PANELS = ['Quick Launch', 'Pipeline', 'Checklist'];

const rail = (page) => page.getByRole('region', { name: 'Utilities' });
const nodeCard = (page, name) =>
  page.locator('[data-slot="infrastructure-section"]').getByRole('article', { name });

/** The Overview, with the sections under its status loaded, so nothing moves. */
async function openOverview(page, theme = 'dark') {
  await openApp(page, '/', { theme });
  await expect(nodeCard(page, 'Network Edge')).toBeVisible();
}

async function openLaunch(page, theme = 'dark') {
  await openApp(page, '/launch', { theme });
  await expect(page.getByRole('heading', { level: 1, name: 'Launch' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pipeline' })).toBeVisible();
  await expect(page.getByRole('checkbox').first()).toBeVisible();
}

/** The page scrolls up and down only. */
async function noSideScroll(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, `${page.url()} scrolls sideways`).toBeLessThanOrEqual(0);
}

/** Every panel's region in `area`, by its name, in order. */
const panelNames = (area) =>
  area
    .locator('[data-slot="quick-launch"], [data-slot="pipeline"], [data-slot="checklist"]')
    .evaluateAll((els) => els.map((el) => el.querySelector('h2').textContent));

test.describe('at 1440px', () => {
  test.use({ viewport: AT.rail });

  test('the Overview has its rail beside its sections, the mock’s widths', async ({ page }) => {
    await openOverview(page);
    await expect(rail(page)).toBeVisible();
    expect(await panelNames(rail(page))).toEqual(PANELS);
    await expect(rail(page).getByRole('link', { name: 'Nextcloud' })).toBeVisible();
    // One of each on the page: the rail's.
    for (const name of PANELS)
      await expect(page.getByRole('region', { name, exact: true })).toHaveCount(1);
    // Beside the sections: right of the status, its top level with the panel's.
    const status = await page.locator('[data-slot="overview-status"]').boundingBox();
    const box = await page.locator('.overview-rail').boundingBox();
    const attention = await page.getByRole('region', { name: 'Needs attention' }).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(status.x + status.width);
    expect(Math.abs(box.y - attention.y)).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(280);
    expect(box.width).toBeLessThanOrEqual(340);
    await noSideScroll(page);
  });

  test('narrowed to 1280 the rail goes, and the sections stay where they were', async ({
    page,
  }) => {
    await openOverview(page);
    await expect(rail(page)).toBeVisible();
    const card = await nodeCard(page, 'Network Edge').elementHandle();
    await page.setViewportSize(AT.narrow);
    await expect(rail(page)).toHaveCount(0);
    expect(await card.evaluate((el) => el.isConnected), 'the sections were not remounted').toBe(
      true
    );
    await page.setViewportSize(AT.rail);
    await expect(rail(page)).toBeVisible();
    expect(await card.evaluate((el) => el.isConnected)).toBe(true);
  });

  for (const theme of Object.values(THEMES)) {
    test(`axe: the Overview's shell, status and rail, ${theme}`, async ({ page }) => {
      await openOverview(page, theme);
      await expect(rail(page).getByRole('region', { name: 'Checklist' })).toBeVisible();
      await expect(rail(page).getByRole('checkbox').first()).toBeVisible();
      const scope = new AxeBuilder({ page })
        .include('[data-slot="app-header"]')
        .include('[data-slot="side-nav"]')
        .include('[data-slot="overview-status"]')
        .include('[data-slot="utilities-rail"]');
      expect(await axeFindings(scope)).toEqual([]);
    });
  }
});

test.describe('at 1280px', () => {
  test.use({ viewport: AT.narrow });

  test('the Overview has no rail at all', async ({ page }) => {
    await openOverview(page);
    await expect(page.getByRole('region', { name: 'Needs attention' })).toBeVisible();
    await expect(rail(page)).toHaveCount(0);
    await expect(page.locator('[data-slot="utilities-rail"]')).toHaveCount(0);
    // Nor the three anywhere on it: below the rail's width they are the
    // Launch page's (#301; the old board drew them here, #306).
    for (const name of PANELS)
      await expect(page.getByRole('region', { name, exact: true })).toHaveCount(0);
    await noSideScroll(page);
  });

  test('the Launch page has all three, from the sidebar’s Tools', async ({ page }) => {
    await openOverview(page);
    const tools = page.getByRole('navigation', { name: 'Main' });
    await tools.getByRole('link', { name: 'Launch' }).click();
    await expect(page).toHaveURL(/\/launch$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Launch' })).toBeVisible();
    const main = page.getByRole('main');
    await expect(main.getByRole('region', { name: 'Pipeline' })).toBeVisible();
    expect(await panelNames(main)).toEqual(PANELS);
    // Every link group in the config, not only the first three.
    for (const group of ['Personal', 'Management', 'Dev & Monitoring'])
      await expect(main.getByRole('list', { name: group })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Grafana' })).toHaveAttribute('target', '_blank');
    await expect(rail(page)).toHaveCount(0);
    await noSideScroll(page);
  });

  for (const theme of Object.values(THEMES)) {
    test(`axe: the Launch page, ${theme}`, async ({ page }) => {
      await openLaunch(page, theme);
      expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
    });
  }
});

for (const [name, viewport] of Object.entries({ phone: AT.phone, wide: AT.wide })) {
  test(`no sideways scroll at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openLaunch(page);
    await noSideScroll(page);
    if (name === 'wide') {
      await openOverview(page);
      await expect(rail(page)).toBeVisible();
      await noSideScroll(page);
    }
  });
}

/**
 * The page at `path`, as a plain-HTTP origin (no crypto.randomUUID), with a
 * server that keeps the to-dos it is sent. The demo refuses writes, so this
 * server says it is not the demo, and /api/todos is answered here.
 */
async function openWithTodos(page, path) {
  await page.addInitScript(() => {
    delete Crypto.prototype.randomUUID;
  });
  const server = {
    todos: [{ id: 'seed', text: 'Patch the NAS', done: false, due: null }],
    saves: 0,
  };
  await openApp(page, path, {
    answers: { '/api/auth/check': { authenticated: true, authRequired: false, demo: false } },
  });
  await page.route('**/api/todos', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      server.todos = request.postDataJSON();
      server.saves += 1;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: server.todos });
  });
  await page.reload();
  return server;
}

for (const [where, path, viewport, scope] of [
  ['the Launch page at 1280', '/launch', AT.narrow, (page) => page.getByRole('main')],
  ['the rail at 1440', '/', AT.rail, rail],
]) {
  test(`${where}: the Checklist adds, ticks and deletes over plain HTTP`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const server = await openWithTodos(page, path);
    const list = scope(page).getByRole('region', { name: 'Checklist' });
    await expect(list.getByRole('checkbox', { name: 'Patch the NAS' })).toBeVisible();
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');

    await list.getByRole('textbox', { name: 'New task' }).fill('Renew the cert');
    await list.getByRole('button', { name: 'Add' }).click();
    await expect(list.getByRole('checkbox', { name: 'Renew the cert' })).toBeVisible();
    await expect
      .poll(() => server.todos.map((t) => t.text))
      .toEqual(['Patch the NAS', 'Renew the cert']);
    expect(server.todos[1].id).toMatch(UUID_V4);

    await list.getByRole('checkbox', { name: 'Renew the cert' }).click();
    await expect.poll(() => server.todos[1]?.done).toBe(true);

    await list.getByRole('button', { name: 'Delete “Patch the NAS”' }).click();
    await expect.poll(() => server.todos.map((t) => t.text)).toEqual(['Renew the cert']);
    expect(server.saves).toBe(3);
    await expect(page.getByText("Couldn't save the checklist")).toHaveCount(0);

    // A reload shows what the server holds.
    await page.reload();
    const after = scope(page).getByRole('region', { name: 'Checklist' });
    await expect(after.getByRole('checkbox', { name: 'Renew the cert' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await expect(after.getByRole('checkbox', { name: 'Patch the NAS' })).toHaveCount(0);
  });
}

test('screenshots of the rail and the Launch page, for the PR', async ({ page }) => {
  const dir = join(test.info().project.outputDir, 'shots');
  mkdirSync(dir, { recursive: true });
  for (const theme of Object.values(THEMES)) {
    await page.setViewportSize(AT.rail);
    await openOverview(page, theme);
    await expect(rail(page).getByRole('checkbox').first()).toBeVisible();
    await page.screenshot({ path: `${dir}/utilities-rail-1440-${theme}.png` });
    await page.setViewportSize(AT.narrow);
    await openLaunch(page, theme);
    await page.screenshot({ path: `${dir}/launch-1280-${theme}.png`, fullPage: true });
  }
  await page.setViewportSize(AT.phone);
  await openLaunch(page);
  await page.screenshot({ path: `${dir}/launch-390-dark.png`, fullPage: true });
});
