/*
 * Remove on a missing container (#688), in a real browser, on the server's own
 * board for Jag's vm-103 with the three Wiki.js containers taken away on
 * purpose (server/testing/stackBoard.js `gone`) and /api/containers/forget
 * answered here, switching the board to the one without what was forgotten:
 *
 *  - a Missing container's drawer has Remove…; a running one's has none;
 *  - the confirm names what it does and that a monitor stays; Cancel sends
 *    nothing; Remove sends { node, container }, the drawer closes with a toast,
 *    the row leaves and the board is one warning lighter, focus lands on a row;
 *  - a refusal (it started again) says why and keeps the drawer;
 *  - the phone's sheet does the same;
 *  - axe finds nothing with the confirm open.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { WIDTHS, axeFindings, openApp, reply } from './app.mjs';
import { stackBoard } from '../server/testing/stackBoard.js';

const WIKI = ['wikijs', 'wikijs-postgres', 'wikijs-redis'];
const row = (name) => `[data-slot="entity-row"][data-entity="services/vm103:${name}"]`;

/** The board with `gone` still missing, and the server's answers over it. */
function server({ refuse = null } = {}) {
  const state = { gone: [...WIKI], forgotten: [], posted: [], board: null };
  const set = () => {
    state.board = stackBoard({ gone: state.gone, forgotten: state.forgotten });
  };
  set();
  return {
    state,
    answers: {
      // A server that takes writes: the demo's Remove is not drawn (read-only).
      '/api/auth/check': { authenticated: true, authRequired: false, demo: false },
      '/api/status': () => state.board.status,
      '/api/services': () => state.board.services,
      '/api/containers/forget': (request) => {
        const body = JSON.parse(request.postData());
        state.posted.push(body);
        if (refuse) return reply(refuse, { error: 'refused' });
        state.gone = state.gone.filter((n) => n !== body.container);
        state.forgotten.push(body.container);
        set();
        return { forgotten: body, refreshed: true };
      },
    },
  };
}

test.describe('the desktop drawer', () => {
  test.use({ viewport: WIDTHS.desktop });

  test('the read-only demo draws no Remove', async ({ page }) => {
    const { answers } = server();
    delete answers['/api/auth/check'];
    await openApp(page, '/services', { answers });
    await page.locator(row('wikijs-redis')).click();
    const drawer = page.locator('[data-slot="drawer"]');
    await expect(drawer.getByRole('heading', { name: 'Wikijs Redis', exact: true })).toBeVisible();
    await expect(drawer.getByRole('button', { name: /Remove/ })).toHaveCount(0);
  });

  test('a running container has no Remove', async ({ page }) => {
    const { answers } = server();
    await openApp(page, '/services', { answers });
    await page.locator(row('gitea')).click();
    const drawer = page.locator('[data-slot="drawer"]');
    await expect(drawer.getByRole('heading', { name: 'Gitea', exact: true })).toBeVisible();
    await expect(drawer.getByRole('button', { name: /Remove/ })).toHaveCount(0);
  });

  test('Remove… asks first; Cancel sends nothing', async ({ page }) => {
    const { state, answers } = server();
    await openApp(page, '/services', { answers });
    await page.locator(row('wikijs-redis')).click();
    const drawer = page.locator('[data-slot="drawer"]');
    await drawer.getByRole('button', { name: 'Remove…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Remove this missing container?' });
    await expect(dialog).toContainText('Forget Wikijs Redis on vm103. It comes back if the container returns.');
    expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(state.posted).toEqual([]);
    await expect(drawer).toBeVisible();
  });

  test('a mapping that stays is named in the confirm', async ({ page }) => {
    const { answers } = server();
    await openApp(page, '/services', { answers });
    await page.locator(row('wikijs')).click();
    await page.locator('[data-slot="drawer"]').getByRole('button', { name: 'Remove…' }).click();
    await expect(page.getByRole('alertdialog')).toContainText(
      'services.yaml still maps it to Kuma monitor "Wiki.js"; that stays until you edit it.'
    );
  });

  test('Remove forgets it: the drawer closes, the row and one warning go, focus lands on a row', async ({
    page,
  }) => {
    const { state, answers } = server();
    await openApp(page, '/services', { answers });
    await expect(page.locator(row('wikijs-redis'))).toBeVisible();
    await expect(page.getByText('3 containers missing').first()).toBeVisible();

    await page.locator(row('wikijs-redis')).click();
    const drawer = page.locator('[data-slot="drawer"]');
    await drawer.getByRole('button', { name: 'Remove…' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove', exact: true }).click();

    expect(state.posted).toEqual([{ node: 'vm103', container: 'wikijs-redis' }]);
    await expect(drawer).toBeHidden();
    await expect(page.getByText('Removed Wikijs Redis on vm103. It comes back if the container returns.')).toBeVisible();
    await expect(page.locator(row('wikijs-redis'))).toHaveCount(0);
    await expect(page.locator(row('wikijs-postgres'))).toBeVisible();
    await expect(page.getByText('2 containers missing').first()).toBeVisible();
    const focused = await page.evaluate(() => document.activeElement?.closest('[data-entity]')?.getAttribute('data-entity'));
    expect(focused).toBeTruthy();
    expect(focused).not.toBe('services/vm103:wikijs-redis');
  });

  test('the last one forgotten leaves the board with no missing warning', async ({ page }) => {
    const { state, answers } = server();
    state.gone = ['wikijs-redis'];
    state.forgotten = ['wikijs', 'wikijs-postgres'];
    state.board = stackBoard({ gone: state.gone, forgotten: state.forgotten });
    await openApp(page, '/services', { answers });
    await expect(page.getByText('1 container missing').first()).toBeVisible();
    await page.locator(row('wikijs-redis')).click();
    await page.locator('[data-slot="drawer"]').getByRole('button', { name: 'Remove…' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator(row('wikijs-redis'))).toHaveCount(0);
    await expect(page.getByText(/container(s)? missing/)).toHaveCount(0);
  });

  test('a refusal says why, keeps the drawer, and the row stays', async ({ page }) => {
    const { answers } = server({ refuse: 409 });
    await openApp(page, '/services', { answers });
    await page.locator(row('wikijs-redis')).click();
    const drawer = page.locator('[data-slot="drawer"]');
    await drawer.getByRole('button', { name: 'Remove…' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(drawer.locator('[data-slot="detail-remove-error"]')).toContainText(
      'It is running now, or its node is not reporting. Nothing was removed.'
    );
    await expect(drawer).toBeVisible();
    await expect(page.locator(row('wikijs-redis'))).toHaveCount(1);
  });
});

test.describe("the phone's sheet", () => {
  test.use({ viewport: WIDTHS.phone });

  test('Remove forgets it and the sheet closes', async ({ page }) => {
    const { state, answers } = server();
    await openApp(page, '/services?entity=services/vm103:wikijs-redis', { answers });
    const sheet = page.locator('[data-slot="phone-sheet"]');
    await sheet.getByRole('button', { name: 'Remove…' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove', exact: true }).click();
    expect(state.posted).toEqual([{ node: 'vm103', container: 'wikijs-redis' }]);
    await expect(sheet).toBeHidden();
    await expect(page.getByText('Wikijs Redis')).toHaveCount(1); // the toast alone
    await expect(page.getByText('2 containers missing').first()).toBeVisible();
  });
});
