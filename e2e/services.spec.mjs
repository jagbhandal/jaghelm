/*
 * The Overview's Services section in a real browser (#300), on the demo's
 * boards (its incident has Jellyfin down), dark and light:
 *
 *  - every service's name in full, its column at least 120px wide, at 1024
 *    and 1440, grouped by node and by custom group (the node beside each
 *    name), the demo's longest name included; at 768, the narrowest window
 *    that draws it (a phone draws the phone screens, #303), the Phone
 *    board's list, nothing cut off, no sideways scroll;
 *  - healthy, no red, amber or green anywhere in the section but its small ok
 *    lamps: the rows are muted; the incident's red is Jellyfin's row alone
 *    (the heartbeat strips aside: they are Kuma's history, checked on their
 *    own);
 *  - the heartbeat strips (#312): one of 30 on every monitored row, the
 *    incident's failures where Kuma's checks failed, a check's tooltip under
 *    the pointer, and every row still one line at 1024 and 1440; the
 *    tooltip's part arrives with the floating layer on the first pointer
 *    over a strip, and no row or strip moves when it does;
 *  - the grouping, by node or by custom group, kept in this browser across a
 *    reload;
 *  - the subsystem strip's Services cell brings the section alone into view,
 *    and Jellyfin's issue row, and its row, open its detail drawer (#309);
 *  - axe finds nothing.
 *
 * Its no-signal probe (every row steel, dark and light) is in
 * no-signal.spec.mjs, beside the other places'. Screenshots for the PR, in
 * test-results/e2e/shots/.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { axeFindings, demo, openApp, statusHues } from './app.mjs';
import { GROUPING_PREF } from '../src/shell/servicesView.js';

const VIEWPORTS = {
  wide: { width: 1440, height: 900 },
  desktop: { width: 1024, height: 768 },
  tablet: { width: 768, height: 1024 },
};

const section = (page) => page.locator('[data-slot="services-section"]');
// The heartbeat strips (#312): Kuma's history, whose red is a past check's.
const STRIPS = '[data-slot="uptime-bar"]';
const rowOf = (page, id) => section(page).locator(`[data-entity="${id}"]`);
const MEDIA = { id: 'media', title: 'Media', containers: ['apps:jellyfin', 'photoprism'] };
// Integrations whose headline metric runs long, beside the demo's longest
// name and others: the detail gives way, never the name.
const LONG = 'across the edge, the gateways and both sites, with redirects and streams';
const INTEGRATIONS = {
  npm: { _preset: 'npm', Hosts: `31 proxy hosts ${LONG}` },
  adguard: { _preset: 'adguard', Status: `Filtering ${LONG}` },
  nextcloud: { _preset: 'nextcloud', Storage: `1.2 TB ${LONG}` },
};
// The integrations as a homelab's would answer, for the screenshots and the
// phone's "metric · latency" line.
const APPS = {
  adguard: { _preset: 'adguard', Queries: '41,203', Blocked: '7,412' },
  npm: { _preset: 'npm', 'Proxy Hosts': '31' },
  nextcloud: { _preset: 'nextcloud', Files: '18,204', Users: '6' },
  jellyfin: { _preset: 'jellyfin', Version: '10.9.1' },
  gitea: { _preset: 'gitea', Repos: '7' },
  vaultwarden: { _preset: 'vaultwarden', Users: '3' },
  photoprism: { _preset: 'photoprism', Photos: '24,499' },
  paperless: { _preset: 'paperless', Documents: '9,812' },
};

/** The demo's service names, longest first: its longest is the one to measure. */
const NAMES = demo('/api/status')
  .body.entities.filter((e) => e.subsystem === 'services')
  .map((e) => e.name)
  .sort((a, b) => b.length - a.length);

async function openBoard(page, scenario, theme, { config, answers } = {}) {
  await openApp(page, '/', { scenario, theme, config, answers });
  await expect(section(page).locator('[data-slot="entity-row"]').first()).toBeVisible();
  await expect(page.locator('[data-slot="node-card"]', { hasText: 'Network Edge' })).toBeVisible();
}

/**
 * Each row's name: its text, the width of its column (the name, or the name
 * and its node), and whether it is cut short (wider than its box).
 */
function names(page) {
  return section(page).evaluate((root) =>
    [...root.querySelectorAll('[data-slot="entity-row"]')].map((row) => {
      const name = row.querySelector('[data-slot="entity-name"]');
      const column = row.querySelector('[data-slot="entity-heading"]') ?? name;
      return {
        text: name.textContent,
        column: Math.round(column.getBoundingClientRect().width),
        cut: name.scrollWidth > name.clientWidth + 0.5,
      };
    })
  );
}

/** Text in the section wider or taller than its box, rows outside the window, sideways scroll. */
function clipping(page) {
  return section(page).evaluate((root) => {
    const out = [];
    for (const row of root.querySelectorAll('[data-slot="entity-row"]')) {
      const box = row.getBoundingClientRect();
      if (box.left < -0.5 || box.right > window.innerWidth + 0.5)
        out.push(`${row.dataset.entity}: outside the window`);
    }
    // The detail and the node give way by design (an ellipsis): the name never.
    for (const el of root.querySelectorAll(
      '[data-slot="entity-name"], h2, h3, [data-slot="segmented-control"]'
    )) {
      if (el.scrollWidth > el.clientWidth + 0.5 || el.scrollHeight > el.clientHeight + 0.5)
        out.push(`"${el.textContent.trim().slice(0, 40)}" cut off`);
    }
    if (document.documentElement.scrollWidth > window.innerWidth)
      out.push('the page scrolls sideways');
    return out;
  });
}

for (const size of ['wide', 'desktop']) {
  const viewport = VIEWPORTS[size];
  test.describe(`Services at ${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport });

    for (const grouping of ['node', 'group']) {
      test(`by ${grouping}: every name in full, its column at least 120px, the longest too`, async ({
        page,
      }) => {
        if (grouping === 'group')
          await page.addInitScript(
            ([k, v]) => localStorage.setItem(k, v),
            [GROUPING_PREF, 'group']
          );
        await openBoard(page, 'incident', 'dark', {
          config: { customGroups: [MEDIA] },
          answers: { '/api/integrations': INTEGRATIONS },
        });
        await expect(section(page)).toHaveAttribute('data-grouping', grouping);
        const detail = rowOf(page, 'services/edge:nginx-proxy-manager').locator(
          '[data-slot="entity-detail"]'
        );
        await expect(detail).toContainText('31 proxy hosts across');
        if (grouping === 'group')
          await expect(section(page).locator('[data-slot="entity-where"]').first()).toBeVisible();
        const all = await names(page);
        expect(all.map((n) => n.text).sort()).toEqual([...NAMES].sort());
        for (const n of all) {
          expect(n.cut, `${n.text}: cut short`).toBe(false);
          expect(n.column, `${n.text}: its column`).toBeGreaterThanOrEqual(120);
        }
        const longest = all.find((n) => n.text === NAMES[0]);
        expect(longest.column).toBeGreaterThanOrEqual(120);
        // The long metric gave way instead: it ends in an ellipsis.
        expect(await detail.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
        expect(await clipping(page)).toEqual([]);
      });
    }
  });
}

for (const size of ['tablet']) {
  const viewport = VIEWPORTS[size];
  test.describe(`Services at ${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport });

    test('a list: every name in full, nothing cut off, no sideways scroll', async ({ page }) => {
      await openBoard(page, 'incident', 'dark', { answers: { '/api/integrations': INTEGRATIONS } });
      // The Phone board's row: the name over its detail.
      const main = rowOf(page, 'services/apps:jellyfin').locator('[data-slot="entity-main"]');
      expect(await main.evaluate((el) => getComputedStyle(el).flexDirection)).toBe('column');
      for (const n of await names(page)) expect(n.cut, `${n.text}: cut short`).toBe(false);
      expect(await clipping(page)).toEqual([]);
    });

    test('the Phone board\'s line: "metric · latency" under the name, the latency never cut', async ({
      page,
    }) => {
      await openBoard(page, 'healthy', 'dark', {
        answers: { '/api/integrations': { ...APPS, npm: INTEGRATIONS.npm } },
      });
      const line = (id) => rowOf(page, id).locator('[data-slot="entity-detail"]');
      await expect(line('services/apps:nextcloud')).toHaveText('18,204 files · 142 ms');
      await expect(line('services/edge:wireguard')).toHaveText('9 ms');
      // A long metric gives way; its latency stays whole, inside the row.
      const latency = line('services/edge:nginx-proxy-manager').locator(
        '[data-slot="entity-detail-meta"]'
      );
      await expect(latency).toHaveText(' · 18 ms');
      const box = await latency.boundingBox();
      const row = await rowOf(page, 'services/edge:nginx-proxy-manager').boundingBox();
      expect(box.x + box.width).toBeLessThanOrEqual(row.x + row.width);
      expect(await latency.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    });
  });
}

test.describe('Services, healthy and in the incident', () => {
  test.use({ viewport: VIEWPORTS.wide });

  for (const theme of ['dark', 'light']) {
    test(`healthy, ${theme}: no red, amber or green but the small ok lamps; every row muted`, async ({
      page,
    }) => {
      await openBoard(page, 'healthy', theme);
      const { found, unread, lamps } = await statusHues(section(page), { skip: STRIPS });
      expect(unread).toEqual([]);
      expect(found).toEqual([]);
      expect(lamps.length).toBe(NAMES.length);
      for (const lamp of lamps) {
        expect(lamp.state).toBe('ok');
        expect(lamp.size).toBeLessThanOrEqual(16);
      }
      const rows = section(page).locator('[data-slot="entity-row"]');
      await expect(rows).toHaveCount(NAMES.length);
      for (const row of await rows.all()) await expect(row).toHaveAttribute('data-muted', '');
      expect(
        await axeFindings(new AxeBuilder({ page }).include('[data-slot="services-section"]'))
      ).toEqual([]);
    });

    test(`incident, ${theme}: red on Jellyfin's row alone, which isn't muted`, async ({ page }) => {
      await openBoard(page, 'incident', theme);
      const jellyfin = rowOf(page, 'services/apps:jellyfin');
      await expect(jellyfin).toHaveAttribute('data-state', 'crit');
      await expect(jellyfin).not.toHaveAttribute('data-muted', '');
      const { found } = await statusHues(section(page), { skip: STRIPS });
      expect(found.length).toBeGreaterThan(0);
      for (const f of found) {
        expect(f.hue).toBe('red');
        expect(f.text || f.at).toMatch(/Jellyfin|Kuma: down|entity-grid/);
      }
      expect(
        await axeFindings(new AxeBuilder({ page }).include('[data-slot="services-section"]'))
      ).toEqual([]);
    });
  }
});

test.describe('Services, grouped and filtered', () => {
  test.use({ viewport: VIEWPORTS.wide });

  test('by custom group: chosen, and kept across a reload', async ({ page }) => {
    await openBoard(page, 'incident', 'dark', { config: { customGroups: [MEDIA] } });
    const control = section(page).getByRole('radiogroup', { name: 'Group services by' });
    await expect(control.getByRole('radio', { name: 'Node' })).toBeChecked();
    await control.getByRole('radio', { name: 'Group' }).click();
    await expect(section(page)).toHaveAttribute('data-grouping', 'group');
    const titles = section(page).getByRole('heading', { level: 3 });
    await expect(titles).toHaveText(['Media', 'Not in a group']);
    await page.reload();
    await expect(section(page)).toHaveAttribute('data-grouping', 'group');
    await expect(control.getByRole('radio', { name: 'Group' })).toBeChecked();
    await expect(titles).toHaveText(['Media', 'Not in a group']);
  });

  test("the strip's Services cell brings the section alone into view", async ({ page }) => {
    await openBoard(page, 'incident', 'dark');
    const strip = page.getByRole('region', { name: 'Subsystems' });
    await strip.getByRole('button', { name: /^Services,/ }).click();
    await expect(page).toHaveURL(/\?subsystem=services$/);
    await expect(page.locator('[data-slot="infrastructure-section"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="node-card"]', { hasText: 'Network Edge' })).toHaveCount(
      0
    );
    await expect(section(page)).toBeInViewport();
    await strip.getByRole('button', { name: /^Nodes,/ }).click();
    await expect(section(page)).toHaveCount(0);
  });

  for (const size of ['wide', 'tablet']) {
    test(`at ${VIEWPORTS[size].width}: Jellyfin's issue row and its row in the section open its detail drawer (#309)`, async ({
      page,
    }) => {
      await page.setViewportSize(VIEWPORTS[size]);
      await openBoard(page, 'incident', 'dark');
      const link = page
        .getByRole('region', { name: 'Needs attention' })
        .getByRole('link', { name: /^Jellyfin, Down/ });
      await expect(link).toHaveAttribute('href', '/?entity=services/apps:jellyfin');
      await link.click();
      const drawer = page.getByRole('dialog', { name: 'Jellyfin' });
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('[data-slot="detail-status"]')).toContainText('Kuma: down');
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
      await expect(link).toBeFocused();
      const row = rowOf(page, 'services/apps:jellyfin');
      await expect(row).toHaveAttribute('href', '/?entity=services/apps:jellyfin');
      await row.click();
      await expect(drawer).toBeVisible();
      await page.goBack();
      await expect(drawer).toHaveCount(0);
      await expect(row).toBeFocused();
    });
  }
});

test.describe('the heartbeat strips (#312)', () => {
  for (const [size, viewport] of [
    ['1440', VIEWPORTS.wide],
    ['1024', VIEWPORTS.desktop],
  ]) {
    test(`${size}: a strip of 30 on every monitored row, failures where Kuma's failed, a check's tooltip, every row one line`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openBoard(page, 'incident', 'dark');
      const rows = section(page).locator('[data-slot="entity-row"]');
      // Every demo service has a Kuma monitor.
      await expect(section(page).locator(STRIPS)).toHaveCount(NAMES.length);
      const jellyfin = rowOf(page, 'services/apps:jellyfin').locator(STRIPS);
      await expect(jellyfin).toHaveAccessibleName(
        'Heartbeats: 30 failures in the last 30 checks, including the latest'
      );
      await expect(jellyfin.locator('[data-slot="beat"]')).toHaveCount(30);
      const red = await statusHues(jellyfin);
      expect(red.found.length).toBeGreaterThan(0);
      expect(red.found.every((f) => f.hue === 'red')).toBe(true);
      // An up service's strip: green checks, no red or amber (#629).
      const vaultwarden = rowOf(page, 'services/apps:vaultwarden').locator(STRIPS);
      await expect(vaultwarden).toHaveAccessibleName('Heartbeats: No failures in the last 30 checks');
      const green = (await statusHues(vaultwarden)).found;
      expect(green.length).toBeGreaterThan(0);
      expect(green.every((f) => f.hue === 'green')).toBe(true);

      await jellyfin.locator('[data-slot="beat"]').last().hover();
      const tip = page.locator('[data-slot="uptime-bar-tooltip"]');
      await expect(tip).toBeVisible();
      await expect(tip).toHaveText(/^Down\d{2}:\d{2}:\d{2}$/);
      await page.mouse.move(0, 0);
      await expect(tip).toHaveCount(0);

      // One line each: the row's height, the strip within it.
      for (const row of await rows.all()) {
        const box = await row.boundingBox();
        expect(box.height, await row.getAttribute('data-entity')).toBeLessThanOrEqual(41);
      }
    });
  }
});

test("the strips' tooltip loads with the floating layer, on the first pointer over one; nothing moves (#312)", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORTS.wide);
  await openBoard(page, 'incident', 'dark');
  const layerLoaded = () =>
    page.evaluate(() =>
      performance.getEntriesByType('resource').some((r) => /\/assets\/layer[-.]/.test(r.name))
    );
  expect(await layerLoaded(), 'no input yet: the first screen has no floating layer').toBe(false);
  // Every row's box, from the section's corner (the hover scrolls the page),
  // and every strip's markup, before.
  const look = () =>
    section(page).evaluate((root) => ({
      rows: [...root.querySelectorAll('[data-slot="entity-row"]')].map((r) => {
        const b = r.getBoundingClientRect();
        const at = root.getBoundingClientRect();
        return [b.x - at.x, b.y - at.y, b.width, b.height].map(Math.round).join(',');
      }),
      strips: [...root.querySelectorAll('[data-slot="uptime-bar"]')].map((s) =>
        s.outerHTML.replace(/ data-active=""/g, '')
      ),
    }));
  const before = await look();
  const strip = rowOf(page, 'services/apps:jellyfin').locator(STRIPS);
  await strip.locator('[data-slot="beat"]').nth(20).hover();
  await expect(page.locator('[data-slot="uptime-bar-tooltip"]')).toHaveText(
    /^Down\d{2}:\d{2}:\d{2}$/
  );
  expect(await layerLoaded()).toBe(true);
  expect(await look()).toEqual(before);
});

test.describe('screenshots for the PR', () => {
  for (const [size, viewport] of [
    ['desktop', VIEWPORTS.wide],
    ['tablet', VIEWPORTS.tablet],
  ]) {
    for (const theme of ['dark', 'light']) {
      for (const scenario of ['incident', 'healthy']) {
        test(`${scenario}, ${size}, ${theme}`, async ({ page }) => {
          await page.setViewportSize(viewport);
          await openBoard(page, scenario, theme, { answers: { '/api/integrations': APPS } });
          await expect(rowOf(page, 'services/apps:nextcloud')).toContainText('18,204 files');
          const dir = join(test.info().project.outputDir, 'shots');
          mkdirSync(dir, { recursive: true });
          await page.mouse.move(0, 0);
          // The whole page, cut to the section: no sticky chrome drawn over it.
          await page.evaluate(() => window.scrollTo(0, 0));
          const box = await section(page).boundingBox();
          await page.screenshot({
            path: `${dir}/services-${scenario}-${size}-${theme}.png`,
            fullPage: true,
            clip: box,
          });
        });
      }
    }
  }
});
