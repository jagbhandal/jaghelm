/*
 * Today's extras and the Overview's sections in a real browser (#307), on the
 * demo's own answers.
 *
 *  - Weather and the clock: at 1440px at the top of the Overview's rail when
 *    configured (a place set, the weather on; the clock until switched off),
 *    and not at all when not, the weather never asked for; at 1280 no rail,
 *    and the Launch page has them at its top, over the web search.
 *  - The web search on the Launch page opens the configured engine's results
 *    for the words in a new tab.
 *  - A section switched off in Settings → Appearance → Overview sections is
 *    gone, and stays gone after a reload in a second browser (another
 *    device): the switch is in the display config the server holds. A
 *    browser open from before that switch saves its own without undoing it
 *    (#547): its stale save is refused, rebased and saved again.
 *  - axe finds nothing on the rail with the weather, nor on the Launch page.
 *  - Screenshots of the rail and the Launch page with them, for the PR, in
 *    test-results/e2e/shots/.
 */
import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { APPS, THEMES, axeFindings, demo, openApp, reply } from './app.mjs';

const AT = {
  narrow: { width: 1280, height: 900 },
  rail: { width: 1440, height: 900 },
};
// Toronto, in Celsius: what Settings → Widgets saves.
const TORONTO = {
  showWeather: true,
  weatherLat: '43.65',
  weatherLon: '-79.38',
  weatherCity: 'Toronto',
  tempUnit: 'C',
};
// /api/weather's answer: open-meteo's, in Fahrenheit.
const WEATHER = { current: { temperature_2m: 48.2, weather_code: 3 } };
const NOT_DEMO = { authenticated: true, authRequired: false, demo: false };
const HHMM = /^\d{2}:\d{2}$/;

const rail = (page) => page.getByRole('region', { name: 'Utilities' });
// A node's card in the Infrastructure section, by its name: the Overview drawn.
const boardTitle = (page, title) => page.locator('[data-slot="node-card"]', { hasText: title });

/** The page at `path`, counting the weather reads. */
async function openWith(page, path, config) {
  const reads = { weather: 0 };
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/weather') reads.weather += 1;
  });
  await openApp(page, path, { config, answers: { '/api/weather': WEATHER } });
  return reads;
}

test.describe('at 1440px', () => {
  test.use({ viewport: AT.rail });

  test('the rail has the weather and the clock at its top when configured', async ({ page }) => {
    const reads = await openWith(page, '/', TORONTO);
    await expect(boardTitle(page, 'Network Edge')).toBeVisible();
    const panel = rail(page).getByRole('region', { name: 'Weather and time' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('9°C · Overcast');
    await expect(panel).toContainText('Toronto');
    await expect(panel.locator('time')).toHaveText(HHMM);
    // At the top: the rail's first panel, Quick Launch under it.
    const first = rail(page).locator(':scope > *').first();
    await expect(first).toHaveAttribute('data-slot', 'weather-clock');
    const box = await panel.boundingBox();
    const quick = await rail(page).getByRole('region', { name: 'Quick Launch' }).boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(quick.y);
    expect(reads.weather).toBeGreaterThan(0);
    const scope = new AxeBuilder({ page }).include('[data-slot="utilities-rail"]');
    expect(await axeFindings(scope)).toEqual([]);
  });

  test('without them configured, neither shows, and no weather is asked for', async ({ page }) => {
    const reads = await openWith(page, '/', { ...TORONTO, showWeather: false, showClock: false });
    await expect(boardTitle(page, 'Network Edge')).toBeVisible();
    await expect(rail(page).getByRole('region', { name: 'Checklist' })).toBeVisible();
    await expect(page.locator('[data-slot="weather-clock"]')).toHaveCount(0);
    expect(reads.weather).toBe(0);
  });
});

test.describe('at 1280px', () => {
  test.use({ viewport: AT.narrow });

  test('no rail; the Launch page has them at its top, over the web search', async ({ page }) => {
    await openWith(page, '/', TORONTO);
    await expect(boardTitle(page, 'Network Edge')).toBeVisible();
    await expect(rail(page)).toHaveCount(0);
    await expect(page.locator('[data-slot="weather-clock"]')).toHaveCount(0);

    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Launch' })
      .click();
    const main = page.getByRole('main');
    const panel = main.getByRole('region', { name: 'Weather and time' });
    await expect(panel).toContainText('9°C · Overcast');
    await expect(panel.locator('time')).toHaveText(HHMM);
    const search = main.getByRole('search', { name: 'Web search' });
    const quick = main.getByRole('region', { name: 'Quick Launch' });
    const [p, s, q] = await Promise.all([panel, search, quick].map((l) => l.boundingBox()));
    // Side by side across the top, Quick Launch under both.
    expect(Math.abs(p.y + p.height / 2 - (s.y + s.height / 2))).toBeLessThanOrEqual(1);
    expect(s.x).toBeGreaterThan(p.x);
    expect(q.y).toBeGreaterThan(Math.max(p.y + p.height, s.y + s.height));
    expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
  });

  test('the web search opens the configured engine’s results in a new tab', async ({ page }) => {
    await page
      .context()
      .route('https://duckduckgo.com/**', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Results</title>' })
      );
    await openApp(page, '/launch', { config: { searchEngine: 'duckduckgo' } });
    const search = page.getByRole('search', { name: 'Web search' });
    const field = search.getByRole('searchbox', { name: 'Search the web with DuckDuckGo' });
    await field.fill('zfs scrub schedule');
    const [tab] = await Promise.all([
      page.context().waitForEvent('page'),
      search.getByRole('button', { name: 'Search' }).click(),
    ]);
    await tab.waitForLoadState();
    expect(tab.url()).toBe('https://duckduckgo.com/?q=zfs%20scrub%20schedule');
    // No opener: the results page can't reach JagHelm's.
    expect(await tab.evaluate(() => window.opener)).toBeNull();
    // JagHelm stays where it was, the field emptied for the next search.
    await expect(page).toHaveURL(/\/launch$/);
    await expect(field).toHaveValue('');
  });
});

/**
 * A browser of its own (another device) on `path`, with a server that keeps
 * the display config it is sent (`server.config`), versioned as the route
 * does (#547): a read answers `server.version` as its ETag, and a save is
 * kept only over it (If-Match), else refused 409 (428 without one). The demo
 * refuses writes, so this server says it is not the demo.
 */
async function openDevice(browser, server, path) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: AT.rail,
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const displayConfig = (request) => {
    server.version ??= 1;
    const etag = () => `"v${server.version}"`;
    if (request.method() !== 'POST') return reply(200, server.config, { ETag: etag() });
    const ifMatch = request.headers()['if-match'];
    if (!ifMatch) return reply(428, { error: 'No version' });
    if (ifMatch !== etag()) return reply(409, { error: 'Stale', stale: true }, { ETag: etag() });
    server.config = request.postDataJSON();
    server.version += 1;
    return reply(200, { ok: true }, { ETag: etag() });
  };
  await openApp(page, path, {
    answers: { '/api/auth/check': NOT_DEMO, '/api/display-config': displayConfig },
  });
  return { context, page };
}

test('a section switched off stays off after a reload on another device', async ({ browser }) => {
  const server = { config: { ...demo('/api/display-config').body, tabs: APPS } };
  const services = (page) => page.locator('[data-slot="overview-services"]');
  const infrastructure = (page) => page.locator('[data-slot="overview-infrastructure"]');

  // One device: the Overview has its Services section; Settings switches it off.
  const one = await openDevice(browser, server, '/');
  await expect(services(one.page)).toBeVisible();
  await one.page.goto('/settings/appearance');
  const box = one.page.getByRole('switch', { name: 'Services' });
  await expect(box).toBeChecked();
  await expect(one.page.getByRole('switch', { name: 'Needs attention' })).toBeDisabled();
  await box.uncheck();
  await expect.poll(() => server.config.overviewSections?.services).toBe(false);

  // Another device, loading afresh: no Services section, the rest as it was.
  const two = await openDevice(browser, server, '/');
  await expect(boardTitle(two.page, 'Network Edge')).toBeVisible();
  await expect(two.page.getByRole('region', { name: 'Needs attention' })).toBeVisible();
  await expect(infrastructure(two.page)).toBeVisible();
  await expect(services(two.page)).toHaveCount(0);
  // And the first, reloaded.
  await one.page.goto('/');
  await expect(boardTitle(one.page, 'Network Edge')).toBeVisible();
  await expect(services(one.page)).toHaveCount(0);

  // Switched on again on the second, it is back on the first after a reload.
  await two.page.goto('/settings/appearance');
  await two.page.getByRole('switch', { name: 'Services' }).check();
  await expect.poll(() => server.config.overviewSections?.services).toBe(true);
  await one.page.reload();
  await expect(services(one.page)).toBeVisible();

  await one.context.close();
  await two.context.close();
});

test('a device open from before another hid a section saves its own switch without bringing the section back (#547)', async ({
  browser,
}) => {
  const server = { config: { ...demo('/api/display-config').body, tabs: APPS } };
  const services = (page) => page.locator('[data-slot="overview-services"]');
  const infrastructure = (page) => page.locator('[data-slot="overview-infrastructure"]');

  // Both devices open Settings → Appearance on the same copy.
  const a = await openDevice(browser, server, '/settings/appearance');
  const b = await openDevice(browser, server, '/settings/appearance');
  for (const { page } of [a, b]) {
    await expect(page.getByRole('switch', { name: 'Services' })).toBeChecked();
  }

  // A hides Services.
  await a.page.getByRole('switch', { name: 'Services' }).uncheck();
  await expect.poll(() => server.config.overviewSections?.services).toBe(false);
  const savedByA = server.version;

  // B, still on the copy from before, hides Infrastructure: its save is
  // refused (409), rebased onto A's and saved once more.
  await b.page.getByRole('switch', { name: 'Infrastructure' }).uncheck();
  await expect.poll(() => server.config.overviewSections?.infrastructure).toBe(false);
  expect(server.config.overviewSections.services).toBe(false);
  expect(server.version).toBe(savedByA + 1);
  await expect(b.page.getByText('Merged with changes from another device')).toBeVisible();
  // B shows A's switch too, without a reload.
  await expect(b.page.getByRole('switch', { name: 'Services' })).not.toBeChecked();
  await expect(b.page.getByRole('switch', { name: 'Infrastructure' })).not.toBeChecked();

  // Both Overviews have neither section, A's after a reload.
  await b.page.goto('/');
  await a.page.goto('/');
  for (const { page } of [a, b]) {
    // Both sections off: the Overview drawn is its Power section.
    await expect(page.getByRole('region', { name: 'Power', exact: true })).toBeVisible();
    await expect(services(page)).toHaveCount(0);
    await expect(infrastructure(page)).toHaveCount(0);
  }

  await a.context.close();
  await b.context.close();
});

test('screenshots of the rail and the Launch page with the weather, for the PR', async ({
  page,
}) => {
  const dir = `${test.info().project.outputDir}/shots`;
  mkdirSync(dir, { recursive: true });
  for (const theme of Object.values(THEMES)) {
    await page.setViewportSize(AT.rail);
    await openApp(page, '/', { theme, config: TORONTO, answers: { '/api/weather': WEATHER } });
    await expect(rail(page).getByText('9°C · Overcast')).toBeVisible();
    await expect(rail(page).getByRole('checkbox').first()).toBeVisible();
    await page.screenshot({ path: `${dir}/extras-rail-1440-${theme}.png` });
    await page.setViewportSize(AT.narrow);
    await openApp(page, '/launch', {
      theme,
      config: TORONTO,
      answers: { '/api/weather': WEATHER },
    });
    await expect(page.getByRole('main').getByText('9°C · Overcast')).toBeVisible();
    await page.screenshot({ path: `${dir}/extras-launch-1280-${theme}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, '/launch', { config: TORONTO, answers: { '/api/weather': WEATHER } });
  await expect(page.getByRole('main').getByText('9°C · Overcast')).toBeVisible();
  await page.screenshot({ path: `${dir}/extras-launch-390-dark.png`, fullPage: true });
});
