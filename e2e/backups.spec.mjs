/*
 * The Backups section in a real browser (#675): a row per backup job with its
 * last good run and a lamp, B2's size with the hidden-version warning, nothing
 * with no job marked and no B2 key (the demo), the saved freshness lines
 * recolouring a row, and a section Edit layout and Settings hide. The server's
 * answer is given in each test; the demo's own is "no backups".
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { axeFindings, demo, openApp, WIDTHS } from './app.mjs';

const H = 3_600_000;
const GB = 1e9;
const ago = (h) => Date.now() - h * H;
const job = (over = {}) => ({
  key: 'pve:proxmox-backup',
  node: 'pve',
  job: 'proxmox-backup',
  seen: true,
  hostDown: false,
  last: { at: ago(7), status: 'success' },
  lastGood: ago(7),
  failedRuns: 0,
  runs: 3,
  ...over,
});
const b2 = (over = {}) => ({
  configured: true,
  bucket: 'jagnet-homelab-backup',
  pending: false,
  error: null,
  checkedAt: ago(3),
  liveBytes: 210 * GB,
  hiddenBytes: 40 * GB,
  hiddenVersions: 9,
  files: 100,
  weekChangeBytes: 4.2 * GB,
  history: [
    [ago(8 * 24), 205 * GB],
    [ago(3), 210 * GB],
  ],
  prefixes: [{ name: 'FamilyVault', bytes: 5 * GB, files: 2, lastUpload: ago(5) }],
  ...over,
});
const body = () => ({
  jobs: [
    job(),
    job({
      key: 'nas:nas-b2-backup',
      node: 'nas',
      job: 'nas-b2-backup',
      last: { at: ago(2), status: 'failure', error: 'FamilyVault: sentinel missing' },
      lastGood: ago(26),
    }),
    job({ key: 'docker-brain:vm103-backup', node: 'docker-brain', job: 'vm103-backup', seen: false, last: null, lastGood: null, runs: 0 }),
  ],
  b2: b2(),
});
const section = (page) => page.locator('[data-slot="backups"]');
const row = (page, name) => section(page).locator('[data-entity]').filter({ hasText: name });

test.describe('desktop', () => {
  test.use({ viewport: WIDTHS.desktop });

  test('a row per job, a failure with its words, never-seen as unknown, and the bucket', async ({
    page,
  }) => {
    await openApp(page, '/', { answers: { '/api/backups': body() } });
    const s = section(page);
    await expect(s.getByRole('heading', { name: 'Backups' })).toBeVisible();
    await expect(row(page, 'proxmox-backup')).toContainText('Last good run 7 h ago');
    await expect(row(page, 'proxmox-backup').getByRole('img', { name: 'OK' })).toBeVisible();
    await expect(row(page, 'nas-b2-backup')).toContainText('Failed 2 h ago: FamilyVault: sentinel missing');
    await expect(row(page, 'nas-b2-backup').getByRole('img', { name: 'Failed' })).toBeVisible();
    await expect(row(page, 'vm103-backup').getByRole('img', { name: 'No signal' })).toBeVisible();
    await expect(row(page, 'vm103-backup')).toContainText('Nothing has reported yet');
    await expect(row(page, 'B2 bucket')).toContainText('210 GB · +4.2 GB in 7 d');
    await expect(s.getByText('40 GB hidden versions')).toBeVisible();
    await s.getByText('Last data uploaded, by folder').click();
    await expect(s.getByText('FamilyVault', { exact: true })).toBeVisible();
    expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
  });

  test('a rejected key is said in words, with no number made up', async ({ page }) => {
    await openApp(page, '/', {
      answers: {
        '/api/backups': { jobs: [], b2: { configured: true, bucket: 'b', pending: false, error: 'key-rejected', checkedAt: null } },
      },
    });
    await expect(row(page, 'B2 bucket')).toContainText('B2 key rejected');
  });

  test('the saved freshness lines change a row’s colour', async ({ page }) => {
    const answers = { '/api/backups': { jobs: [job()], b2: { configured: false } } };
    await openApp(page, '/', { answers });
    await expect(row(page, 'proxmox-backup').getByRole('img', { name: 'OK' })).toBeVisible();
    await openApp(page, '/', { answers, config: { backupAgeHours: { warn: 2, crit: 5 } } });
    await expect(row(page, 'proxmox-backup').getByRole('img', { name: 'Stale' })).toBeVisible();
  });

  test('nothing with no job marked and no B2 key (the demo), or before it answers', async ({ page }) => {
    await openApp(page, '/');
    await expect(page.getByRole('region', { name: 'Services' })).toBeVisible();
    await expect(section(page)).toHaveCount(0);
  });

  test('Settings → Appearance → Overview sections switches it off, and the Overview stops asking', async ({
    page,
  }) => {
    const asked = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/backups') asked.push(r.url());
    });
    await openApp(page, '/', {
      answers: { '/api/backups': body() },
      config: { overviewSections: { backupFreshness: false } },
    });
    await expect(page.getByRole('region', { name: 'Services' })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(section(page)).toHaveCount(0);
    expect(asked).toHaveLength(0);
  });

  test('Edit layout lists it as a section that can move and hide', async ({ page }) => {
    await openApp(page, '/', { answers: { '/api/backups': body() } });
    await page.getByRole('banner').getByRole('button', { name: 'Edit layout' }).click();
    await expect(page.getByRole('button', { name: 'Move Backup freshness up' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Move Backup freshness down' })).toBeDisabled();
    await page.getByRole('switch', { name: 'Show Backup freshness' }).click();
    await expect(section(page)).toHaveCount(0);
  });
});

test.describe('phone', () => {
  test.use({ viewport: WIDTHS.phone });

  test('the Overview draws it with its rows and the bucket', async ({ page }) => {
    await openApp(page, '/', { answers: { '/api/backups': body() } });
    await expect(page.locator('[data-slot="phone-view"]')).toBeVisible();
    const s = section(page);
    await expect(s.getByRole('heading', { name: 'Backups' })).toBeVisible();
    await expect(row(page, 'nas-b2-backup')).toContainText('Failed 2 h ago');
    await expect(row(page, 'B2 bucket')).toContainText('210 GB');
    expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
  });

  test('other tabs ask for nothing', async ({ page }) => {
    const asked = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/backups') asked.push(r.url());
    });
    await openApp(page, '/infrastructure', { answers: { '/api/backups': body() } });
    await expect(page.locator('[data-slot="phone-view"]')).toBeVisible();
    await page.waitForTimeout(500);
    expect(asked).toHaveLength(0);
  });
});

test('the demo’s own answer is "no backups"', () => {
  const { status, body: b } = demo('/api/backups');
  expect(status).toBe(200);
  expect(b).toEqual({ jobs: [], b2: { configured: false } });
});
