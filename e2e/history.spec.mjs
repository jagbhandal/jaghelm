/*
 * The history charts in a real browser (#311), on the demo's answers to
 * /api/history (the live route's shape, made-up readings), at 1440px:
 *
 *  - A node's drawer: History with the range switch at 1 h, its Usage chart
 *    (CPU, memory and disk, each named at its line's end) and, with a sensor,
 *    its Temperature; 7 d reads the week, whose time axis names its days.
 *  - A container's drawer: its CPU and Memory charts.
 *  - The pointer over a chart: the crosshair and the tooltip of every line.
 *  - The Overview's node cards draw their hour of CPU from the same endpoint.
 *  - axe finds nothing with the charts drawn, dark and light.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { THEMES, WIDTHS, axeFindings, openApp } from './app.mjs';

const drawer = (page) => page.locator('[data-slot="drawer"]');
const history = (page) => drawer(page).getByRole('region', { name: 'History' });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(WIDTHS.desktop);
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
