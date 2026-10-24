/*
 * Edit layout in a real browser (#330), on the demo's own answers, with a
 * server that keeps the display config it is sent, versioned as the route
 * does (#547): each device is a browser context of its own.
 *
 *  - An arrangement saved on one device (a section moved, a service pinned)
 *    is on another device when that device next loads the page (the display
 *    config is read at load, not polled), with nothing lost; the first
 *    device keeps it after a reload.
 *  - A device open from before another saved arranges something else: its
 *    stale save is refused, rebased onto the server's copy and saved, both
 *    arrangements kept, with "Merged with changes from another device". A
 *    save refused again takes the server's copy, with "Settings changed on
 *    another device; reloaded".
 *  - Nothing hides an alert: with Services and the strip hidden, the failing
 *    service is still in Needs attention and the header.
 *  - A config with no arrangement draws the Overview as it always was and
 *    sends no save.
 *  - Every move has a keyboard way (Enter on a Move button, focus on it
 *    after, Escape leaves), at 768px, the narrowest window that draws it;
 *    the mouse drag of a row's grip is the same move.
 *  - Screenshots of the mode, for the PR, in test-results/e2e/shots/.
 */
import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { APPS, THEMES, WIDTHS, axeFindings, demo, openApp, reply } from './app.mjs';

const NOT_DEMO = { authenticated: true, authRequired: false, demo: false };
const SECTIONS = ['Infrastructure', 'Power', 'Jobs', 'Services'];
const TABLET = { width: 768, height: 1024 };

const sectionOf = (page, name) =>
  page.locator('[data-slot="overview-board"]').getByRole('region', { name, exact: true });
/** The sections drawn, by their position on the page, top to bottom. */
async function sectionsDrawn(page) {
  const found = [];
  for (const name of SECTIONS) {
    const section = sectionOf(page, name).first();
    if ((await section.count()) === 0) continue;
    const box = await section.boundingBox();
    if (box) found.push({ name, top: box.y });
  }
  return found.sort((a, b) => a.top - b.top).map((s) => s.name);
}
const editButton = (page) => page.getByRole('banner').getByRole('button', { name: 'Edit layout' });
const panel = (page) => page.locator('[data-slot="overview-editor"]');
/** A service's Pin button, whatever node it is on. */
const pinOf = (page, name) =>
  page.getByRole('button', { name: new RegExp(`^Pin ${name}( on |$)`) });
const pinned = (page) => page.locator('[data-group="pinned"]');

/**
 * A browser of its own (another device) on `path`, against `server`:
 * `server.config` is what the server holds, `server.version` its version,
 * `server.refuse` a count of saves to refuse as stale whatever they name.
 */
async function openDevice(browser, server, path = '/', size = WIDTHS.desktop) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: size,
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const displayConfig = (request) => {
    server.version ??= 1;
    const etag = () => `"v${server.version}"`;
    if (request.method() !== 'POST') return reply(200, server.config, { ETag: etag() });
    server.posts = (server.posts ?? 0) + 1;
    const ifMatch = request.headers()['if-match'];
    if (!ifMatch) return reply(428, { error: 'No version' });
    if (server.refuse > 0) {
      server.refuse -= 1;
      return reply(409, { error: 'Stale', stale: true }, { ETag: etag() });
    }
    if (ifMatch !== etag()) return reply(409, { error: 'Stale', stale: true }, { ETag: etag() });
    server.config = request.postDataJSON();
    server.version += 1;
    return reply(200, { ok: true }, { ETag: etag() });
  };
  await openApp(page, path, {
    answers: { '/api/auth/check': NOT_DEMO, '/api/display-config': displayConfig },
  });
  await expect(page.getByRole('region', { name: 'Needs attention' })).toBeVisible();
  await expect(sectionOf(page, 'Services')).toBeVisible();
  return { context, page };
}

const newServer = (config = {}) => ({
  config: { ...demo('/api/display-config').body, tabs: APPS, ...config },
});

test('an arrangement saved on one device is on another, with nothing lost', async ({ browser }) => {
  const server = newServer();
  const a = await openDevice(browser, server);
  const asToday = await sectionsDrawn(a.page);
  expect(asToday).toEqual(SECTIONS.filter((name) => asToday.includes(name)));

  // Device A: Edit layout on; Services up to the top; Gitea pinned.
  await editButton(a.page).click();
  await expect(panel(a.page)).toBeVisible();
  for (let i = 0; i < 3; i++)
    await a.page.getByRole('button', { name: 'Move Services up' }).click();
  expect((await sectionsDrawn(a.page))[0]).toBe('Services');
  await pinOf(a.page, 'Gitea').click();
  await expect(pinned(a.page).getByText('Gitea')).toBeVisible();
  await expect.poll(() => server.config.overviewLayout?.pinned).toEqual(['apps:gitea']);
  expect(server.config.overviewLayout.order[0]).toBe('services');
  // An arrangement: ids and uids, nothing in pixels.
  expect(JSON.stringify(server.config.overviewLayout)).not.toMatch(/\d+px|"x"|"y"|"w"|"h"/);

  // Device B, loading afresh: the same order, the pin, and everything else as it was.
  const b = await openDevice(browser, server);
  expect((await sectionsDrawn(b.page))[0]).toBe('Services');
  await expect(pinned(b.page).getByText('Gitea')).toBeVisible();
  await expect(b.page.getByRole('region', { name: 'Needs attention' })).toBeVisible();
  await expect(panel(b.page)).toHaveCount(0);

  // A, reloaded, has it too.
  await a.page.reload();
  await expect(sectionOf(a.page, 'Services')).toBeVisible();
  expect((await sectionsDrawn(a.page))[0]).toBe('Services');
  await expect(pinned(a.page).getByText('Gitea')).toBeVisible();

  await a.context.close();
  await b.context.close();
});

const LOST =
  'Your layout changed on another device; your last change was not saved. It is shown as saved there.';

test('a device in the mode from before another arranged keeps its other settings, and merges them', async ({
  browser,
}) => {
  const server = newServer();
  const a = await openDevice(browser, server);
  const b = await openDevice(browser, server);
  await editButton(a.page).click();
  await editButton(b.page).click();
  await expect(panel(b.page)).toBeVisible();

  // A moves Services up one place and saves.
  await a.page.getByRole('button', { name: 'Move Services up' }).click();
  await expect.poll(() => server.config.overviewLayout?.order?.indexOf('services')).toBe(2);
  const savedByA = server.version;

  // B, still on the copy from before, hides Power: a different setting. Its
  // save is refused (409), rebased onto A's copy and saved once more.
  await b.page.getByRole('switch', { name: 'Show Power' }).click();
  await expect.poll(() => server.config.overviewSections?.power).toBe(false);
  expect(server.config.overviewLayout.order.indexOf('services')).toBe(2);
  expect(server.version).toBe(savedByA + 1);
  await expect(b.page.getByText('Merged with changes from another device')).toBeVisible();
  // B now shows A's order too, without a reload (and its own hidden Power).
  expect(await sectionsDrawn(b.page)).toEqual(
    (await sectionsDrawn(a.page)).filter((name) => name !== 'Power')
  );
  await a.context.close();
  await b.context.close();
});

test('two devices pinning from the same copy: the second save does not wipe the first’s pins, and says so', async ({
  browser,
}) => {
  const server = newServer();
  const a = await openDevice(browser, server);
  const b = await openDevice(browser, server);
  await editButton(a.page).click();
  await editButton(b.page).click();
  await expect(panel(b.page)).toBeVisible();

  await pinOf(a.page, 'Gitea').click();
  await expect.poll(() => server.config.overviewLayout?.pinned).toEqual(['apps:gitea']);
  const savedByA = server.version;

  // B pins Grafana from the copy it opened on: the same leaf. The server's
  // copy stands, B's pin is dropped, and B is told plainly.
  await pinOf(b.page, 'Grafana').click();
  await expect(b.page.getByText(LOST)).toBeVisible();
  expect(server.config.overviewLayout.pinned).toEqual(['apps:gitea']);
  expect(server.version).toBe(savedByA);
  await expect(pinned(b.page).getByText('Gitea')).toBeVisible();
  await expect(pinned(b.page).getByText('Grafana')).toHaveCount(0);
  // B can pin again now that it shows the server's copy.
  await pinOf(b.page, 'Grafana').click();
  await expect
    .poll(() => server.config.overviewLayout.pinned)
    .toEqual(['apps:gitea', 'apps:grafana']);

  await a.context.close();
  await b.context.close();
});

test('a tab in the mode that is looked at again reads the server’s copy, so its next pin adds to it', async ({
  browser,
}) => {
  const server = newServer();
  const a = await openDevice(browser, server);
  const b = await openDevice(browser, server);
  await editButton(a.page).click();
  await editButton(b.page).click();
  await expect(panel(b.page)).toBeVisible();
  await pinOf(a.page, 'Gitea').click();
  await expect.poll(() => server.config.overviewLayout?.pinned).toEqual(['apps:gitea']);

  // B regains focus: it re-reads, and shows A's pin without a reload.
  await b.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(pinned(b.page).getByText('Gitea')).toBeVisible();
  await pinOf(b.page, 'Grafana').click();
  await expect
    .poll(() => server.config.overviewLayout.pinned)
    .toEqual(['apps:gitea', 'apps:grafana']);
  await expect(b.page.getByText(LOST)).toHaveCount(0);

  await a.context.close();
  await b.context.close();
});

test('Reset order and pins from a stale tab never wipes another device’s arrangement', async ({
  browser,
}) => {
  const server = newServer({ overviewLayout: { pinned: ['apps:gitea'] } });
  const a = await openDevice(browser, server);
  const b = await openDevice(browser, server);
  await editButton(a.page).click();
  await editButton(b.page).click();
  await expect(panel(b.page)).toBeVisible();
  await pinOf(a.page, 'Grafana').click();
  await expect
    .poll(() => server.config.overviewLayout?.pinned)
    .toEqual(['apps:gitea', 'apps:grafana']);
  await b.page.getByRole('button', { name: 'Reset order and pins' }).click();
  await expect(b.page.getByText(LOST)).toBeVisible();
  expect(server.config.overviewLayout.pinned).toEqual(['apps:gitea', 'apps:grafana']);
  await a.context.close();
  await b.context.close();
});

test('a save refused again takes the server’s copy and says so', async ({ browser }) => {
  const server = newServer({ overviewLayout: { order: ['services'] } });
  const b = await openDevice(browser, server);
  expect((await sectionsDrawn(b.page))[0]).toBe('Services');
  await editButton(b.page).click();

  // Every save is refused as stale from here: the rebase's too.
  server.refuse = 2;
  await pinOf(b.page, 'Gitea').click();
  await expect(b.page.getByText('Settings changed on another device; reloaded')).toBeVisible();
  // The server’s copy stands: no pin, its order.
  expect(server.config.overviewLayout).toEqual({ order: ['services'] });
  await expect(pinned(b.page)).toHaveCount(0);
  expect((await sectionsDrawn(b.page))[0]).toBe('Services');

  await b.context.close();
});

test('hiding Services and the strip never hides a failing service', async ({ browser }) => {
  // Opened by hand: openDevice waits for the Services section.
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: WIDTHS.desktop,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await openApp(page, '/', {
    config: { overviewSections: { services: false, strip: false } },
    answers: { '/api/auth/check': NOT_DEMO },
  });
  const attention = page.getByRole('region', { name: 'Needs attention' });
  await expect(attention.getByText('Jellyfin').first()).toBeVisible();
  await expect(sectionOf(page, 'Services')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Subsystems' })).toHaveCount(0);
  await expect(page.getByRole('banner').getByRole('link', { name: /^Critical/ })).toBeVisible();
  // And in Edit layout, with Services switched off there, the alert stays.
  await editButton(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(attention.getByText('Jellyfin').first()).toBeVisible();
  await context.close();
});

test('with no arrangement the Overview is as it always was, and nothing is saved', async ({
  browser,
}) => {
  const server = newServer();
  const a = await openDevice(browser, server);
  const asToday = await sectionsDrawn(a.page);
  expect(asToday).toEqual(SECTIONS.filter((name) => asToday.includes(name)));
  expect(asToday).toContain('Services');
  await expect(pinned(a.page)).toHaveCount(0);
  await expect(panel(a.page)).toHaveCount(0);
  // Entering and leaving Edit layout without a change sends nothing.
  await editButton(a.page).click();
  await expect(panel(a.page)).toBeVisible();
  await a.page.keyboard.press('Escape');
  await expect(panel(a.page)).toHaveCount(0);
  await a.page.waitForTimeout(2500);
  expect(server.posts ?? 0).toBe(0);
  expect(server.config.overviewLayout).toBeUndefined();
  await a.context.close();
});

test('old grid layout keys in a config are ignored by the Overview', async ({ browser }) => {
  const server = newServer({
    gridLayout: { lg: [{ i: 'services', x: 0, y: 0, w: 12, h: 4 }] },
    gridColumns: 12,
  });
  const a = await openDevice(browser, server);
  const plain = await openDevice(browser, newServer());
  expect(await sectionsDrawn(a.page)).toEqual(await sectionsDrawn(plain.page));
  await a.context.close();
  await plain.context.close();
});

test.describe('by keyboard, at 768px', () => {
  test('Enter on Edit layout opens it; Move Services up by Enter keeps focus on it, announces, and Escape leaves', async ({
    browser,
  }) => {
    const server = newServer();
    const a = await openDevice(browser, server, '/', TABLET);
    const button = editButton(a.page);
    await button.focus();
    await a.page.keyboard.press('Enter');
    await expect(panel(a.page)).toBeVisible();
    await expect(button).toHaveAttribute('aria-pressed', 'true');

    const up = a.page.getByRole('button', { name: 'Move Services up' });
    const before = await sectionsDrawn(a.page);
    await up.focus();
    await a.page.keyboard.press('Enter');
    await expect(up).toBeFocused();
    const after = await sectionsDrawn(a.page);
    expect(after.indexOf('Services')).toBe(before.indexOf('Services') - 1);
    await expect(a.page.locator('[data-slot="edit-announce"]')).toHaveText(
      /^Services moved to \d of 4$/
    );

    // The switch is the one Settings has: Space hides Jobs / Power and brings it back.
    const power = a.page.getByRole('switch', { name: 'Show Power' });
    await power.focus();
    await a.page.keyboard.press('Space');
    await expect(sectionOf(a.page, 'Power')).toHaveCount(0);
    await expect.poll(() => server.config.overviewSections?.power).toBe(false);
    await a.page.goto('/settings/appearance');
    await expect(a.page.getByRole('switch', { name: 'Power' })).not.toBeChecked();

    await a.page.goto('/');
    await editButton(a.page).click();
    await expect(panel(a.page)).toBeVisible();
    // Focus is in the panel when it opens, so Escape is heard there.
    await expect
      .poll(() =>
        a.page.evaluate(
          () => document.activeElement?.closest('[data-slot="layout-editor"]') !== null
        )
      )
      .toBe(true);
    await a.page.keyboard.press('Escape');
    await expect(panel(a.page)).toHaveCount(0);
    await expect(editButton(a.page)).toBeFocused();
    await a.context.close();
  });

  test('the whole panel fits the window: no horizontal scroll', async ({ browser }) => {
    const a = await openDevice(browser, newServer(), '/', TABLET);
    await editButton(a.page).click();
    await expect(panel(a.page)).toBeVisible();
    const over = await a.page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(over).toBeLessThanOrEqual(0);
    await a.context.close();
  });
});

test('dragging a row’s grip moves the section, as Move up does', async ({ browser }) => {
  const server = newServer();
  const a = await openDevice(browser, server);
  await editButton(a.page).click();
  const list = a.page.getByRole('list', { name: 'Sections' });
  const grip = list.locator('[data-edit-item="services"] [data-slot="edit-grip"]');
  const target = list.locator('[data-edit-item="infrastructure"]');
  const g = await grip.boundingBox();
  const t = await target.boundingBox();
  await a.page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await a.page.mouse.down();
  await a.page.mouse.move(t.x + t.width / 2, t.y + 4, { steps: 12 });
  await a.page.mouse.up();
  expect((await sectionsDrawn(a.page))[0]).toBe('Services');
  await expect.poll(() => server.config.overviewLayout?.order?.[0]).toBe('services');
  await a.context.close();
});

test('every control in the panel changes something on the Overview', async ({ browser }) => {
  const a = await openDevice(browser, newServer());
  await editButton(a.page).click();
  const names = async () => (await sectionsDrawn(a.page)).join();
  // Hide / show.
  const before = await names();
  await a.page.getByRole('switch', { name: 'Show Infrastructure' }).click();
  expect(await names()).not.toBe(before);
  await a.page.getByRole('switch', { name: 'Show Infrastructure' }).click();
  expect(await names()).toBe(before);
  // Move up and down.
  await a.page.getByRole('button', { name: 'Move Services up' }).click();
  expect(await names()).not.toBe(before);
  await a.page.getByRole('button', { name: 'Move Services down' }).click();
  expect(await names()).toBe(before);
  // Pin, move, unpin.
  await pinOf(a.page, 'Gitea').click();
  await pinOf(a.page, 'Grafana').click();
  const order = () =>
    pinned(a.page)
      .locator('[data-entity]')
      .evaluateAll((els) => els.map((e) => e.dataset.entity));
  expect(await order()).toEqual(['services/apps:gitea', 'services/apps:grafana']);
  await a.page.getByRole('button', { name: /^Move Grafana( on .*)? up$/ }).click();
  expect(await order()).toEqual(['services/apps:grafana', 'services/apps:gitea']);
  await a.page.getByRole('button', { name: /^Unpin Grafana/ }).click();
  expect(await order()).toEqual(['services/apps:gitea']);
  // Group: add one, put Grafana in it.
  await a.page.getByRole('textbox', { name: 'New group name' }).fill('Dashboards');
  await a.page.getByRole('button', { name: 'Add group' }).click();
  await a.page.getByRole('combobox', { name: /^Group for Grafana/ }).click();
  await a.page.getByRole('option', { name: 'Dashboards' }).click();
  await expect(
    a.page.locator('[data-slot="services-group"]', { hasText: 'Dashboards' }).getByText('Grafana')
  ).toBeVisible();
  // Reset: back to how it was, groups aside.
  await a.page.getByRole('button', { name: 'Reset order and pins' }).click();
  await expect(pinned(a.page)).toHaveCount(0);
  await a.context.close();
});

test('screenshots of Edit layout, for the PR', async ({ browser }) => {
  const dir = `${test.info().project.outputDir}/shots`;
  mkdirSync(dir, { recursive: true });
  for (const theme of Object.values(THEMES)) {
    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      viewport: WIDTHS.desktop,
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await openApp(page, '/', {
      theme,
      config: { overviewLayout: { order: ['services'], pinned: ['apps:gitea'] } },
      answers: { '/api/auth/check': NOT_DEMO },
    });
    await editButton(page).click();
    await expect(panel(page)).toBeVisible();
    await page.screenshot({ path: `${dir}/edit-layout-${theme}.png`, fullPage: true });
    const findings = await axeFindings(
      new AxeBuilder({ page }).include('[data-slot="overview-editor"]')
    );
    expect(findings).toEqual([]);
    await context.close();
  }
});
