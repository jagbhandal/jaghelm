/*
 * The web on a phone, in a real browser (#303, spec §7, §8 "Phone width"):
 * below 768px it draws the phone screens the Android app draws (src/phone/),
 * in the web's look, on the demo's own status model.
 *
 *  - The tabs, at 390 and 360: Overview, Services, Infrastructure (drawn
 *    "Infra"), Alerts and More, each tab its screen under its own URL; More
 *    keeps the apps, Launch and Settings. From 768px /services and
 *    /infrastructure are the wide pages (#313, pages.spec.mjs, which crosses
 *    768px on both).
 *  - The Overview in the Android app's order: the status card, the strip, the
 *    issue rows ("Needs attention · 2"), then Services and Infrastructure as
 *    lists. With six issues the strip is still on screen without scrolling.
 *  - A row opens its detail over the tab: a full-screen sheet, a modal dialog
 *    named by its title. The browser's Back closes it and focus is back on
 *    the row; Escape and the sheet's own Back do the same; Forward opens it
 *    again; a detail opened from a detail stacks over it.
 *  - The header is the Phone board's (#569), at both widths and in both
 *    themes: 56px, the shield and the name, the theme toggle (44px), which
 *    switches the theme, nothing else; the status word is the card's alone.
 *  - More keeps Log out, when signing in is asked for (#569), as an entry.
 *  - The mock's type: the status word alone, 22/28 at 800 beside a 16px
 *    lamp, a sheet's title the same, the Alerts tab's count 10px at 800 in
 *    an 18 × 16 pill.
 *  - A reload with a sheet open, the cards slow: "Loading…" in the sheet
 *    until they come, then the service; never "no longer monitored".
 *  - Healthy: every lamp ok, nothing red or amber, no green word.
 *  - No signal: nothing red, amber or green outside the lamps, every lamp
 *    the steel ring, what was last known kept; and with the server out of
 *    reach or answering 503 from the start, "No signal" and why.
 *  - axe on each screen and each detail, dark and light.
 *  - At 767px the phone screens and the tabs, at 768px neither.
 *  - Screenshots, for the PR, in test-results/e2e/shots/.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { axeFindings, demo, openApp, reply, statusHues } from './app.mjs';
import { sixIssueIncident } from '../src/testing/statusFixtures.js';

const PHONES = {
  390: { width: 390, height: 844 },
  360: { width: 360, height: 780 },
};

const view = (page) => page.locator('[data-slot="phone-view"]');
const top = (page) => page.getByRole('banner');
const tabs = (page) => page.getByRole('navigation', { name: 'Tabs' });
const panel = (page) => view(page).locator('[data-slot="attention-panel"]');
const header = (page) => panel(page).locator('[data-slot="attention-panel-header"]');
const strip = (page) => view(page).getByRole('region', { name: 'Subsystems' });
const issueRows = (page) => panel(page).locator('[data-slot="issue-row"]');
const section = (page, name) =>
  view(page)
    .getByRole('region', { name, exact: true })
    .filter({ has: page.locator('ul') });
const sheet = (page) => page.locator('[data-slot="phone-sheet"]');
const bottom = (box) => box.y + box.height;

/** The Overview in `scenario` (or on `answers`), its lists drawn. */
async function openPhone(page, path = '/', options = {}) {
  const server = await openApp(page, path, options);
  await expect(view(page)).toBeVisible();
  if (path === '/') {
    await expect(panel(page)).toBeVisible();
    await expect(
      section(page, 'Services').locator('[data-slot="entity-row"]').first()
    ).toBeVisible();
  }
  await page.evaluate(() => document.fonts.ready);
  return server;
}

/** The six-issue incident's board (sixIssueIncident), as /api/status and /api/services answer it. */
function sixIssues() {
  const board = sixIssueIncident();
  return { '/api/status': board.status, '/api/services': board.services };
}

/** The shots folder. */
function shots() {
  const dir = join(test.info().project.outputDir, 'shots');
  mkdirSync(dir, { recursive: true });
  return dir;
}

for (const [width, viewport] of Object.entries(PHONES)) {
  test.describe(`a phone, ${width} × ${viewport.height}`, () => {
    test.use({ viewport });

    test('the five tabs, each its own screen and URL; More keeps the rest', async ({ page }) => {
      await openPhone(page);
      const t = tabs(page);
      await expect(t.locator('[data-slot="bottom-tab"]')).toHaveText([
        'Overview',
        'Services',
        'Infra',
        /Alerts$/,
        'More',
      ]);
      await expect(t.getByRole('link', { name: 'Overview' })).toHaveAttribute(
        'aria-current',
        'page'
      );
      for (const [name, path, title] of [
        ['Services', '/services', 'Services'],
        ['Infrastructure', '/infrastructure', 'Infrastructure'],
        [/^Alerts/, '/alerts', 'Alerts'],
      ]) {
        await t.getByRole('link', { name }).click();
        await expect(page).toHaveURL(path);
        await expect(view(page).getByRole('heading', { level: 1, name: title })).toBeVisible();
        await expect(t.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
      }
      await expect(view(page).locator('[data-slot="node-card"]').first()).toHaveCount(0);
      await t.getByRole('button', { name: 'More' }).click();
      const more = page.getByRole('dialog', { name: 'More' });
      await expect(more.getByRole('link', { name: 'Launch' })).toBeVisible();
      await expect(more.getByRole('link', { name: 'Settings' })).toBeVisible();
      await expect(more.getByRole('link', { name: 'Grafana' })).toBeVisible();
    });

    test("the Overview in the Android app's order: status, strip, issues, then Services and Infrastructure", async ({
      page,
    }) => {
      await openPhone(page);
      // The desktop Overview isn't drawn on a phone.
      await expect(page.locator('[data-slot="overview-board"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="overview-status"]')).toHaveCount(0);
      const status = demo('/api/status').body;
      // The word alone, as the Phone board's card says it.
      await expect(header(page).getByRole('heading', { level: 2 })).toHaveText(/^Critical$/);
      await expect(header(page)).toContainText(status.overall.sentence);
      await expect(header(page)).toContainText(/Updated \d+ s ago/);
      const label = panel(page).getByRole('heading', { level: 3 });
      await expect(label).toHaveText(/^Needs attention · 2$/i);
      await expect(issueRows(page)).toHaveCount(status.issues.length);
      const services = section(page, 'Services').locator('[data-slot="entity-row"]');
      const nodes = section(page, 'Infrastructure').locator('[data-slot="entity-row"]');
      await expect(services).toHaveCount(
        status.entities.filter((e) => e.kind === 'service' || e.kind === 'container').length
      );
      await expect(nodes).toHaveCount(status.entities.filter((e) => e.kind === 'node').length);
      // Worst first: the service that is down heads the list.
      await expect(services.first()).toHaveAccessibleName('Jellyfin, Down');

      const order = [
        await header(page).boundingBox(),
        await strip(page).boundingBox(),
        await label.boundingBox(),
        await issueRows(page).last().boundingBox(),
        await section(page, 'Services').boundingBox(),
        await section(page, 'Infrastructure').boundingBox(),
      ];
      for (let i = 1; i < order.length; i += 1)
        expect(order[i].y, `part ${i + 1} under part ${i}`).toBeGreaterThanOrEqual(
          bottom(order[i - 1]) - 0.5
        );
      // Nothing sideways.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    });

    for (const theme of ['dark', 'light']) {
      test(`the header is the Phone board's, ${theme}: 56px, the shield, the name and the theme toggle; the status word is the card's alone`, async ({
        page,
      }) => {
        await openPhone(page, '/', { theme });
        const banner = top(page);
        await expect(banner).toHaveAttribute('data-slot', 'phone-header');
        expect(await banner.boundingBox()).toEqual({
          x: 0,
          y: 0,
          width: viewport.width,
          height: 56,
        });
        // The brand: a 30px mark 16px in, centred above the 1px edge as the
        // mock's is, and the name beside it.
        const home = banner.getByRole('link');
        await expect(home).toHaveCount(1);
        await expect(home).toHaveAccessibleName('JagHelm');
        await expect(home).toHaveAttribute('href', '/');
        expect(await home.locator('img').boundingBox()).toEqual({
          x: 16,
          y: 12.5,
          width: 30,
          height: 30,
        });
        // What the header draws, the screen reader's live region aside: the name.
        const drawn = await banner.evaluate((el) => {
          const out = [];
          const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          while (walk.nextNode()) {
            if (!walk.currentNode.parentElement.closest('.sr-only'))
              out.push(walk.currentNode.data);
          }
          return out.join('').trim();
        });
        expect(drawn).toBe('JagHelm');
        await expect(banner.getByRole('status')).toContainText('Critical');
        await expect(header(page).getByRole('heading', { level: 2 })).toHaveText('Critical');
        // One button, the theme toggle: 44px, 16px from the edge.
        const other = theme === 'dark' ? 'light' : 'dark';
        await expect(banner.getByRole('button')).toHaveCount(1);
        const toggle = banner.getByRole('button', { name: `Switch to ${other} theme` });
        expect(await toggle.boundingBox()).toEqual({
          x: viewport.width - 16 - 44,
          y: 5.5,
          width: 44,
          height: 44,
        });
        // It switches the theme, the header's and the screens', and keeps it.
        const themeOf = (locator) =>
          locator.evaluate((el) => el.closest('.jh-ui').getAttribute('data-theme') ?? 'dark');
        expect(await themeOf(banner)).toBe(theme);
        await toggle.click();
        await expect(
          banner.getByRole('button', { name: `Switch to ${theme} theme` })
        ).toBeVisible();
        expect(await themeOf(banner)).toBe(other);
        expect(await themeOf(panel(page))).toBe(other);
        expect(await page.evaluate(() => localStorage.getItem('jaghelm-theme'))).toBe(other);
      });
    }

    test('with signing in asked for, More ends with Log out, drawn as its entries, which signs out', async ({
      page,
    }) => {
      let signedIn = true;
      await openPhone(page, '/', {
        answers: {
          '/api/auth/check': () => ({ authRequired: true, authenticated: signedIn }),
          '/api/auth/logout': () => {
            signedIn = false;
            return { ok: true };
          },
        },
      });
      await tabs(page).getByRole('button', { name: 'More' }).click();
      const more = page.getByRole('dialog', { name: 'More' });
      const settings = more.getByRole('link', { name: 'Settings' });
      const logout = more.getByRole('button', { name: 'Log out' });
      await expect(logout).toBeVisible();
      // Its label starts where the links' labels do.
      const labelX = (entry) =>
        entry.evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el.querySelector('span.flex-1'));
          return range.getBoundingClientRect().x;
        });
      expect(await labelX(logout)).toBe(await labelX(settings));
      await page.screenshot({ path: `${shots()}/phone-more-logout-${width}.png` });
      await logout.click();
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    });

    test('with six issues the strip is still on screen without scrolling', async ({ page }) => {
      await openApp(page, '/', { answers: sixIssues() });
      await expect(issueRows(page)).toHaveCount(6);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const header = await top(page).boundingBox();
      const tabsTop = (await tabs(page).boundingBox()).y;
      const box = await strip(page).boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(bottom(header));
      expect(bottom(box)).toBeLessThanOrEqual(tabsTop);
    });

    test('a row opens its detail as a sheet; Back closes it and focus is back on the row', async ({
      page,
    }) => {
      await openPhone(page);
      const row = section(page, 'Services').getByRole('button', { name: 'Jellyfin, Down' });
      await row.focus();
      await page.keyboard.press('Enter');
      const detail = page.getByRole('dialog', { name: 'Jellyfin' });
      await expect(detail).toBeVisible();
      await expect(detail).toContainText('Kuma: down');
      // Full screen, over the header and the tabs.
      const box = await detail.boundingBox();
      expect(box).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
      // The browser's Back closes it; focus is back on the row.
      await page.goBack();
      await expect(sheet(page)).toHaveCount(0);
      await expect(row).toBeFocused();
      await expect(page).toHaveURL('/');
      // Forward opens it again.
      await page.goForward();
      await expect(page.getByRole('dialog', { name: 'Jellyfin' })).toBeVisible();
      // Escape closes it too.
      await page.keyboard.press('Escape');
      await expect(sheet(page)).toHaveCount(0);
      // And its own Back.
      await row.focus();
      await page.keyboard.press('Enter');
      await page
        .getByRole('dialog', { name: 'Jellyfin' })
        .getByRole('button', { name: 'Back' })
        .click();
      await expect(sheet(page)).toHaveCount(0);
      await expect(row).toBeFocused();
    });

    test('an issue row and a node open theirs; a detail opened from a detail stacks over it', async ({
      page,
    }) => {
      await openPhone(page);
      const issue = issueRows(page).filter({ hasText: 'nightly-backup' });
      await issue.click();
      const backup = page.getByRole('dialog', { name: 'nightly-backup' });
      await expect(backup).toContainText('Backup');
      await expect(backup).toContainText('repository is locked');
      await page.goBack();
      await expect(issue).toBeFocused();

      const node = section(page, 'Infrastructure').getByRole('button', { name: /^Storage,/ });
      await node.click();
      const storage = page.getByRole('dialog', { name: 'Storage' });
      await expect(storage.locator('[data-slot="metric-meter"]').first()).toBeVisible();
      const hosted = storage.getByRole('button', { name: /^Backrest,/ });
      await hosted.click();
      await expect(page.getByRole('dialog', { name: 'Backrest' })).toBeVisible();
      await expect(sheet(page)).toHaveCount(2);
      await page.goBack();
      await expect(sheet(page)).toHaveCount(1);
      await expect(hosted).toBeFocused();
      await page.goBack();
      await expect(sheet(page)).toHaveCount(0);
      await expect(node).toBeFocused();
    });

    test("the mock's type: the status word 22/28 at 800 by a 16px lamp, a sheet's title the same, the tab count 10px", async ({
      page,
    }) => {
      await openPhone(page);
      const type = (locator) =>
        locator.evaluate((el) => {
          const cs = getComputedStyle(el);
          return [cs.fontSize, cs.lineHeight, cs.fontWeight, cs.letterSpacing];
        });
      const heading = header(page).getByRole('heading', { level: 2 });
      expect(await type(heading)).toEqual(['22px', '28px', '800', '-0.33px']);
      expect(await type(heading.locator('[data-slot="status-word"]'))).toEqual([
        '22px',
        '28px',
        '800',
        '-0.33px',
      ]);
      const lamp = await header(page).locator('[data-slot="status-lamp"]').boundingBox();
      expect([lamp.width, lamp.height]).toEqual([16, 16]);
      const badge = tabs(page).locator('[data-slot="tab-badge"]');
      await expect(badge).toHaveText('2');
      expect(await type(badge)).toEqual(['10px', '16px', '800', 'normal']);
      const pill = await badge.boundingBox();
      expect(pill.height).toBe(16);
      expect(pill.width).toBeGreaterThanOrEqual(18);
      await section(page, 'Services').getByRole('button', { name: 'Jellyfin, Down' }).click();
      const title = page.getByRole('dialog', { name: 'Jellyfin' }).getByRole('heading', {
        level: 2,
      });
      expect(await type(title)).toEqual(['22px', '28px', '800', '-0.33px']);
      const boxLamp = await page
        .locator('[data-slot="detail-status"] [data-slot="status-lamp"]')
        .boundingBox();
      expect([boxLamp.width, boxLamp.height]).toEqual([16, 16]);
    });

    test('a reload with a sheet open and the cards slow: "Loading…" until they come, never "no longer monitored"', async ({
      page,
    }) => {
      await openPhone(page);
      await section(page, 'Services').getByRole('button', { name: 'Jellyfin, Down' }).click();
      await expect(page.getByRole('dialog', { name: 'Jellyfin' })).toBeVisible();
      let answer;
      const held = new Promise((resolve) => (answer = resolve));
      await page.route(
        (url) => url.pathname === '/api/services',
        async (route) => {
          await held;
          await route.fallback();
        }
      );
      await page.reload();
      const waiting = page.getByRole('dialog', { name: 'Loading…' });
      await expect(waiting).toBeVisible();
      await expect(waiting.locator('[aria-busy="true"]')).toBeVisible();
      await expect(waiting).toContainText('Service');
      // The status has answered by now: still waiting for the cards.
      await expect(header(page)).toHaveCount(1);
      await expect(page.getByText(/no longer (reported|monitored)/i)).toHaveCount(0);
      await page.screenshot({ path: `${shots()}/phone-detail-loading-${width}.png` });
      answer();
      const detail = page.getByRole('dialog', { name: 'Jellyfin' });
      await expect(detail).toContainText('Kuma: down');
      await expect(page.getByText(/no longer (reported|monitored)/i)).toHaveCount(0);
      // Back still closes it, onto the Overview.
      await page.goBack();
      await expect(sheet(page)).toHaveCount(0);
    });

    test('healthy: every lamp ok, nothing red or amber, no green word', async ({ page }) => {
      await openPhone(page, '/', { scenario: 'healthy' });
      await expect(panel(page)).toHaveAttribute('data-state', 'ok');
      await expect(header(page).getByRole('heading', { level: 2 })).toHaveText(
        'All systems normal'
      );
      await expect(header(page)).toContainText(
        demo('/api/status', { scenario: 'healthy' }).body.overall.sentence
      );
      // A heartbeat strip's healthy checks are green, as Kuma's (#629): left out.
      const { found, unread, lamps } = await statusHues(view(page), {
        skip: '[data-slot="uptime-bar"]',
      });
      expect(unread).toEqual([]);
      expect(lamps.length).toBeGreaterThan(6);
      expect(lamps.filter((l) => l.state !== 'ok')).toEqual([]);
      // Quiet (spec rule 3): the lamps say ok; no word or tint in red, amber or green.
      expect(found).toEqual([]);
      expect((await statusHues(tabs(page))).found).toEqual([]);
    });

    for (const [why, options, cause] of [
      ['out of reach', { down: true }, "Can't reach JagHelm"],
      [
        'answering 503',
        {
          answers: {
            '/api/status': () => reply(503, { error: 'Status not yet available' }),
          },
        },
        'Waiting for the first check',
      ],
    ]) {
      test(`the server ${why} from the start: No signal and why, nothing red, amber or green`, async ({
        page,
      }) => {
        await openApp(page, '/', options);
        await expect(view(page)).toBeVisible();
        const banner = view(page).locator('[data-slot="banner"]').first();
        await expect(banner).toContainText('No signal');
        await expect(banner).toContainText(cause);
        const overview = await statusHues(view(page));
        expect(overview.found, 'red, amber or green on the Overview').toEqual([]);
        expect(overview.lamps.filter((l) => l.state !== 'unknown')).toEqual([]);
        // The cards have come: each service no signal, its sheet too, never
        // a state nobody judged.
        await tabs(page).getByRole('link', { name: 'Services' }).click();
        const rows = view(page).locator('[data-slot="entity-row"]');
        await expect(rows.first()).toBeVisible();
        const list = await statusHues(view(page));
        expect(list.found, 'red, amber or green on Services').toEqual([]);
        expect(list.lamps.length).toBeGreaterThan(6);
        expect(list.lamps.filter((l) => l.state !== 'unknown')).toEqual([]);
        await rows.first().click();
        await expect(page.locator('[data-slot="detail-status"]')).toHaveAttribute(
          'data-state',
          'unknown'
        );
      });
    }

    test('No signal: every lamp the steel ring, nothing red, amber or green, the words last known', async ({
      page,
    }) => {
      await page.clock.install();
      const server = await openPhone(page);
      const fresh = await statusHues(view(page));
      expect(fresh.found).toContainEqual(expect.objectContaining({ hue: 'red' }));
      server.down = true;
      await page.clock.runFor(30_000);
      await expect(panel(page)).toHaveAttribute('data-state', 'unknown');
      // As the Android card says it: "No signal", why, then what it last knew.
      await expect(header(page).getByRole('heading', { level: 2 })).toHaveText('No signal');
      await expect(header(page)).toContainText("Can't reach JagHelm");
      await expect(header(page)).toContainText(/last known \d+ s ago: Critical · 2 critical/);
      const { found, unread, lamps } = await statusHues(view(page));
      expect(unread).toEqual([]);
      expect(found, 'red, amber or green on the screen').toEqual([]);
      expect(lamps.length).toBeGreaterThan(6);
      expect(lamps.filter((l) => l.state !== 'unknown')).toEqual([]);
      // The status card's colours are the screen's, above. The header draws
      // no status (#569); its live region says No signal and why.
      await expect(top(page).getByRole('status')).toHaveText("No signal: Can't reach JagHelm");
      // The lists say how old they are, by the same clock.
      await expect(section(page, 'Services')).toContainText(/Last known \d+ s ago/);
    });

    for (const theme of ['dark', 'light']) {
      test(`axe finds nothing on the screens and the details, ${theme}`, async ({ page }) => {
        const found = [];
        const check = async (where) => {
          await page.evaluate(() => document.fonts.ready);
          for (const f of await axeFindings(new AxeBuilder({ page }))) found.push(`${where}: ${f}`);
        };
        await openPhone(page, '/', { theme });
        await check('Overview');
        await section(page, 'Services').getByRole('button', { name: 'Jellyfin, Down' }).click();
        await expect(page.getByRole('dialog', { name: 'Jellyfin' })).toBeVisible();
        await check('service detail');
        await page.goBack();
        await section(page, 'Infrastructure')
          .getByRole('button', { name: /^Storage,/ })
          .click();
        await expect(page.getByRole('dialog', { name: 'Storage' })).toBeVisible();
        await check('node detail');
        await page.goBack();
        await issueRows(page).filter({ hasText: 'nightly-backup' }).click();
        await expect(page.getByRole('dialog', { name: 'nightly-backup' })).toBeVisible();
        await check('incident detail');
        await page.goBack();
        for (const [name, path] of [
          ['Services', '/services'],
          ['Infrastructure', '/infrastructure'],
          [/^Alerts/, '/alerts'],
        ]) {
          await tabs(page).getByRole('link', { name }).click();
          await expect(page).toHaveURL(path);
          await check(path);
        }
        await openPhone(page, '/', { theme, scenario: 'healthy' });
        await check('Overview, healthy');
        expect(found).toEqual([]);
      });

      test(`screenshots for the PR, ${theme}`, async ({ page }) => {
        const dir = shots();
        const at = (name) => `${dir}/phone-${name}-${width}-${theme}.png`;
        await page.clock.install();
        const server = await openPhone(page, '/', { theme });
        await page.mouse.move(0, 0);
        await top(page).screenshot({ path: at('header') });
        await page.screenshot({ path: at('overview-incident') });
        await page.screenshot({ path: at('overview-incident-page'), fullPage: true });
        await section(page, 'Services').getByRole('button', { name: 'Jellyfin, Down' }).click();
        await expect(page.getByRole('dialog', { name: 'Jellyfin' })).toBeVisible();
        await page.screenshot({ path: at('detail-service') });
        await page.goBack();
        await section(page, 'Infrastructure')
          .getByRole('button', { name: /^Storage,/ })
          .click();
        await expect(page.getByRole('dialog', { name: 'Storage' })).toBeVisible();
        await page.screenshot({ path: at('detail-node') });
        await page.goBack();
        await issueRows(page).filter({ hasText: 'nightly-backup' }).click();
        await expect(page.getByRole('dialog', { name: 'nightly-backup' })).toBeVisible();
        await page.screenshot({ path: at('detail-incident') });
        await page.goBack();
        for (const [name, path] of [
          ['Services', 'services'],
          ['Infrastructure', 'infrastructure'],
          [/^Alerts/, 'alerts'],
        ]) {
          await tabs(page).getByRole('link', { name }).click();
          await expect(page).toHaveURL(`/${path}`);
          await page.mouse.move(0, 0);
          await page.screenshot({ path: at(path), fullPage: true });
        }
        await tabs(page).getByRole('link', { name: 'Overview' }).click();
        await expect(panel(page)).toBeVisible();
        server.down = true;
        await page.clock.runFor(30_000);
        await expect(panel(page)).toHaveAttribute('data-state', 'unknown');
        await page.screenshot({ path: at('overview-no-signal') });

        await openPhone(page, '/', { theme, scenario: 'healthy' });
        await page.mouse.move(0, 0);
        await page.screenshot({ path: at('overview-healthy') });
        await page.screenshot({ path: at('overview-healthy-page'), fullPage: true });
      });
    }
  });
}

// The phone screens follow the shell's own breakpoint (PHONE_WIDTH,
// @ui/app-shell), so they come and go with the bottom tabs, at the same pixel.
for (const [width, phone] of [
  [767, true],
  [768, false],
]) {
  test.describe(`at ${width} × 900`, () => {
    test.use({ viewport: { width, height: 900 } });

    test(`${phone ? 'the phone screens and the tabs' : 'the desktop Overview and the sidebar'}`, async ({
      page,
    }) => {
      await openApp(page, '/');
      if (phone) {
        await expect(view(page)).toBeVisible();
        await expect(page.locator('[data-slot="bottom-tabs"]')).toBeVisible();
        await expect(page.locator('[data-slot="overview-status"]')).toHaveCount(0);
      } else {
        await expect(page.locator('[data-slot="overview-status"]')).toBeVisible();
        await expect(page.locator('[data-slot="side-nav"]')).toBeVisible();
        await expect(view(page)).toHaveCount(0);
      }
    });
  });
}
