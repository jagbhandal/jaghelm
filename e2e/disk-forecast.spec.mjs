/*
 * The disk forecast in a real browser (#670): "N days left" under a node's
 * disk meter on the Infrastructure page (cards and table) and on the phone's
 * Infra tab, amber under 14 days and red under 3 by default, always with an
 * icon and words, and "No signal" (never a number) for a node it has no
 * current readings for. The lines are Settings' (`diskForecastDays`): moving
 * them moves the colour. Axe finds nothing. The forecast is answered here
 * (`answers`), apart from the demo's, which draws every number plain.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { axeFindings, demo, openApp, WIDTHS } from './app.mjs';

const forecast = (nodes) => ({
  ok: true,
  computedAt: '2026-10-24T12:00:00Z',
  windowDays: 7,
  nodes,
});
const ok = (daysLeft, mount = '/', primary = true) => ({
  status: 'ok',
  daysLeft,
  mount,
  primary,
  growthBytesPerDay: 1e9,
  r2: 0.98,
  samples: 169,
});
// The demo's nodes: edge, apps and storage.
const NODES = forecast({
  edge: { status: 'nodata', daysLeft: null, mount: '/', primary: true },
  apps: ok(9.6),
  storage: ok(2.4, '/volume1'),
});
const answers = { '/api/disk-forecast': NODES };

const notes = (page) => page.locator('[data-slot="meter-note"]');
const noteOf = (page, state) => page.locator(`[data-slot="meter-note"][data-state="${state}"]`);

test.describe('desktop', () => {
  test.use({ viewport: WIDTHS.desktop });

  test('cards: red under 3 days, amber under 14, No signal for a node without readings; icon and words each', async ({
    page,
  }) => {
    await openApp(page, '/infrastructure', { answers });
    await expect(notes(page)).toHaveCount(3);
    await expect(noteOf(page, 'crit')).toContainText('2 days left');
    await expect(noteOf(page, 'crit')).toContainText('Disk forecast: 2 days left, critical');
    await expect(noteOf(page, 'warn')).toContainText('9 days left');
    await expect(noteOf(page, 'warn')).toContainText('Disk forecast: 9 days left, warning');
    await expect(noteOf(page, 'unknown')).toContainText('No signal');
    for (const note of await notes(page).all()) await expect(note.locator('svg')).toHaveCount(1);
  });

  test('the table draws it in the Disk column', async ({ page }) => {
    await openApp(page, '/infrastructure', { answers });
    await page.getByRole('radio', { name: 'Table' }).click();
    const row = page.getByRole('row', { name: /Storage/ });
    await expect(row.locator('[data-slot="meter-note"][data-state="crit"]')).toContainText(
      '2 days left'
    );
  });

  test('moving the lines in Settings moves the colour', async ({ page }) => {
    await openApp(page, '/infrastructure', {
      answers,
      config: { diskForecastDays: { warn: 20, crit: 12 } },
    });
    // 9.6 and 2.4 days are both under 12: red. Nothing is amber.
    await expect(noteOf(page, 'crit')).toHaveCount(2);
    await expect(noteOf(page, 'warn')).toHaveCount(0);
  });

  test('a failed read (ok:false) draws nothing, and no node is told No signal for it', async ({
    page,
  }) => {
    await openApp(page, '/infrastructure', {
      answers: {
        '/api/disk-forecast': { ok: false, error: 'Prometheus refused the connection', nodes: {} },
      },
    });
    await expect(page.getByRole('region', { name: 'Infrastructure' })).toBeVisible();
    await expect(notes(page)).toHaveCount(0);
  });

  test('axe finds nothing, dark and light', async ({ page }) => {
    for (const theme of ['dark', 'light']) {
      await openApp(page, '/infrastructure', { answers, theme });
      await expect(notes(page)).toHaveCount(3);
      expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
    }
  });
});

test.describe('phone', () => {
  test.use({ viewport: WIDTHS.phone });

  test('the Infra tab draws it', async ({ page }) => {
    await openApp(page, '/infrastructure', { answers });
    await expect(page.locator('[data-slot="phone-view"]')).toBeVisible();
    await expect(noteOf(page, 'crit')).toContainText('2 days left');
    await expect(noteOf(page, 'warn')).toContainText('9 days left');
    await expect(noteOf(page, 'unknown')).toContainText('No signal');
    expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
  });

  test('the Overview asks for no forecast', async ({ page }) => {
    const asked = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/disk-forecast') asked.push(r.url());
    });
    await openApp(page, '/', { answers });
    await expect(page.locator('[data-slot="phone-view"]')).toBeVisible();
    await page.waitForTimeout(500);
    expect(asked).toHaveLength(0);
  });
});

test('the demo’s own answer is the live route’s shape', () => {
  const { status, body } = demo('/api/disk-forecast');
  expect(status).toBe(200);
  expect(body.ok).toBe(true);
  expect(Object.keys(body.nodes).sort()).toEqual(['apps', 'edge', 'storage']);
});
