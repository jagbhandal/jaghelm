/*
 * No signal in a real browser (#480, #495): the one rule for a stale status.
 * The Overview opens on the incident with its NAS at 94.6 % disk (red in the
 * attention panel, amber on the NAS's card), then /api/status stops: refused,
 * as a server that can't be reached, or answered 503, as the server answers
 * once its status is past the cache's TTL. At 1440 × 900 and 768 × 1024 (the
 * narrowest window that draws the desktop Overview; a phone's screens are
 * e2e/phone.spec.mjs's, #303), dark and light:
 *
 *  - fresh, the colour probe (statusHues, app.mjs) finds the red and the
 *    amber where the model puts them, so it can't pass by finding nothing;
 *  - stale, no red, amber or green anywhere in the header, the Overview's
 *    status (the attention panel and the subsystem strip), the
 *    Infrastructure section or the Services section (#300): every colour each
 *    element draws, read in OKLCH, and every lamp the steel ring (no signal);
 *  - the header and the panel say the same age, and it moves on;
 *  - the next answer brings the colours back.
 *
 * Screenshots of the No-signal state, both sizes, dark and light, for the
 * PR, in test-results/e2e/shots/.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { THEMES, WIDTHS, openApp, statusHues } from './app.mjs';
import { nasDiskIncident } from '../src/testing/statusFixtures.js';

const header = (page) => page.getByRole('banner');
const headerLink = (page) => header(page).locator('[data-slot="header-status"] a');
const statusArea = (page) => page.locator('[data-slot="overview-status"]');
const panel = (page) => statusArea(page).getByRole('region', { name: 'Needs attention' });
const section = (page) => page.locator('[data-slot="infrastructure-section"]');
const services = (page) => page.locator('[data-slot="services-section"]');
// A node's swatch is the user's own colour (#299), never a status.
const SWATCH = '[data-slot="node-swatch"]';

/** Every red, amber or green drawn in each place, and its lamps. */
async function probe(page) {
  const out = {};
  for (const [name, area, skip] of [
    ['header', header(page)],
    ['status', statusArea(page)],
    ['infrastructure', section(page), SWATCH],
    ['services', services(page)],
  ]) {
    out[name] = await statusHues(area, { skip });
  }
  return out;
}

/** The Overview on the NAS incident, everything drawn, with the clock in the test's hands. */
async function openIncident(page, theme) {
  await page.clock.install();
  const nas = nasDiskIncident();
  const server = await openApp(page, '/', {
    theme,
    answers: { '/api/status': nas.status, '/api/services': nas.services },
  });
  await expect(panel(page)).toBeVisible();
  await expect(section(page).getByRole('article', { name: 'Storage' })).toBeVisible();
  await expect(page.locator('.section-title', { hasText: 'Network Edge' })).toBeVisible();
  return server;
}

const SIZES = { desktop: WIDTHS.desktop, tablet: { width: 768, height: 1024 } };

for (const [size, viewport] of Object.entries(SIZES)) {
  test.describe(`No signal at ${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport });

    for (const theme of Object.keys(THEMES)) {
      for (const [answer, why] of [
        ['down', 'the server unreachable'],
        ['expired', 'the status past its TTL (503)'],
      ]) {
        test(`${why}, ${theme}: no red, amber or green in the header, the status, the strip or Infrastructure`, async ({
          page,
        }) => {
          const server = await openIncident(page, theme);
          // Fresh: the probe sees the model's red and amber.
          const fresh = await probe(page);
          expect(fresh.status.found).toContainEqual(expect.objectContaining({ hue: 'red' }));
          expect(fresh.infrastructure.found).toContainEqual(
            expect.objectContaining({ hue: 'amber' })
          );
          expect(fresh.services.found).toContainEqual(expect.objectContaining({ hue: 'red' }));

          server[answer] = true;
          await page.clock.runFor(30_000);
          await expect(headerLink(page)).toHaveAttribute('data-state', 'unknown');
          await expect(panel(page)).toHaveAttribute('data-state', 'unknown');
          await expect(section(page).getByRole('article', { name: 'Storage' })).toHaveAttribute(
            'data-state',
            'unknown'
          );
          await expect(services(page)).toContainText('No signal · last known');

          const stale = await probe(page);
          for (const [place, { found, unread, lamps }] of Object.entries(stale)) {
            expect(unread, `${place}: colours the probe can't read`).toEqual([]);
            expect(found, `${place}: red, amber or green`).toEqual([]);
            expect(lamps.length, `${place}: lamps`).toBeGreaterThan(0);
            expect(
              lamps.filter((l) => l.state !== 'unknown'),
              `${place}: every lamp no signal`
            ).toEqual([]);
          }

          // The same age in the header and the panel, read in one frame (the
          // clock runs on), moving on.
          const ages = () =>
            page.evaluate(() => {
              const age = (text) => /last known (.+?)(?::|$)/.exec(text ?? '')?.[1] ?? null;
              const header = document.querySelector('[data-slot="header-status"] a');
              const heading = document.querySelector(
                '[data-slot="overview-status"] [data-slot="attention-panel"] h2'
              );
              return [age(header?.textContent), age(heading?.textContent)];
            });
          const [first, again] = await ages();
          expect(first).toMatch(/s ago$/);
          expect(again).toBe(first);
          await page.clock.runFor(90_000);
          await expect(panel(page).getByRole('heading', { level: 2 })).toContainText(
            'last known 2 min ago'
          );
          expect(await ages()).toEqual(['2 min ago', '2 min ago']);

          if (answer === 'down') {
            const dir = join(test.info().project.outputDir, 'shots');
            mkdirSync(dir, { recursive: true });
            await page.mouse.move(0, 0);
            await page.screenshot({ path: `${dir}/no-signal-${size}-${theme}.png` });
            const tabs = await page.addStyleTag({
              content: '[data-slot="bottom-tabs"] { visibility: hidden !important; }',
            });
            await section(page).evaluate((el) => el.scrollIntoView({ block: 'start' }));
            await section(page).screenshot({
              path: `${dir}/no-signal-infrastructure-${size}-${theme}.png`,
            });
            await services(page).evaluate((el) => el.scrollIntoView({ block: 'start' }));
            await services(page).screenshot({
              path: `${dir}/no-signal-services-${size}-${theme}.png`,
            });
            await tabs.evaluate((el) => el.remove());
            await page.evaluate(() => window.scrollTo(0, 0));
          }

          // The next answer brings every colour back.
          server[answer] = false;
          await page.clock.runFor(30_000);
          await expect(headerLink(page)).toHaveAttribute('data-state', 'crit');
          await expect(section(page).getByRole('article', { name: 'Storage' })).toHaveAttribute(
            'data-state',
            'warn'
          );
          const back = await probe(page);
          expect(back.status.found).toContainEqual(expect.objectContaining({ hue: 'red' }));
          expect(back.infrastructure.found).toContainEqual(
            expect.objectContaining({ hue: 'amber' })
          );
          expect(back.services.found).toContainEqual(expect.objectContaining({ hue: 'red' }));
          await expect(page.getByText(/last known/)).toHaveCount(0);
        });
      }
    }
  });
}
