/*
 * The expiry tracker in a real browser (#676): TLS certificates and Tailscale
 * node keys on the desktop Overview and the phone's, soonest first, amber and
 * red against Settings' lines, always with an icon and words; an unreachable
 * or unreadable item is never green; nothing at all when nothing is set up
 * (the demo's own answer); Settings adds and removes targets visibly and its
 * lines move the colours. The server's answer is given in each test
 * (`answers`).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { axeFindings, demo, openApp, WIDTHS } from './app.mjs';

const item = (name, state, daysLeft, extra = {}) => ({
  id: `tls:${name}`,
  source: 'tls',
  name,
  detail: 'Issued by Example CA',
  state,
  daysLeft,
  expires: daysLeft === null ? null : '2027-02-01T00:00:00.000Z',
  ...extra,
});
const ANSWER = {
  configured: true,
  items: [
    item('old.example.com', 'expired', -3),
    item('soon.example.com', 'ok', 5),
    item('phone', 'ok', 18, { id: 'ts:p', source: 'tailscale', detail: 'Tailscale node key' }),
    item('down.example.com:8443', 'unreachable', null),
    item('fine.example.com', 'ok', 200),
  ],
  noExpiry: { count: 2, names: ['srv1', 'srv2'] },
  tailscale: { configured: true, state: 'ok' },
  suggestions: ['git.example.com'],
};
const answers = { '/api/expiry': ANSWER };
const section = (page) => page.locator('[data-slot="expiry"]');
const rowOf = (page, name) => section(page).locator('[data-slot="expiry-row"]', { hasText: name });

test.describe('desktop', () => {
  test.use({ viewport: WIDTHS.desktop });

  test('soonest first, each with an icon and words: expired and 5 days red, 18 amber, unreachable not green, 200 fine', async ({
    page,
  }) => {
    await openApp(page, '/', { answers });
    const s = section(page);
    await expect(s.getByRole('heading', { name: 'Expiry' })).toBeVisible();
    await expect(s).toContainText('5 tracked');
    const states = await s.locator('[data-slot="expiry-row"]').evaluateAll((rows) =>
      rows.map((r) => [r.textContent.slice(0, 22), r.getAttribute('data-state')])
    );
    expect(states.map(([, st]) => st)).toEqual(['crit', 'crit', 'warn', 'unknown', 'ok']);
    await expect(rowOf(page, 'old.example.com')).toContainText('Expired 3 days ago, critical');
    await expect(rowOf(page, 'soon.example.com')).toContainText('5 days left, critical');
    await expect(rowOf(page, 'phone')).toContainText('18 days left, warning');
    await expect(rowOf(page, 'down.example.com:8443')).toContainText('Unreachable');
    await expect(rowOf(page, 'fine.example.com')).toContainText('200 days left');
    for (const row of await s.locator('[data-slot="expiry-row"]').all()) {
      await expect(row.locator('svg')).toHaveCount(1);
    }
    await expect(s.getByText(/2 Tailscale devices have key expiry off/)).toBeVisible();
    expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
  });

  test('Settings’ lines move the colour', async ({ page }) => {
    await openApp(page, '/', { answers, config: { expiryWarnDays: 300, expiryCritDays: 100 } });
    await expect(rowOf(page, 'fine.example.com')).toHaveAttribute('data-state', 'warn');
    await expect(rowOf(page, 'phone')).toHaveAttribute('data-state', 'crit');
  });

  test('a rejected Tailscale key is said, not shown as a list', async ({ page }) => {
    await openApp(page, '/', {
      answers: {
        '/api/expiry': {
          ...ANSWER,
          items: [],
          noExpiry: null,
          tailscale: { configured: true, state: 'rejected' },
        },
      },
    });
    await expect(section(page).locator('[data-slot="expiry-notice"]')).toContainText(
      'Tailscale key rejected'
    );
    await expect(section(page).locator('[data-slot="expiry-row"]')).toHaveCount(0);
  });

  test('nothing when nothing is set up (the demo’s own answer), and nothing before it answers', async ({
    page,
  }) => {
    await openApp(page, '/');
    await expect(page.getByRole('region', { name: 'Services' })).toBeVisible();
    await expect(section(page)).toHaveCount(0);
    await openApp(page, '/', { answers: { '/api/expiry': { ...ANSWER, configured: false } } });
    await expect(page.getByRole('region', { name: 'Services' })).toBeVisible();
    await expect(section(page)).toHaveCount(0);
  });

  test('the Overview sections switch in Settings turns it off, and the Overview stops asking', async ({
    page,
  }) => {
    const asked = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/expiry') asked.push(r.url());
    });
    await openApp(page, '/', { answers, config: { overviewSections: { expiry: false } } });
    await expect(page.getByRole('region', { name: 'Services' })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(section(page)).toHaveCount(0);
    expect(asked).toHaveLength(0);
  });

  test('Edit layout lists it as a section that can move and hide', async ({ page }) => {
    await openApp(page, '/', { answers });
    await page.getByRole('banner').getByRole('button', { name: 'Edit layout' }).click();
    await expect(page.getByRole('button', { name: 'Move Expiry up' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Move Expiry down' })).toBeDisabled();
    await page.getByRole('switch', { name: 'Show Expiry' }).click();
    await expect(section(page)).toHaveCount(0);
  });

  test('Settings → Nodes & Services → Expiry: add a host and a suggestion, remove one, and the lines change the preview', async ({
    page,
  }) => {
    await openApp(page, '/settings/nodes', { answers: { '/api/expiry': { ...ANSWER, items: [] } } });
    const group = page.getByRole('region', { name: 'Expiry' });
    await expect(group.getByText(/Nothing tracked yet/)).toBeVisible();
    await group.getByLabel('Add a host').fill('NAS.example.com');
    await group.getByRole('button', { name: 'Track', exact: true }).click();
    const list = group.getByRole('list', { name: 'Tracked TLS targets' });
    await expect(list.getByText('nas.example.com')).toBeVisible();
    await group.getByRole('button', { name: 'Track git.example.com' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await group.getByRole('button', { name: 'Stop tracking nas.example.com' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await group.getByLabel('Add a host').fill('https://bad');
    await group.getByRole('button', { name: 'Track', exact: true }).click();
    await expect(group.getByRole('alert')).toContainText('No https://');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    const preview = group.locator('[data-slot="expiry-preview"]');
    await expect(preview).toContainText('26 days left');
    await group.getByLabel('Amber under (days left)').fill('40');
    await expect(preview).toContainText('45 days left');
    // The Expiry group alone: the Nodes and Services above it are not this card's.
    expect(await axeFindings(new AxeBuilder({ page }).include('#expiry'))).toEqual([]);
  });
});

test.describe('phone', () => {
  test.use({ viewport: WIDTHS.phone });

  test('the Overview draws it above the lists, four rows then a button for the rest', async ({
    page,
  }) => {
    await openApp(page, '/', { answers });
    await expect(page.locator('[data-slot="phone-view"]')).toBeVisible();
    const s = section(page);
    await expect(s.getByRole('heading', { name: 'Expiry' })).toBeVisible();
    await expect(s.locator('[data-slot="expiry-row"]')).toHaveCount(4);
    await expect(rowOf(page, 'down.example.com:8443')).toContainText('Unreachable');
    await s.getByRole('button', { name: 'Show 1 more' }).click();
    await expect(s.locator('[data-slot="expiry-row"]')).toHaveCount(5);
    expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('other tabs ask for nothing', async ({ page }) => {
    const asked = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/expiry') asked.push(r.url());
    });
    await openApp(page, '/infrastructure', { answers });
    await expect(page.locator('[data-slot="phone-view"]')).toBeVisible();
    await page.waitForTimeout(500);
    expect(asked).toHaveLength(0);
  });
});

test('the demo’s own answer is "nothing set up"', () => {
  const { status, body } = demo('/api/expiry');
  expect(status).toBe(200);
  expect(body.configured).toBe(false);
});
