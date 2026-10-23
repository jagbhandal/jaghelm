/*
 * The history charts in a real browser (#311), on the demo's answers to
 * /api/history (the live route's shape, made-up readings), at 1440px:
 *
 *  - A node's drawer: History with the range switch at 1 h, its Usage chart
 *    (CPU, memory and disk, each named at its line's end) and, with a sensor,
 *    its Temperature; 7 d reads the week, whose time axis names its days,
 *    evenly, the two charts on one time axis (the same plot edges and days).
 *  - A container's drawer: its CPU and Memory charts.
 *  - The pointer over a chart: the crosshair and the tooltip of every line.
 *  - The Overview's node cards draw their hour of CPU from the same endpoint.
 *  - axe finds nothing with the charts drawn, dark and light.
 *
 * And at 390px, the phone's sheet (#602): a node's and a container's draw the
 * same charts, one a row on one time axis, the range switch's segments 44px
 * tall; by touch a finger shows the crosshair, a drag moves it, lifting hides
 * it; axe finds nothing.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { THEMES, WIDTHS, axeFindings, openApp } from './app.mjs';

const drawer = (page) => page.locator('[data-slot="drawer"]');
const history = (page) => drawer(page).getByRole('region', { name: 'History' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(WIDTHS.desktop);
});

const sheet = (page, name) => page.getByRole('dialog', { name });
const sheetHistory = (page, name) => sheet(page, name).getByRole('region', { name: 'History' });

/** A finger on the page, through Chromium's own touch input: [x, y] points, down, moves, up. */
async function touch(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const send = (type, at) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: at ? [{ x: at[0], y: at[1], id: 1 }] : [],
    });
  return {
    down: (at) => send('touchStart', at),
    move: (at) => send('touchMove', at),
    up: () => send('touchEnd'),
  };
}

test.describe("the phone's sheet (#602)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(WIDTHS.phone);
  });

  test("a node's: Usage and Temperature one a row on one time axis, a 44px switch, the week at 7 d", async ({
    page,
  }) => {
    const asked = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname === '/api/history' && u.searchParams.get('entity')) asked.push(u.search);
    });
    await openApp(page, '/?entity=nodes/edge');
    const history = sheetHistory(page, 'Network Edge');
    await expect(history.getByRole('img', { name: 'Usage, last hour' })).toBeVisible();
    await expect(history.getByRole('img', { name: 'Temperature, last hour' })).toBeVisible();
    await expect(history.locator('[data-chart="usage"] [data-slot="chart-label"]')).toHaveText(
      ['CPU', 'Memory', 'Disk'],
      { useInnerText: true }
    );
    expect(asked).toHaveLength(1);
    // A thumb's target: every segment 44px tall, and at least as wide.
    for (const radio of await history.getByRole('radio').all()) {
      const box = await radio.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    // One chart a row, the plots on one time axis, inside the phone's width.
    const plots = history.locator('[data-slot="chart-plot"]');
    const [a, b] = [await plots.nth(0).boundingBox(), await plots.nth(1).boundingBox()];
    expect(b.y).toBeGreaterThan(a.y + a.height);
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.5);
    expect(Math.abs(a.width - b.width)).toBeLessThan(0.5);
    expect(a.x + a.width).toBeLessThanOrEqual(WIDTHS.phone.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      WIDTHS.phone.width
    );

    await history.getByRole('radio', { name: '7 d' }).click();
    await expect(history.getByRole('img', { name: 'Usage, last 7 days' })).toBeVisible();
    await expect(
      history.locator('[data-chart="usage"] [data-slot="chart-x"] span').first()
    ).toHaveText(/^\w{3} \d{1,2}$/);
    expect(asked.at(-1)).toContain('range=7d');
  });

  test("a container's: its CPU and its Memory", async ({ page }) => {
    await openApp(page, '/?entity=services/apps:jellyfin');
    const history = sheetHistory(page, 'Jellyfin');
    await expect(history.getByRole('img', { name: 'CPU, last hour' })).toBeVisible();
    await expect(history.getByRole('img', { name: 'Memory, last hour' })).toBeVisible();
    await expect(history.locator('[data-slot="chart-line"]')).toHaveCount(2);
  });

  test('by touch: a finger shows the crosshair, a drag moves it, lifting hides it', async ({
    page,
  }) => {
    await openApp(page, '/?entity=nodes/storage');
    const history = sheetHistory(page, 'Storage');
    const plot = history.locator('[data-chart="usage"] [data-slot="chart-plot"]');
    await expect(plot).toBeVisible();
    const box = await plot.boundingBox();
    const y = box.y + box.height / 2;
    const tip = history.locator('[data-slot="chart-tooltip"]');
    const finger = await touch(page);
    await finger.down([box.x + box.width * 0.3, y]);
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('CPU');
    await expect(tip).toContainText('Disk');
    const first = await tip.locator('span').first().innerText();
    await finger.move([box.x + box.width * 0.6, y]);
    await finger.move([box.x + box.width * 0.9, y]);
    await expect(tip.locator('span').first()).not.toHaveText(first);
    await finger.up();
    await expect(tip).toHaveCount(0);
    await expect(history.locator('[data-slot="chart-crosshair"]')).toHaveCount(0);
  });

  for (const theme of Object.values(THEMES)) {
    test(`axe finds nothing on a node's sheet with its charts (${theme})`, async ({ page }) => {
      await openApp(page, '/?entity=nodes/edge', { theme });
      const history = sheetHistory(page, 'Network Edge');
      await expect(history.getByRole('img', { name: 'Temperature, last hour' })).toBeVisible();
      expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
    });
  }
});

test("a node's drawer: Usage and Temperature at 1 h, the week at 7 d", async ({ page }) => {
  const asked = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname === '/api/history' && u.searchParams.get('entity')) asked.push(u.search);
  });
  await openApp(page, '/?entity=nodes/edge');
  const usage = history(page).getByRole('img', { name: 'Usage, last hour' });
  await expect(usage).toBeVisible();
  await expect(history(page).getByRole('img', { name: 'Temperature, last hour' })).toBeVisible();
  await expect(history(page).getByRole('radio', { name: '1 h' })).toBeChecked();
  const chart = history(page).locator('[data-chart="usage"] [data-slot="chart"]');
  await expect(chart.locator('[data-slot="chart-line"]')).toHaveCount(3);
  await expect(chart.locator('[data-slot="chart-label"]')).toHaveText(['CPU', 'Memory', 'Disk'], {
    useInnerText: true,
  });
  expect(asked).toHaveLength(1);

  await history(page).getByRole('radio', { name: '7 d' }).click();
  await expect(history(page).getByRole('img', { name: 'Usage, last 7 days' })).toBeVisible();
  // Day names, as many as fit the drawer's width without touching.
  await expect(chart.locator('[data-slot="chart-x"] span').first()).toHaveText(/^\w{3} \d{1,2}$/);
  expect(await chart.locator('[data-slot="chart-x"] span').count()).toBeGreaterThanOrEqual(3);
  expect(asked.at(-1)).toContain('range=7d');

  // One time axis for the panel: Usage (%) and Temperature (°C) plots start
  // at the same x, are as wide, and tick the same days, evenly.
  await expect(history(page).getByRole('img', { name: 'Temperature, last 7 days' })).toBeVisible();
  const plots = history(page).locator('[data-slot="chart-plot"]');
  const [a, b] = [await plots.nth(0).boundingBox(), await plots.nth(1).boundingBox()];
  expect(Math.abs(a.x - b.x)).toBeLessThan(0.5);
  expect(Math.abs(a.width - b.width)).toBeLessThan(0.5);
  const days = (key) =>
    history(page).locator(`[data-chart="${key}"] [data-slot="chart-x"] span`).allInnerTexts();
  expect(await days('temperature')).toEqual(await days('usage'));
  const lefts = await history(page)
    .locator('[data-chart="usage"] [data-slot="chart-x"] span')
    .evaluateAll((spans) => spans.map((s) => s.getBoundingClientRect().left + s.offsetWidth / 2));
  const steps = lefts.slice(1).map((x, i) => Math.round(x - lefts[i]));
  expect(Math.max(...steps) - Math.min(...steps)).toBeLessThanOrEqual(2);
});

test("a container's drawer: its CPU and its Memory", async ({ page }) => {
  await openApp(page, '/?entity=services/apps:jellyfin');
  await expect(history(page).getByRole('img', { name: 'CPU, last hour' })).toBeVisible();
  await expect(history(page).getByRole('img', { name: 'Memory, last hour' })).toBeVisible();
  // No sensor chart for a container, and every line drawn.
  await expect(history(page).getByRole('img', { name: /^Temperature/ })).toHaveCount(0);
  await expect(history(page).locator('[data-slot="chart-line"]')).toHaveCount(2);
});

test('the pointer over a chart: the crosshair and every line’s value', async ({ page }) => {
  await openApp(page, '/?entity=nodes/storage');
  const plot = history(page).locator('[data-chart="usage"] [data-slot="chart-plot"]');
  await expect(plot).toBeVisible();
  const box = await plot.boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  const tip = history(page).locator('[data-slot="chart-tooltip"]');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('CPU');
  await expect(tip).toContainText('Memory');
  await expect(tip).toContainText('Disk');
  await expect(history(page).locator('[data-slot="chart-dot"]')).toHaveCount(3);
});

test("the Overview's node cards draw their hour of CPU", async ({ page }) => {
  await openApp(page, '/');
  const cards = page.locator('[data-slot="node-card"]');
  await expect(cards.first()).toBeVisible();
  await expect(cards.locator('[data-slot="sparkline-line"]')).toHaveCount(await cards.count());
});

for (const theme of Object.values(THEMES)) {
  test(`axe finds nothing with the charts drawn (${theme})`, async ({ page }) => {
    await openApp(page, '/?entity=nodes/edge', { theme });
    await expect(history(page).getByRole('img', { name: 'Temperature, last hour' })).toBeVisible();
    expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
  });
}
