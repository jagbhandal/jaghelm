/*
 * The pending host steps in a real browser (#673): "Pending host steps" with
 * the count and a link out to each step on the desktop Overview and the
 * phone's, nothing with none open or no Gitea set up, one quiet link to #848
 * when the list can't be read, and a section Edit layout and Settings hide.
 * The server's answer is given in each test (`answers`); the demo's own is
 * "no Gitea", which draws nothing.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { axeFindings, demo, openApp, WIDTHS } from './app.mjs';

const HREF = 'https://git.example/jagdeep.bhandal/homelab-infra/issues/848';
const item = (n, title) => ({
  ref: `#${n}`,
  title,
  href: `https://git.example/jagdeep.bhandal/homelab-infra/issues/${n}`,
});
const STEPS = {
  configured: true,
  ok: true,
  count: 2,
  items: [item(879, 'one-time recreate of every Arcane container'), item(218, 'APK build moves')],
  more: 0,
  href: HREF,
};
const answers = { '/api/host-actions': STEPS };
const section = (page) => page.locator('[data-slot="host-actions"]');

test.describe('desktop', () => {
  test.use({ viewport: WIDTHS.desktop });

  test('the count and a link out to each step', async ({ page }) => {
    await openApp(page, '/', { answers });
    const s = section(page);
    await expect(s.getByRole('heading', { name: 'Pending host steps' })).toBeVisible();
    await expect(s).toContainText('2');
    const link = s.getByRole('link', { name: /#879/ });
    await expect(link).toHaveAttribute(
      'href',
      'https://git.example/jagdeep.bhandal/homelab-infra/issues/879'
    );
    await expect(link).toHaveAttribute('target', '_blank');
    expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
  });

  test('nothing with no step open, no Gitea set up (the demo), or before it answers', async ({
    page,
  }) => {
    await openApp(page, '/', {
      answers: { '/api/host-actions': { ...STEPS, count: 0, items: [] } },
    });
    await expect(page.getByRole('region', { name: 'Services' })).toBeVisible();
    await expect(section(page)).toHaveCount(0);
    await openApp(page, '/');
    await expect(page.getByRole('region', { name: 'Services' })).toBeVisible();
    await expect(section(page)).toHaveCount(0);
  });

  test('a list that can’t be read is one link to #848, not a count or an error', async ({
    page,
  }) => {
    await openApp(page, '/', {
      answers: { '/api/host-actions': { configured: true, ok: false, href: HREF } },
    });
    await expect(page.getByText(/couldn.t read the list/)).toBeVisible();
    await expect(section(page).getByRole('link', { name: /See #848/ })).toHaveAttribute(
      'href',
      HREF
    );
  });

  test('Settings → Appearance → Overview sections switches it off, and the Overview stops asking', async ({
    page,
  }) => {
    const asked = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/host-actions') asked.push(r.url());
    });
    await openApp(page, '/', { answers, config: { overviewSections: { hostActions: false } } });
    await expect(page.getByRole('region', { name: 'Services' })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(section(page)).toHaveCount(0);
    expect(asked).toHaveLength(0);
  });

  test('Edit layout lists it as a section that can move and hide', async ({ page }) => {
    await openApp(page, '/', { answers });
    await page.getByRole('banner').getByRole('button', { name: 'Edit layout' }).click();
    await expect(page.getByRole('button', { name: 'Move Pending host steps up' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Move Pending host steps down' })).toBeDisabled();
    await page.getByRole('switch', { name: 'Show Pending host steps' }).click();
    await expect(section(page)).toHaveCount(0);
  });
});

test.describe('phone', () => {
  test.use({ viewport: WIDTHS.phone });

  test('the Overview draws it above the lists, three rows at most', async ({ page }) => {
    await openApp(page, '/', {
      answers: {
        '/api/host-actions': {
          ...STEPS,
          count: 6,
          items: [1, 2, 3, 4, 5].map((n) => item(n, `step ${n}`)),
          more: 1,
        },
      },
    });
    await expect(page.locator('[data-slot="phone-view"]')).toBeVisible();
    const s = section(page);
    await expect(s.getByRole('heading', { name: 'Pending host steps' })).toBeVisible();
    await expect(s.getByRole('link', { name: /step 3/ })).toBeVisible();
    await expect(s.getByRole('link', { name: /step 4/ })).toHaveCount(0);
    await expect(s.getByRole('link', { name: /\+ 3 more in #848/ })).toHaveAttribute('href', HREF);
    expect(await axeFindings(new AxeBuilder({ page }))).toEqual([]);
  });

  test('other tabs ask for nothing', async ({ page }) => {
    const asked = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/host-actions') asked.push(r.url());
    });
    await openApp(page, '/infrastructure', { answers });
    await expect(page.locator('[data-slot="phone-view"]')).toBeVisible();
    await page.waitForTimeout(500);
    expect(asked).toHaveLength(0);
  });
});

test('the demo’s own answer is "no Gitea"', () => {
  const { status, body } = demo('/api/host-actions');
  expect(status).toBe(200);
  expect(body).toEqual({ configured: false });
});
