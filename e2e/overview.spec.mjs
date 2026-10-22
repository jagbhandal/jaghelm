/*
 * The top of the Overview in a real browser (#297): the demo's own status
 * model, in its incident and healthy scenarios, at 390 × 844 and 1440 × 900.
 *
 *  - Incident: the issue count and every issue row are on screen without
 *    scrolling: inside the window, under the header and above the phone's
 *    tabs.
 *  - Healthy, dark and light: the quiet line, and no red, amber or green
 *    anywhere in the status area but its small lamps (the line's, and one
 *    per subsystem tile): every colour each element draws (text, fill,
 *    edges, outline, shadows, SVG paint), read in OKLCH.
 *  - The subsystem strip (#298): on screen under the status without
 *    scrolling (on a phone, under the panel's header, #484), a tile per subsystem the model has anything in, nothing in it
 *    cut off, at 360px too. A tile, clicked or by Space and Enter, filters
 *    the rows and the board to its subsystem and back, in the URL, so Back
 *    and Forward follow it; a filter whose panel is switched off says so.
 *  - An issue row, clicked or by Enter, brings its entity's place on today's
 *    board into view, clear of the header, and focuses it. It is a link to
 *    that place's anchor, and a click with a modifier key or the middle
 *    button is the browser's: the page neither cancels it nor moves (#515).
 *  - Screenshots of both scenarios, and the incident filtered to Services,
 *    at both sizes, dark and light, for the PR, in test-results/e2e/shots/.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { THEMES, WIDTHS, axeFindings, demo, openApp, statusHues } from './app.mjs';

const STATUS = {
  incident: demo('/api/status').body,
  healthy: demo('/api/status', { scenario: 'healthy' }).body,
};

/** The subsystems the model has anything in: the strip's tiles, in its order. */
const CONFIGURED = Object.fromEntries(
  Object.entries(STATUS).map(([k, s]) => [k, s.subsystems.filter((x) => x.counts.total > 0)])
);

const statusArea = (page) => page.locator('[data-slot="overview-status"]');
const place = (page, anchor) => page.locator(`[id="${anchor}"]`);
const strip = (page) => statusArea(page).getByRole('region', { name: 'Subsystems' });
const tile = (page, name) => strip(page).getByRole('button', { name: new RegExp(`^${name},`) });
const panelTitle = (page, title) => page.locator('.section-title', { hasText: title });

/** The Overview in `scenario`, with the board under its status loaded, so nothing moves. */
async function openOverview(page, scenario, theme = 'dark') {
  await openApp(page, '/', { scenario, theme });
  await expect(panelTitle(page, 'Network Edge')).toBeVisible();
  await expect(statusArea(page).getByRole('region').first()).toBeVisible();
  await expect(strip(page)).toBeVisible();
}

/**
 * Dispatches a `click` at `row` for each entry of `clicks` (name -> its
 * MouseEvent fields: a modifier key, another button, or none) and returns,
 * by name, what the page did with it: whether it cancelled it (`prevented`),
 * what it called on the way to a place (`moves`: focus, scrollIntoView,
 * scrollTo), and whether focus or the scroll changed. A listener on the
 * window, the last to see the click, records `prevented` and only then
 * cancels the browser's own action (follow the link, a new tab or window):
 * that is Chromium's, not JagHelm's, so the run never depends on a tab
 * opening (#515). The browser fires no `click` for a real middle click (an
 * `auxclick`), but the row's handler checks the button all the same.
 */
function clicksOn(row, clicks) {
  return row.evaluate((el, clicks) => {
    const spied = [
      [HTMLElement.prototype, 'focus'],
      [Element.prototype, 'scrollIntoView'],
      [Element.prototype, 'scrollTo'],
      [window, 'scrollTo'],
    ];
    const out = {};
    for (const [name, init] of Object.entries(clicks)) {
      const moves = [];
      const real = spied.map(([on, method]) => on[method]);
      spied.forEach(([on, method], i) => {
        on[method] = function (...args) {
          moves.push(method);
          return real[i].apply(this, args);
        };
      });
      let prevented = null;
      const last = (e) => {
        prevented = e.defaultPrevented;
        e.preventDefault();
      };
      window.addEventListener('click', last);
      const focus = document.activeElement;
      const y = window.scrollY;
      try {
        el.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, view: window, ...init })
        );
      } finally {
        window.removeEventListener('click', last);
        spied.forEach(([on, method], i) => {
          on[method] = real[i];
        });
      }
      out[name] = {
        prevented,
        moves,
        focused: document.activeElement !== focus,
        scrolled: window.scrollY !== y,
      };
    }
    return out;
  }, clicks);
}

/**
 * What the strip cuts off: a tile outside the strip or the window, and any
 * text in a tile wider or taller than its box (an ellipsis, a clipped line),
 * with how the page scrolls sideways.
 */
function stripClipping(page) {
  return strip(page).evaluate((root) => {
    const out = [];
    const frame = root.getBoundingClientRect();
    for (const tile of root.querySelectorAll('[data-slot="subsystem-tile"]')) {
      const box = tile.getBoundingClientRect();
      const name = tile.getAttribute('aria-label');
      if (box.left < frame.left - 0.5 || box.right > frame.right + 0.5)
        out.push(`${name}: outside the strip`);
      if (box.left < 0 || box.right > window.innerWidth) out.push(`${name}: outside the window`);
      for (const el of [tile, ...tile.querySelectorAll('span')]) {
        if (getComputedStyle(el).display === 'inline') continue;
        if (el.scrollWidth > el.clientWidth + 0.5 || el.scrollHeight > el.clientHeight + 0.5)
          out.push(`${name}: "${el.textContent}" cut off`);
      }
    }
    if (document.documentElement.scrollWidth > window.innerWidth)
      out.push('the page scrolls sideways');
    return out;
  });
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

/** Every red, amber or green the status area draws outside its lamps (statusHues, app.mjs). */
const statusColours = (page) => statusHues(statusArea(page));

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
      test(`healthy, ${theme}: the quiet line, and no red, amber or green but small lamps`, async ({
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
        // The quiet line's lamp, then one per subsystem tile (#298): small, ok.
        expect(lamps, 'small ok lamps only').toEqual(
          [{ size: 10, state: 'ok' }].concat(
            CONFIGURED.healthy.map(() => ({ size: 10, state: 'ok' }))
          )
        );
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

    test('a modified or middle click on a row is the browser’s: a link, and the page stays put', async ({
      page,
    }) => {
      await openOverview(page, 'incident');
      const job = place(page, 'entity-jobs/storage:nightly-backup');
      const row = statusArea(page).getByRole('link', { name: /^nightly-backup, Failed/ });
      // What a new tab or window opens: the row's own address.
      await expect(row).toHaveAttribute('href', '#entity-jobs/storage:nightly-backup');

      const modified = {
        Ctrl: { ctrlKey: true },
        Meta: { metaKey: true },
        Shift: { shiftKey: true },
        Alt: { altKey: true },
        'the middle button': { button: 1 },
      };
      // The plain click last, the control: the same dispatch reaches the
      // row's handler, which moves to the place.
      const did = await clicksOn(row, { ...modified, plain: {} });
      for (const name of Object.keys(modified)) {
        expect(did[name], `${name}: left to the browser`).toEqual({
          prevented: false,
          moves: [],
          focused: false,
          scrolled: false,
        });
      }
      expect(did.plain.prevented, 'a plain click still follows the link').toBe(false);
      expect(did.plain.moves).toEqual(expect.arrayContaining(['focus', 'scrollIntoView']));
      await expect(job).toBeFocused();
    });

    for (const scenario of ['incident', 'healthy']) {
      test(`${scenario}: the subsystem strip is on screen under the status, nothing cut off`, async ({
        page,
      }) => {
        await openOverview(page, scenario);
        const tiles = strip(page).getByRole('button');
        await expect(tiles).toHaveCount(CONFIGURED[scenario].length);
        // The model's value and sub-line (#541); the sub-line drawn from 672px.
        await expect(tiles).toHaveText(
          CONFIGURED[scenario].map((s) => `${s.name}${s.value}${s.sub}`)
        );
        expect(await page.evaluate(() => window.scrollY)).toBe(0);

        const area = await clearArea(page);
        const status = statusArea(page).getByRole('region', {
          name: scenario === 'incident' ? 'Needs attention' : 'Status',
        });
        // On a phone the strip sits between the panel's header and its rows
        // (#484, e2e/phone-split.spec.mjs): under the header.
        const split = name === 'phone' && scenario === 'incident';
        const top = await (
          split ? status.locator('[data-slot="attention-panel-header"]') : status
        ).boundingBox();
        const box = await strip(page).boundingBox();
        expect(box.y, 'under the status').toBeGreaterThanOrEqual(top.y + top.height);
        expect(box.y + box.height, 'above the fold').toBeLessThanOrEqual(area.bottom);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(area.width);
        expect(await stripClipping(page)).toEqual([]);
      });
    }

    test('a tile filters the rows and the board to its subsystem, and back; Back and Forward follow', async ({
      page,
    }) => {
      await openOverview(page, 'incident');
      const panel = statusArea(page).getByRole('region', { name: 'Needs attention' });
      const rows = panel.locator('[data-slot="issue-row"]');
      await expect(rows).toHaveCount(2);

      await tile(page, 'Nodes').click();
      await expect(page).toHaveURL(/\/\?subsystem=nodes$/);
      await expect(tile(page, 'Nodes')).toHaveAttribute('aria-pressed', 'true');
      await expect(panel.getByText('Showing Nodes only')).toBeVisible();
      await expect(rows).toHaveCount(0);
      await expect(panel.getByText('Nothing in Nodes needs attention')).toBeVisible();
      await expect(panelTitle(page, 'App Server')).toBeVisible();
      for (const title of ['UPS Power', 'Scheduled Jobs', 'Quick Launch'])
        await expect(panelTitle(page, title)).toHaveCount(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);

      await tile(page, 'Nodes').click();
      await expect(page).toHaveURL(/\/$/);
      await expect(rows).toHaveCount(2);
      await expect(panelTitle(page, 'Scheduled Jobs')).toBeVisible();

      // Back to the filter, and Forward out of it.
      await page.goBack();
      await expect(tile(page, 'Nodes')).toHaveAttribute('aria-pressed', 'true');
      await expect(panelTitle(page, 'UPS Power')).toHaveCount(0);
      await page.goForward();
      await expect(tile(page, 'Nodes')).toHaveAttribute('aria-pressed', 'false');
      await expect(panelTitle(page, 'UPS Power')).toBeVisible();
    });

    test('by keyboard: the focus shows, Space filters, Enter clears', async ({ page }) => {
      await openOverview(page, 'incident');
      const backups = tile(page, 'Backups');
      await backups.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(backups).toBeFocused();
      const ring = await backups.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
      });
      expect(ring.style).not.toBe('none');
      expect(ring.width).toBeGreaterThanOrEqual(2);

      await page.keyboard.press('Space');
      await expect(backups).toHaveAttribute('aria-pressed', 'true');
      await expect(page).toHaveURL(/\?subsystem=backups$/);
      const panel = statusArea(page).getByRole('region', { name: 'Needs attention' });
      await expect(panel.locator('[data-slot="issue-row"]')).toHaveText([/nightly-backup/]);
      await expect(panelTitle(page, 'Scheduled Jobs')).toBeVisible();
      await expect(panelTitle(page, 'App Server')).toHaveCount(0);
      expect(
        await axeFindings(new AxeBuilder({ page }).include('[data-slot="overview-status"]')),
        'the filtered status'
      ).toEqual([]);

      await page.keyboard.press('Enter');
      await expect(backups).toHaveAttribute('aria-pressed', 'false');
      await expect(panelTitle(page, 'App Server')).toBeVisible();
    });

    test('a filter whose panel is switched off says so, and offers the whole board', async ({
      page,
    }) => {
      await openApp(page, '/?subsystem=jobs', { config: { showCronJobs: false } });
      const note = page.locator('[data-slot="board-filter-empty"]');
      await expect(note).toContainText('Scheduled Jobs is switched off');
      await expect(note).toContainText('Switch it on in Settings to see Jobs here.');
      await expect(tile(page, 'Jobs')).toHaveAttribute('aria-pressed', 'true');
      await expect(panelTitle(page, 'App Server')).toHaveCount(0);
      expect(
        await axeFindings(new AxeBuilder({ page }).include('[data-slot="board-filter-empty"]'))
      ).toEqual([]);
      await note.getByRole('button', { name: 'Show the whole board' }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(note).toHaveCount(0);
      await expect(panelTitle(page, 'App Server')).toBeVisible();
    });

    for (const theme of ['dark', 'light']) {
      for (const scenario of ['incident', 'healthy', 'filtered']) {
        test(`a screenshot for the PR: ${scenario}, ${theme}`, async ({ page }) => {
          const dir = join(test.info().project.outputDir, 'shots');
          mkdirSync(dir, { recursive: true });
          await openOverview(page, scenario === 'filtered' ? 'incident' : scenario, theme);
          if (scenario === 'filtered') {
            await tile(page, 'Services').click();
            await expect(tile(page, 'Services')).toHaveAttribute('aria-pressed', 'true');
            await page.mouse.move(0, 0);
          }
          await page.screenshot({ path: `${dir}/overview-${scenario}-${name}-${theme}.png` });
        });
      }
    }
  });
}

// The narrowest phone the strip is drawn for: tiles two to a row, nothing cut
// off, no sideways scroll.
test.describe('the subsystem strip at 360 × 780', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  for (const scenario of ['incident', 'healthy']) {
    test(`${scenario}: on screen under the status, nothing cut off`, async ({ page }) => {
      await openOverview(page, scenario);
      await expect(strip(page).getByRole('button')).toHaveCount(CONFIGURED[scenario].length);
      const area = await clearArea(page);
      const box = await strip(page).boundingBox();
      expect(box.y + box.height, 'above the fold').toBeLessThanOrEqual(area.bottom);
      expect(await stripClipping(page)).toEqual([]);
    });
  }
});
