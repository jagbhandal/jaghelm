/*
 * The component gallery's checks (#289, docs/GALLERY.md). For every variant of
 * every state in catalog.js, alone on its page (?state=<variant>):
 *
 *  - its screenshot matches gallery/baselines/<variant>.png exactly: the
 *    state's own element, or the whole viewport for an isolated state (an open
 *    overlay, focus, toasts), whose popups sit outside it;
 *  - axe finds no violation in the whole document, the portal roots at the
 *    end of <body> included, with every rule axe runs by default;
 *  - nothing is logged as an error, and nothing is fetched from another origin.
 *
 * Plus: the baselines are exactly the variants (no stale file), and the full
 * gallery page lists every variant.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { READY_ATTRIBUTE, STATE_ATTRIBUTE, VARIANTS } from './catalog.js';

/** The frozen clock: every Date the page reads is this. */
const NOW = new Date('2026-10-20T09:00:00Z');
const BASELINES = fileURLToPath(new URL('./baselines/', import.meta.url));

/** Opens `path`, failing the test on an error logged or a request elsewhere. */
async function open(page, path) {
  const problems = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  const origin = new URL(test.info().project.use.baseURL).origin;
  await page.route(
    (url) => url.origin !== origin,
    (route) => {
      problems.push(`request to another origin: ${route.request().url()}`);
      return route.abort();
    }
  );
  await page.clock.setFixedTime(NOW);
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute(READY_ATTRIBUTE, /.+/);
  return problems;
}

/** Every transition and animation done, and no popup between states. */
async function settled(page) {
  await page.waitForFunction(
    () =>
      document.getAnimations().every((a) => a.playState !== 'running') &&
      !document.querySelector('[data-starting-style], [data-ending-style]')
  );
}

for (const variant of VARIANTS) {
  test(variant.id, async ({ page }) => {
    const problems = await open(page, `/gallery/index.html?state=${variant.id}`);
    await expect(page.locator('html'), 'the page is ready').toHaveAttribute(
      READY_ATTRIBUTE,
      'true'
    );
    await settled(page);

    const target = variant.state.isolated ? page : page.locator(`[id="${variant.id}"]`);
    await expect.soft(target).toHaveScreenshot(`${variant.id}.png`);

    const { violations } = await new AxeBuilder({ page }).analyze();
    const found = violations.flatMap((v) =>
      v.nodes.map((n) => `${v.id} (${v.impact}): ${n.target.join(' ')}: ${n.failureSummary}`)
    );
    expect.soft(found, 'axe violations').toEqual([]);
    expect(problems, 'errors and outside requests').toEqual([]);
  });
}

test('the baselines are exactly the variants', () => {
  const files = readdirSync(BASELINES)
    .filter((f) => f.endsWith('.png'))
    .sort();
  const expected = VARIANTS.map((v) => `${v.id}.png`).sort();
  expect(
    files.filter((f) => !expected.includes(f)),
    'baselines with no variant'
  ).toEqual([]);
  expect(
    expected.filter((f) => !files.includes(f)),
    'variants with no baseline'
  ).toEqual([]);
});

test('the full gallery shows every variant', async ({ page }) => {
  const problems = await open(page, '/gallery/index.html');
  const inline = await page
    .locator(`[${STATE_ATTRIBUTE}]`)
    .evaluateAll((els) => els.map((e) => e.id));
  const framed = await page.locator('iframe').evaluateAll((els) => els.map((e) => e.title));
  expect([...inline, ...framed].sort()).toEqual(VARIANTS.map((v) => v.id).sort());
  expect(new Set(inline).size, 'ids are unique').toBe(inline.length);
  expect(problems).toEqual([]);
});
