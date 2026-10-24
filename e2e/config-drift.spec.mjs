/*
 * The config drift row in a real browser (#674): "Config drift" on the desktop
 * Overview and the phone's, green only for fresh all-ok reports, amber for drift
 * and for a silent row ("Unknown"), grey "No reports", the per-host list on
 * click, nothing when the server can't take reports (the demo), and a section
 * Settings hides. The server's answer is given in each test (`answers`).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { axeFindings, demo, openApp, WIDTHS } from './app.mjs';

const NOW = Date.now();
const ago = (h) => new Date(NOW - h * 3_600_000).toISOString();
const rep = (host, status, h, items = []) => ({
  host,
  status,
  items,
  checkedAt: ago(h),
  receivedAt: ago(h),
});
const answer = (...reports) => ({
  '/api/drift': { configured: true, now: new Date(NOW).toISOString(), reports },
});
const DRIFTED = answer(
  rep('pi-1', 'drift', 2, [
    { name: '/etc/keepalived/keepalived.conf', kind: 'DIFF', detail: '' },
    { name: '/opt/stacks/arcane-agent/compose.yaml', kind: 'MISSING', detail: '' },
  ]),
  rep('ms-s1', 'ok', 120)
);
const row = (page) => page.locator('[data-slot="config-drift"]');
const stateOf = (page) => row(page).locator('[data-slot="config-drift-state"]');

for (const [name, viewport] of [
  ['desktop', WIDTHS.desktop],
  ['phone', WIDTHS.phone],
]) {
  test.describe(name, () => {
    test.use({ viewport });

    test('amber on drift; a click lists each host with its items and report age', async ({ page }) => {
      await openApp(page, '/', { answers: DRIFTED });
      await expect(stateOf(page)).toHaveText('Drift');
      await expect(stateOf(page)).toHaveAttribute('data-state', 'drift');
      await row(page).getByRole('button').click();
      await expect(row(page).getByText('/etc/keepalived/keepalived.conf')).toBeVisible();
      await expect(row(page).getByText('Reported 2 h ago')).toBeVisible();
      await expect(row(page).getByText('Last reported 5 days ago')).toBeVisible();
      expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
    });

    test('green only when fresh and ok; a silent row is Unknown, never green; none is grey', async ({ page }) => {
      await openApp(page, '/', { answers: answer(rep('pi-1', 'ok', 1), rep('pi-2', 'ok', 3)) });
      await expect(stateOf(page)).toHaveAttribute('data-state', 'ok');
      await openApp(page, '/', { answers: answer(rep('pi-1', 'ok', 50)) });
      await expect(stateOf(page)).toHaveText('Unknown');
      await openApp(page, '/', { answers: answer() });
      await expect(stateOf(page)).toHaveText('No reports');
      await expect(stateOf(page)).toHaveAttribute('data-state', 'none');
    });

    test('the stale hours setting changes the verdict', async ({ page }) => {
      const answers = answer(rep('pi-1', 'ok', 30));
      await openApp(page, '/', { answers, config: { driftStaleHours: 24 } });
      await expect(stateOf(page)).toHaveText('Unknown');
      await openApp(page, '/', { answers, config: { driftStaleHours: 48 } });
      await expect(stateOf(page)).toHaveText('No drift');
    });

    test('nothing when the server cannot take reports, or the section is switched off', async ({ page }) => {
      await openApp(page, '/', { answers: { '/api/drift': { configured: false } } });
      await expect(page.getByRole('region', { name: 'Services' }).first()).toBeVisible();
      await page.waitForTimeout(500);
      await expect(row(page)).toHaveCount(0);
      await openApp(page, '/', { answers: DRIFTED, config: { overviewSections: { configDrift: false } } });
      await page.waitForTimeout(500);
      await expect(row(page)).toHaveCount(0);
    });
  });
}

test('the demo’s own answer is "not configured"', () => {
  const { status, body } = demo('/api/drift');
  expect(status).toBe(200);
  expect(body).toEqual({ configured: false });
});
