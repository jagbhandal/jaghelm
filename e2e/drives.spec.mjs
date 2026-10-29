/*
 * Drive health in a real browser (#728), on the demo's storage node (an NVMe
 * and three SATA drives, all healthy):
 *
 *  - The Drives block sits under the status box and before the History, in the
 *    desktop's drawer (1440px) and the phone's sheet (390px): one row a drive,
 *    its standby footnote (a SATA drive may sleep), a row opens with the
 *    keyboard, no sideways scroll, axe finds nothing, dark and light.
 *  - Its temperature chart draws a line a drive, named in the legend.
 *  - A failing drive: the model's reason in the status box and the row's word.
 *  - A drive alert opens its node's detail with that drive open and marked.
 *  - Settings shows the drives module's switch (read-only) only where drives
 *    are read.
 *  - The optional-module rule: a node with no drive data (the edge node, or the
 *    storage node when the server read none) has no block, no footnote and asks
 *    for the series it always did.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { THEMES, WIDTHS, axeFindings, demo, openApp } from './app.mjs';

const drawer = (page) => page.locator('[data-slot="drawer"]');
const sheet = (page) => page.getByRole('dialog', { name: 'Storage' });
const drives = (scope) => scope.getByRole('region', { name: 'Drives' });
const rows = (scope) => drives(scope).locator('[data-slot="drive-row"]');

const noSidewaysScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** The demo's status with the storage node's drive `sdb` failing, as the model words it. */
function failing() {
  const body = structuredClone(demo('/api/status', { scenario: 'incident' }).body);
  const entity = body.entities.find((e) => e.id === 'nodes/storage');
  const sdb = entity.drives.find((d) => d.device === 'sdb');
  Object.assign(sdb, {
    state: 'crit',
    word: 'Critical',
    reason: 'drive sdb failed its health check',
    smartPassed: false,
  });
  entity.conditions['drive:storage:sdb'] = 'crit';
  Object.assign(entity, {
    state: 'crit',
    word: 'Critical',
    reason: 'drive sdb failed its health check',
  });
  return body;
}

/** The demo's status with the storage node's declared interval `seconds` (null: none declared). */
function declared(seconds, { nvmeOnly = false } = {}) {
  return () => {
    const body = structuredClone(demo('/api/status', { scenario: 'incident' }).body);
    const entity = body.entities.find((e) => e.id === 'nodes/storage');
    if (seconds === null) delete entity.driveReadingSeconds;
    else entity.driveReadingSeconds = seconds;
    if (nvmeOnly) entity.drives = entity.drives.filter((d) => d.type === 'nvme');
    return body;
  };
}

/** The demo's status with the storage node's drives gone (the server read none). */
function withoutDrives() {
  const body = structuredClone(demo('/api/status', { scenario: 'incident' }).body);
  const entity = body.entities.find((e) => e.id === 'nodes/storage');
  delete entity.drives;
  for (const key of Object.keys(entity.conditions))
    if (key.startsWith('drive:')) delete entity.conditions[key];
  return body;
}

for (const [width, size] of [
  ['desktop', WIDTHS.desktop],
  ['phone', WIDTHS.phone],
]) {
  test.describe(`${width} (${size.width}px)`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(size);
    });
    const scope = (page) => (width === 'desktop' ? drawer(page) : sheet(page));

    test('the Drives block: four rows under the status box, before the History, with its footnote', async ({
      page,
    }) => {
      await openApp(page, '/?entity=nodes/storage');
      const panel = scope(page);
      await expect(drives(panel)).toBeVisible();
      await expect(rows(panel)).toHaveCount(4);
      expect(await rows(panel).evaluateAll((els) => els.map((e) => e.dataset.drive))).toEqual([
        'nvme0',
        'sda',
        'sdb',
        'sdc',
      ]);
      // The demo's storage node declares an hourly interval (#732): one line, both facts.
      await expect(panel.locator('[data-slot="detail-drives-cadence"]')).toHaveText(
        'Readings refresh about every hour, on their own schedule, not with this page. A sleeping drive shows its last reading.'
      );
      await expect(panel.locator('[data-slot="detail-drives-standby"]')).toHaveCount(0);
      // Under the status box, before the History.
      const top = (locator) => locator.evaluate((e) => e.getBoundingClientRect().top);
      const history = panel.getByRole('region', { name: 'History' });
      await expect(history).toBeVisible();
      expect(await top(drives(panel))).toBeLessThan(await top(history));
      // No serial number anywhere in the block (the server never reads one).
      await expect(drives(panel)).not.toContainText(/serial|S\/N/i);
      expect(await noSidewaysScroll(page)).toBe(true);
    });

    test('no interval declared: the footnote is today\'s', async ({ page }) => {
      await openApp(page, '/?entity=nodes/storage', { answers: { '/api/status': declared(null) } });
      await expect(drives(scope(page))).toBeVisible();
      await expect(scope(page).locator('[data-slot="detail-drives-standby"]')).toHaveText(
        'Sleeping drives show their last reading'
      );
      await expect(scope(page).locator('[data-slot="detail-drives-cadence"]')).toHaveCount(0);
    });

    test('NVMe only with an interval: the cadence, and no sleeping sentence', async ({ page }) => {
      await openApp(page, '/?entity=nodes/storage', {
        answers: { '/api/status': declared(600, { nvmeOnly: true }) },
      });
      await expect(drives(scope(page))).toBeVisible();
      await expect(scope(page).locator('[data-slot="detail-drives-cadence"]')).toHaveText(
        'Readings refresh about every 10 minutes, on their own schedule, not with this page.'
      );
      await expect(scope(page).getByText(/sleeping/i)).toHaveCount(0);
    });

    test('a row opens and closes with the keyboard', async ({ page }) => {
      await openApp(page, '/?entity=nodes/storage');
      const button = scope(page).locator('[data-drive="sda"] button');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await button.focus();
      await page.keyboard.press('Enter');
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(
        scope(page).locator('[data-drive="sda"] [data-slot="drive-details"]')
      ).toContainText('Power-on');
      await page.keyboard.press('Space');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(await noSidewaysScroll(page)).toBe(true);
    });

    for (const theme of Object.values(THEMES)) {
      test(`axe finds nothing, ${theme}, a row open`, async ({ page }) => {
        await openApp(page, '/?entity=nodes/storage', { theme });
        const panel = scope(page);
        await expect(rows(panel)).toHaveCount(4);
        await panel.locator('[data-drive="nvme0"] button').click();
        await expect(
          panel.locator('[data-drive="nvme0"] [data-slot="drive-details"]')
        ).toBeVisible();
        expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
        expect(await noSidewaysScroll(page)).toBe(true);
      });

      test(`a failing drive, ${theme}: the model's reason, the row's word, axe`, async ({
        page,
      }) => {
        await openApp(page, '/?entity=nodes/storage', {
          theme,
          answers: { '/api/status': failing },
        });
        const panel = scope(page);
        await expect(panel.getByText('drive sdb failed its health check').first()).toBeVisible();
        const sdb = panel.locator('[data-drive="sdb"]');
        await expect(sdb.locator('[data-slot="drive-word"]')).toHaveText('Critical');
        await expect(sdb).toHaveAttribute('data-state', 'crit');
        expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
        expect(await noSidewaysScroll(page)).toBe(true);
      });
    }

    test('the temperature chart draws a line a drive, named in the legend', async ({ page }) => {
      const asked = [];
      page.on('request', (r) => {
        const u = new URL(r.url());
        if (u.pathname === '/api/history' && u.searchParams.get('entity'))
          asked.push(u.searchParams.get('series'));
      });
      await openApp(page, '/?entity=nodes/storage');
      const panel = scope(page);
      const chart = panel.getByRole('img', { name: /^Temperature/ });
      await expect(chart).toBeVisible();
      const legend = panel.locator('[data-chart="temperature"] [data-slot="chart-label"]');
      await expect(legend).toContainText(['Temperature', 'nvme0', 'sda', 'sdb', 'sdc'], {
        useInnerText: true,
      });
      expect(asked.join(',')).toContain('drive.temperature');
    });
  });
}

test.describe('a drive alert (1440px)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(WIDTHS.desktop);
  });

  test("opens the node's detail with that drive open and marked", async ({ page }) => {
    const events = demo('/api/events', { query: { limit: '50' } }).body;
    const alert = {
      id: '900',
      at: new Date().toISOString(),
      type: 'host_threshold',
      severity: 'critical',
      entity: 'nodes/storage',
      title: 'Drive failing',
      body: 'Storage: drive sdb failed its health check',
      reason: 'drive sdb failed its health check',
      node: 'storage',
      key: 'storage:drive:storage:sdb',
      push: { state: 'sent', phones: 1, suppressed: 0 },
    };
    await openApp(page, '/alerts', {
      answers: {
        '/api/events': { ...events, events: [alert, ...events.events] },
      },
    });
    await page.getByText('drive sdb failed its health check').first().click();
    await expect(page).toHaveURL(/entity=nodes(%2F|\/)storage/);
    await expect(page).toHaveURL(/drive=sdb/);
    const sdb = drawer(page).locator('[data-drive="sdb"]');
    await expect(sdb).toHaveAttribute('data-highlighted', '');
    await expect(sdb.locator('button')).toHaveAttribute('aria-expanded', 'true');
    await expect(sdb.locator('[data-slot="drive-details"]')).toBeVisible();
  });

  test('a link names the drive: /?entity=nodes/storage&drive=sda', async ({ page }) => {
    await openApp(page, '/?entity=nodes/storage&drive=sda');
    const sda = drawer(page).locator('[data-drive="sda"]');
    await expect(sda).toHaveAttribute('data-highlighted', '');
    await expect(sda.locator('button')).toHaveAttribute('aria-expanded', 'true');
    expect(await noSidewaysScroll(page)).toBe(true);
  });
});

test.describe('Settings (1440px)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(WIDTHS.desktop);
  });

  test("shows the drives module's switch, read-only, where drives are read", async ({ page }) => {
    await openApp(page, '/settings/notifications');
    const sw = page.getByRole('switch', { name: 'Drive health' });
    await expect(sw).toBeVisible();
    await expect(sw).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(/JAGHELM_DRIVES/).first()).toBeVisible();
  });

  test('shows nothing of it where drives are not read', async ({ page }) => {
    await openApp(page, '/settings/notifications', {
      answers: {
        '/api/thresholds': () => ({ ...demo('/api/thresholds').body, drives: 'none' }),
      },
    });
    await expect(page.getByRole('heading', { name: /alert/i }).first()).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Drive health' })).toHaveCount(0);
    await expect(page.getByText(/JAGHELM_DRIVES/)).toHaveCount(0);
  });
});

test.describe('no drive data: today, unchanged', () => {
  test('the edge node: no block, no footnote, the series it always asked for (1440px)', async ({
    page,
  }) => {
    await page.setViewportSize(WIDTHS.desktop);
    const asked = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname === '/api/history' && u.searchParams.get('entity'))
        asked.push(u.searchParams.get('series'));
    });
    await openApp(page, '/?entity=nodes/edge');
    await expect(drawer(page).getByRole('region', { name: 'History' })).toBeVisible();
    await expect(drives(drawer(page))).toHaveCount(0);
    await expect(drawer(page).locator('[data-slot="detail-drives-standby"]')).toHaveCount(0);
    expect(asked.join(',')).not.toContain('drive');
  });

  test('the storage node when the server read no drives (390px)', async ({ page }) => {
    await page.setViewportSize(WIDTHS.phone);
    const asked = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname === '/api/history' && u.searchParams.get('entity'))
        asked.push(u.searchParams.get('series'));
    });
    await openApp(page, '/?entity=nodes/storage', { answers: { '/api/status': withoutDrives } });
    await expect(sheet(page).getByRole('region', { name: 'History' })).toBeVisible();
    await expect(drives(sheet(page))).toHaveCount(0);
    await expect(sheet(page).locator('[data-slot="detail-drives-standby"]')).toHaveCount(0);
    expect(asked.join(',')).not.toContain('drive');
    expect(await noSidewaysScroll(page)).toBe(true);
  });
});
