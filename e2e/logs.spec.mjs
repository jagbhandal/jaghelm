/*
 * "Recent errors" in a real browser (#672), on a made-up /api/logs (the demo
 * has no Loki):
 *
 *  - Nothing is read until a detail opens; a node's drawer then reads its
 *    entity once and lists the lines, newest first, as text (a line holding
 *    markup is not markup).
 *  - Loki unavailable: "Logs unavailable: <why>" in place of the lines, no
 *    alert, no toast. No errors in the window: its own words.
 *  - The phone's sheet draws the same.
 *  - axe finds nothing with the lines drawn.
 */
import { test, expect } from '@playwright/test';
import { WIDTHS, axeFindings, openApp, reply } from './app.mjs';
import AxeBuilder from '@axe-core/playwright';

const NOW = Date.now();
const OK = {
  state: 'ok',
  lines: [
    { at: NOW - 60_000, text: 'ERROR db connection lost <img src=x onerror=alert(1)>' },
    { at: NOW - 3_600_000, text: 'warn slow query token=[redacted]' },
  ],
};

function logs(answer) {
  const asked = [];
  return {
    asked,
    answers: {
      '/api/logs': (request) => {
        asked.push(new URL(request.url()).searchParams.get('entity'));
        return typeof answer === 'function' ? answer() : answer;
      },
    },
  };
}

test.describe('the desktop drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(WIDTHS.desktop);
  });

  test('reads nothing until a detail opens, then lists the lines as text', async ({ page }) => {
    const { asked, answers } = logs(OK);
    await openApp(page, '/', { answers });
    await page.waitForTimeout(500);
    expect(asked).toEqual([]);

    await page.goto('/?entity=nodes/edge');
    const section = page.locator('[data-slot="drawer"] [data-slot="detail-logs"]');
    await expect(section.getByRole('heading', { name: 'Recent errors' })).toBeVisible();
    await expect(section.getByText('ERROR db connection lost')).toBeVisible();
    await expect(section.locator('img')).toHaveCount(0);
    await expect(section.locator('li')).toHaveCount(2);
    expect(asked).toEqual(['edge']);
    expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
  });

  test('a container reads <node>/<container>', async ({ page }) => {
    const { asked, answers } = logs(OK);
    await openApp(page, '/?entity=services/apps:jellyfin', { answers });
    await expect(page.locator('[data-slot="drawer"] [data-slot="detail-logs"] li').first()).toBeVisible();
    expect(asked).toEqual(['apps/jellyfin']);
  });

  test('Loki unavailable is a sentence in place, never an alert', async ({ page }) => {
    const { answers } = logs({ state: 'unavailable', lines: [], reason: 'Loki refused the connection' });
    await openApp(page, '/?entity=nodes/edge', { answers });
    const section = page.locator('[data-slot="drawer"] [data-slot="detail-logs"]');
    await expect(section).toContainText('Logs unavailable: Loki refused the connection.');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('a server that fails the read says unavailable too', async ({ page }) => {
    await openApp(page, '/?entity=nodes/edge', {
      answers: { '/api/logs': () => reply(500, { error: 'boom' }) },
    });
    await expect(page.locator('[data-slot="detail-logs"]')).toContainText('Logs unavailable');
  });

  test('nothing in the window', async ({ page }) => {
    const { answers } = logs({ state: 'none', lines: [] });
    await openApp(page, '/?entity=nodes/edge', { answers });
    await expect(page.locator('[data-slot="detail-logs"]')).toContainText(
      'No errors in the last 6 h.'
    );
  });

  test('a host that sent no logs is not an all-clear', async ({ page }) => {
    const { answers } = logs({ state: 'silent', lines: [], reason: 'edge' });
    await openApp(page, '/?entity=nodes/edge', { answers });
    const section = page.locator('[data-slot="detail-logs"]');
    await expect(section).toContainText('No logs received from edge in the last 6 h: check the Loki host label.');
    await expect(section).not.toContainText('No errors');
  });
});

test.describe("the phone's sheet", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(WIDTHS.phone);
  });

  test('a node sheet draws the same section', async ({ page }) => {
    const { asked, answers } = logs(OK);
    await openApp(page, '/?entity=nodes/edge', { answers });
    const section = page.getByRole('dialog', { name: 'Network Edge' }).locator('[data-slot="detail-logs"]');
    await expect(section.getByText('ERROR db connection lost')).toBeVisible();
    expect(asked).toEqual(['edge']);
    const box = await section.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(WIDTHS.phone.width);
  });
});
