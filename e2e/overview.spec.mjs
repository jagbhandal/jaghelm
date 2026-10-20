/*
 * The top of the Overview in a real browser (#297): the demo's own status
 * model, in its incident and healthy scenarios, at 390 × 844 and 1440 × 900.
 *
 *  - Incident: the issue count and every issue row are on screen without
 *    scrolling: inside the window, under the header and above the phone's
 *    tabs.
 *  - Healthy, dark and light: the quiet line, and no red, amber or green
 *    anywhere in the status area but its one small lamp: every colour each element draws
 *    (text, fill, edges, outline, shadows, SVG paint), read in OKLCH.
 *  - An issue row, clicked or by Enter, brings its entity's place on today's
 *    board into view, clear of the header, and focuses it; a Ctrl-click opens
 *    a new tab and leaves this one where it was.
 *  - Screenshots of both scenarios at both sizes, dark and light, for the PR,
 *    in test-results/e2e/shots/.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { THEMES, WIDTHS, demo, openApp } from './app.mjs';

const STATUS = {
  incident: demo('/api/status').body,
  healthy: demo('/api/status', { scenario: 'healthy' }).body,
};

const statusArea = (page) => page.locator('[data-slot="overview-status"]');
const place = (page, anchor) => page.locator(`[id="${anchor}"]`);

/** The Overview in `scenario`, with the board under its status loaded, so nothing moves. */
async function openOverview(page, scenario, theme = 'dark') {
  await openApp(page, '/', { scenario, theme });
  await expect(page.getByText('Network Edge')).toBeVisible();
  await expect(statusArea(page).getByRole('region')).toBeVisible();
}

/** The part of the window nothing covers: under the sticky header, above the phone's tabs. */
function clearArea(page) {
  return page.evaluate(() => {
    const header = document.querySelector('[data-slot="app-header"]').getBoundingClientRect();
    const tabs = document.querySelector('[data-slot="bottom-tabs"]')?.getBoundingClientRect();
    const tabsTop = tabs && tabs.height > 0 ? tabs.top : window.innerHeight;
    return {
      top: header.bottom,
      bottom: Math.min(window.innerHeight, tabsTop),
      width: window.innerWidth,
    };
  });
}

/**
 * Every colour the status area draws, outside its lamps, that is red, amber
 * or green (OKLCH chroma 0.04 or more, hue in 345–45, 45–110 or 110–185: the
 * crit, warn and ok roles sit at about 25, 80 and 163, the accent at 293 and
 * maintenance's blue at 250), with where it is; and each lamp's size and
 * state. Colours are read by painting them on a canvas, so any CSS colour
 * the browser computes (oklch, color-mix, rgb) is read the same way; one it
 * can't paint is reported, not skipped.
 */
function statusColours(page) {
  return statusArea(page).evaluate((root) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const SENTINEL = '#010203';
    const paint = (css) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = SENTINEL;
      ctx.fillStyle = css;
      if (ctx.fillStyle === SENTINEL && !/^#010203$/i.test(css)) return null;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a };
    };
    const lin = (c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const oklch = ({ r, g, b }) => {
      const [R, G, B] = [lin(r), lin(g), lin(b)];
      const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
      const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
      const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
      const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
      const Bk = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
      return { C: Math.hypot(A, Bk), h: ((Math.atan2(Bk, A) * 180) / Math.PI + 360) % 360 };
    };
    const family = ({ C, h }) => {
      if (C < 0.04) return null;
      if (h < 45 || h >= 345) return 'red';
      if (h < 110) return 'amber';
      if (h < 185) return 'green';
      return null;
    };
    const COLOUR = /(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi;
    const where = (el) =>
      `${el.tagName.toLowerCase()}${el.dataset.slot ? `[${el.dataset.slot}]` : ''} "${(el.textContent ?? '').trim().slice(0, 40)}"`;

    const found = [];
    const unread = [];
    const check = (el, property, value) => {
      for (const css of value.match(COLOUR) ?? []) {
        const rgba = paint(css);
        if (!rgba) {
          unread.push(`${where(el)} ${property}: ${css}`);
          continue;
        }
        if (rgba.a === 0) continue;
        const hue = family(oklch(rgba));
        if (hue) found.push({ hue, property, css, at: where(el), text: el.textContent.trim() });
      }
    };
    const lamps = [...root.querySelectorAll('[data-slot="status-lamp"]')].map((lamp) => ({
      size: Math.round(lamp.getBoundingClientRect().width),
      state: lamp.dataset.state,
    }));
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el.closest('[data-slot="status-lamp"]')) continue;
      const cs = getComputedStyle(el);
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (ownText) check(el, 'color', cs.color);
      check(el, 'background-color', cs.backgroundColor);
      check(el, 'background-image', cs.backgroundImage);
      check(el, 'box-shadow', cs.boxShadow);
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const width = parseFloat(cs.getPropertyValue(`border-${side}-width`));
        if (width > 0 && cs.getPropertyValue(`border-${side}-style`) !== 'none') {
          check(el, `border-${side}-color`, cs.getPropertyValue(`border-${side}-color`));
        }
      }
      if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) {
        check(el, 'outline-color', cs.outlineColor);
      }
      if (cs.textDecorationLine !== 'none')
        check(el, 'text-decoration-color', cs.textDecorationColor);
      if (el instanceof SVGElement) {
        check(el, 'fill', cs.fill);
        check(el, 'stroke', cs.stroke);
      }
    }
    return { found, unread, lamps };
  });
}

for (const [name, viewport] of Object.entries(WIDTHS)) {
  test.describe(`the Overview's status at ${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport });

    test('incident: the issue count and every issue are on screen without scrolling', async ({
      page,
    }) => {
      expect(STATUS.incident.issues.map((i) => i.state)).toEqual(['crit', 'crit']);
      await openOverview(page, 'incident');
      const panel = statusArea(page).getByRole('region', { name: 'Needs attention' });
      const count = panel.getByRole('heading', { level: 2 });
      await expect(count).toHaveText('Critical · 2 critical');
      const rows = panel.locator('[data-slot="issue-row"]');
      await expect(rows).toHaveCount(STATUS.incident.issues.length);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      const area = await clearArea(page);
      for (const [what, el] of [
        ['the count', count],
        ...(await rows.all()).map((r, i) => [`issue ${i + 1}`, r]),
      ]) {
        const box = await el.boundingBox();
        expect(box, `${what} is drawn`).not.toBeNull();
        expect(box.x, `${what}: left edge`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${what}: right edge`).toBeLessThanOrEqual(area.width);
        expect(box.y, `${what}: under the header`).toBeGreaterThanOrEqual(area.top);
        expect(box.y + box.height, `${what}: above the fold`).toBeLessThanOrEqual(area.bottom);
      }

      // The colour probe below sees status colours where they are: the word.
      const { found, unread } = await statusColours(page);
      expect(unread).toEqual([]);
      expect(found).toContainEqual(expect.objectContaining({ hue: 'red', text: 'Critical' }));
    });

    for (const theme of Object.keys(THEMES)) {
      test(`healthy, ${theme}: the quiet line, and no red, amber or green but its small lamp`, async ({
        page,
      }) => {
        await openOverview(page, 'healthy', theme);
        const line = statusArea(page).getByRole('region', { name: 'Status' });
        await expect(line.getByRole('heading', { level: 2 })).toHaveText('All systems normal');
        await expect(line).toContainText(STATUS.healthy.overall.sentence);
        await expect(statusArea(page).getByRole('region', { name: 'Needs attention' })).toHaveCount(
          0
        );

        const { found, unread, lamps } = await statusColours(page);
        expect(unread).toEqual([]);
        expect(lamps, 'one lamp, the small one').toEqual([{ size: 10, state: 'ok' }]);
        expect(found, 'red, amber or green in the status area').toEqual([]);
      });
    }

    test("an issue row brings its entity's place on the board into view, by click and by Enter", async ({
      page,
    }) => {
      await openOverview(page, 'incident');
      const area = await clearArea(page);
      const panel = statusArea(page).getByRole('region', { name: 'Needs attention' });

      // nightly-backup's row, clicked: the job's row in Scheduled Jobs.
      const job = place(page, 'entity-jobs/storage:nightly-backup');
      const below = (await job.boundingBox()).y > area.bottom;
      await panel.getByRole('link', { name: /^nightly-backup, Failed/ }).click();
      await expect(job).toBeFocused();
      await expect(job).toBeInViewport();
      expect((await job.boundingBox()).y, 'clear of the header').toBeGreaterThanOrEqual(area.top);
      if (below) expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await expect(page).toHaveURL(/#entity-jobs\/storage:nightly-backup$/);

      // Back to the top; Jellyfin's row, by Enter: its service card.
      await page.evaluate(() => window.scrollTo(0, 0));
      const card = place(page, 'entity-services/apps:jellyfin');
      await panel.getByRole('link', { name: /^Jellyfin, Down/ }).focus();
      await page.keyboard.press('Enter');
      await expect(card).toBeFocused();
      await expect(card).toBeInViewport();
      expect((await card.boundingBox()).y, 'clear of the header').toBeGreaterThanOrEqual(area.top);
    });

    test('a Ctrl-click on a row is the browser’s: a new tab, and this one stays put', async ({
      page,
    }) => {
      await openOverview(page, 'incident');
      const job = place(page, 'entity-jobs/storage:nightly-backup');
      const row = statusArea(page).getByRole('link', { name: /^nightly-backup, Failed/ });
      const opened = page.context().waitForEvent('page');
      await row.click({ modifiers: ['ControlOrMeta'] });
      const tab = await opened;
      expect(new URL(tab.url()).hash).toBe('#entity-jobs/storage:nightly-backup');
      await tab.close();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await expect(job).not.toBeFocused();
      expect(new URL(page.url()).hash).toBe('');
    });

    for (const theme of ['dark', 'light']) {
      for (const scenario of ['incident', 'healthy']) {
        test(`a screenshot for the PR: ${scenario}, ${theme}`, async ({ page }) => {
          const dir = join(test.info().project.outputDir, 'shots');
          mkdirSync(dir, { recursive: true });
          await openOverview(page, scenario, theme);
          await page.screenshot({ path: `${dir}/overview-${scenario}-${name}-${theme}.png` });
        });
      }
    }
  });
}
