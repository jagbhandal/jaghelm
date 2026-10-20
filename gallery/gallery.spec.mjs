/*
 * The component gallery's checks (#289, docs/GALLERY.md). For every variant of
 * every state in catalog.js, alone on its page (?state=<variant>):
 *
 *  - its screenshot matches gallery/baselines/<variant>.png exactly: the
 *    state's own element, or the whole viewport for an isolated state (an open
 *    overlay, focus, toasts), whose popups sit outside it;
 *  - axe finds no violation in the whole document, the portal roots at the
 *    end of <body> included, with every rule axe runs by default and two
 *    exceptions scoped to Base UI's markup (axe.mjs), which the tests below
 *    show are narrow and still needed;
 *  - nothing is logged as an error, and nothing is fetched from another origin.
 *
 * Plus: the baselines are exactly the variants (no stale file), and the full
 * gallery page lists every variant.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { READY_ATTRIBUTE, STATE_ATTRIBUTE, VARIANTS } from './catalog.js';
import { AXE_REGION_DEFAULT, FOCUS_GUARD, SELECT_LIST, axeFindings, axeResults } from './axe.mjs';

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
    // A state shown under the pointer (an infotip) is hovered here, as a
    // person would, and then waits for what it opens.
    if (variant.state.hover) {
      await page.hover(variant.state.hover);
      for (const [selector, n] of Object.entries(variant.state.wait ?? {})) {
        await expect(page.locator(selector)).toHaveCount(n);
      }
    }
    await settled(page);

    const target = variant.state.isolated ? page : page.locator(`[id="${variant.id}"]`);
    await expect.soft(target).toHaveScreenshot(`${variant.id}.png`);

    expect.soft(await axeFindings(page), 'axe violations').toEqual([]);
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

/** The open Select, alone and settled: where both axe exceptions apply. */
async function openSelect(page) {
  const problems = await open(page, '/gallery/index.html?state=select-open--dark-comfortable');
  await expect(page.locator('html')).toHaveAttribute(READY_ATTRIBUTE, 'true');
  await settled(page);
  return problems;
}

test('the axe exceptions are still needed: without them the open Select fails', async ({
  page,
}) => {
  await openSelect(page);
  expect(await page.locator(FOCUS_GUARD).count(), "Base UI's focus guards").toBeGreaterThan(0);
  expect(await page.locator(SELECT_LIST).count(), "the Select's list").toBe(1);
  const { violations } = await new AxeBuilder({ page }).analyze();
  // When Base UI changes and this fails, drop the exception it names (axe.mjs).
  expect(violations.map((v) => v.id).sort()).toEqual(['aria-hidden-focus', 'region']);
});

test('the axe exceptions are narrow: the same findings elsewhere still fail', async ({ page }) => {
  await openSelect(page);
  expect(await axeFindings(page), 'the open Select passes with the exceptions').toEqual([]);
  await page.evaluate(() => {
    const main = document.querySelector('main');
    const make = (tag, id, text, attributes = {}) => {
      const el = document.createElement(tag);
      el.id = id;
      el.textContent = text;
      for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
      return el;
    };
    main.append(
      // Focusable and hidden from assistive tech, but not a Base UI focus guard.
      make('span', 'planted-hidden-focus', 'Hidden, yet reachable by Tab', {
        'aria-hidden': 'true',
        tabindex: '0',
      }),
      // A Base UI focus guard, but not beside a Select's trigger or list.
      make('span', 'planted-guard', '', {
        'aria-hidden': 'true',
        tabindex: '0',
        'data-base-ui-focus-guard': '',
      }),
      // Any other rule still runs: text far below 4.5:1.
      make('p', 'planted-contrast', 'Low contrast', { style: 'color:#777;background:#7a7a7a' })
    );
    // Content outside every landmark: in <body>, and in another portal root.
    const portal = make('div', 'planted-portal', '', { 'data-base-ui-portal': '', class: 'jh-ui' });
    portal.append(make('p', 'planted-portal-text', 'In another portal'));
    document.body.append(make('p', 'planted-outside', 'Outside every landmark'), portal);
  });
  const found = await axeFindings(page);
  const rule = (id, target) => found.some((f) => f.startsWith(`${id} `) && f.includes(target));
  expect(rule('aria-hidden-focus', '#planted-hidden-focus'), found.join('\n')).toBe(true);
  expect(rule('aria-hidden-focus', '#planted-guard'), found.join('\n')).toBe(true);
  expect(rule('color-contrast', '#planted-contrast'), found.join('\n')).toBe(true);
  expect(rule('region', '#planted-outside'), found.join('\n')).toBe(true);
  expect(rule('region', '#planted-portal'), found.join('\n')).toBe(true);
  expect(found, 'nothing of the Select itself').toHaveLength(5);
});

test('the axe check runs every rule axe runs by default', async ({ page }) => {
  await openSelect(page);
  const results = await axeResults(page);
  const ran = new Set(
    ['passes', 'violations', 'incomplete', 'inapplicable'].flatMap((k) =>
      results[k].map((r) => r.id)
    )
  );
  // The rules axe runs by default, from its own copy in the page: those it
  // enables (the AAA ones it doesn't), less the experimental and deprecated,
  // which a default run leaves out. axe has no public list of them.
  const defaults = await page.evaluate(() =>
    window.axe._audit.rules
      .filter((r) => r.enabled && !r.tags.some((t) => t === 'experimental' || t === 'deprecated'))
      .map((r) => r.id)
  );
  expect(defaults.length).toBeGreaterThan(50);
  expect([...ran].sort()).toEqual([...defaults].sort());
});

test("the region exception keeps axe's own default list", () => {
  // axe-core's region check, as installed: our matcher only adds the Select's
  // list to it. An axe upgrade that changes its default fails here.
  const source = readFileSync(createRequire(import.meta.url).resolve('axe-core'), 'utf8');
  const rule = source.slice(source.indexOf("id: 'region',"), source.indexOf("id: 'region',") + 400);
  expect(rule).toContain(`regionMatcher: '${AXE_REGION_DEFAULT}'`);
});
