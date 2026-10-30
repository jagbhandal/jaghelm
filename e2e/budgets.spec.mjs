/*
 * Spec §4's budgets on the built app, in a real browser (#306), beside the
 * first load's (scripts/first-load.mjs, CI's gate, and e2e/first-load.spec.mjs)
 * and the CLS at 390px (e2e/reflow.spec.mjs):
 *
 *  - Fonts (#391, #403): the default setup fetches at most 60 KB of faces, at
 *    1440 and at 390px, and no face of the old screens (Outfit, DM Sans, nor
 *    any Typography preset's) at all. For the default face and each other
 *    `data-typeface`: a latin-only page fetches no latin-ext file; "Łódź" on
 *    the page fetches exactly the active face's latin-ext file, and in mono
 *    text JetBrains Mono's too.
 *  - Requests (#237, #306): on the Overview at 1440px, the rail's Pipeline
 *    and weather drawn, a tick costs a tab at most 4 requests (the status,
 *    services and integrations, and history, the Pipeline or the weather in
 *    turn), and a hidden tab asks nothing at all. Ticks every 2 s here, so a
 *    run is short; the schedule is the same at any interval
 *    (src/shell/tickBudget.js). The weather's 10 minutes don't pass in a run:
 *    src/App.polling.test.jsx follows it over 45 ticks.
 *  - The Monitoring page's one extra request (#751, tickBudget.js): its route
 *    is hidden while its charts arrive, so here a visit to /monitoring lands
 *    on the Overview and asks /api/monitoring nothing; the card that unhides
 *    the route adds the open page's per-tick count beside it
 *    (src/App.polling.test.jsx counts it now, with the route shown).
 */
import { test, expect } from '@playwright/test';
import { WIDTHS, openApp } from './app.mjs';
import { BUDGETS } from '../scripts/first-load.mjs';
import { DEFAULT_TYPEFACE, MONO_TYPEFACE, TYPEFACES } from '../src/ui/typefaces.js';

/** The slow reads a tick takes in turn (tickBudget.js). */
const SLOW = ['/api/history', '/api/gitea/activity', '/api/weather'];

/** The faces of the old screens' presets (src/styles/fonts.css, and the board's, #306). */
const LEGACY =
  /^(outfit|dm-sans|inter|fira-code|nunito|source-code-pro|rajdhani|roboto|roboto-mono)-/;

/** A built font's file name, its hash left out: /assets/manrope-latin-wght-AbC12345.woff2 → manrope-latin-wght.woff2. */
const fileOf = (url) =>
  new URL(url).pathname
    .split('/')
    .pop()
    .replace(/-[\w-]{8}(\.woff2)$/, '$1');

/** Every font the page fetches from now on: [{ file, bytes }], as they arrive. */
function recordFonts(page) {
  const fonts = [];
  page.on('response', async (response) => {
    if (!/\.woff2$/.test(new URL(response.url()).pathname)) return;
    const body = await response.body().catch(() => null);
    fonts.push({ file: fileOf(response.url()), bytes: body?.length ?? 0 });
  });
  return fonts;
}

/** The page settled: no request out, its fonts in, two frames drawn. */
async function settled(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let i = 0; i < 2; i += 1) await new Promise((r) => requestAnimationFrame(r));
  });
}

test.describe('fonts on the built app', () => {
  for (const [name, viewport] of Object.entries(WIDTHS)) {
    test(`the default setup at ${viewport.width}px: at most 60 KB of faces, none of the old screens'`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const fonts = recordFonts(page);
      await openApp(page);
      await expect(
        page.locator(name === 'phone' ? '[data-slot="phone-view"]' : '[data-slot="overview-board"]')
      ).toBeVisible();
      await settled(page);
      const files = fonts.map((f) => f.file).sort();
      expect(files).toEqual(
        [TYPEFACES.find((t) => t.id === DEFAULT_TYPEFACE).file, MONO_TYPEFACE.file].sort()
      );
      expect(files.filter((f) => LEGACY.test(f))).toEqual([]);
      const bytes = fonts.reduce((sum, f) => sum + f.bytes, 0);
      expect(bytes, `${bytes} bytes of faces`).toBeLessThanOrEqual(BUDGETS.fonts);
    });
  }

  for (const face of TYPEFACES) {
    test(`${face.label}: latin text fetches no latin-ext file; "Łódź" fetches its own, and JetBrains Mono's in mono`, async ({
      page,
    }) => {
      // The face on every new-UI root from its first frame, as Settings will
      // set it (#321); the default has no attribute.
      if (face.id !== DEFAULT_TYPEFACE) {
        await page.addInitScript((id) => {
          const mark = (root) =>
            root.querySelectorAll?.('.jh-ui').forEach((el) => el.setAttribute('data-typeface', id));
          new MutationObserver((changes) => {
            for (const c of changes)
              for (const n of c.addedNodes) {
                if (n.nodeType !== 1) continue;
                if (n.classList.contains('jh-ui')) n.setAttribute('data-typeface', id);
                mark(n);
              }
          }).observe(document, { childList: true, subtree: true });
        }, face.id);
      }
      const fonts = recordFonts(page);
      await openApp(page);
      await expect(page.locator('[data-slot="overview-board"]')).toBeVisible();
      await settled(page);
      const ext = () => fonts.map((f) => f.file).filter((f) => f.includes('-latin-ext-'));
      expect(fonts.map((f) => f.file)).toContain(face.file);
      expect(ext(), 'a latin-only page').toEqual([]);

      // "Łódź" in the sans text of a new-UI root, then in its mono text.
      const write = (family) =>
        page.evaluate((family) => {
          const root = document.querySelector('[data-slot="overview-board"] .jh-ui');
          const p = document.createElement('p');
          p.textContent = 'Łódź';
          p.style.fontFamily = `var(${family})`;
          root.append(p);
        }, family);
      await write('--jh-font-sans');
      await expect.poll(ext).toEqual([face.latinExtFile]);
      await write('--jh-font-mono');
      await expect
        .poll(() => ext().sort())
        .toEqual([face.latinExtFile, MONO_TYPEFACE.latinExtFile].sort());
      await settled(page);
      expect(ext().sort()).toEqual([face.latinExtFile, MONO_TYPEFACE.latinExtFile].sort());
    });
  }
});

test.describe('requests per tick', () => {
  test.use({ viewport: WIDTHS.desktop });

  /** Every /api request from now on: [{ path, at }]. */
  function recordApi(page) {
    const asked = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) asked.push({ path: url.pathname, at: Date.now() });
    });
    return asked;
  }

  test('at most 4 a tick, the rail’s Pipeline and weather counted; none while the tab is hidden', async ({
    page,
  }) => {
    const asked = recordApi(page);
    // A tick every 2 s (Settings → Layout's interval, as the display config
    // keeps it), and the weather on, in Toronto.
    await openApp(page, '/', {
      config: { refreshInterval: 2, showWeather: true, weatherLat: '43.65', weatherLon: '-79.38' },
      answers: { '/api/weather': { current: { temperature_2m: 48.2, weather_code: 3 } } },
    });
    await expect(page.getByRole('region', { name: 'Utilities' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Pipeline' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Weather and time' })).toContainText('°F');
    await settled(page);
    // The load is no tick: from the next /api/services on.
    await page.waitForTimeout(500);
    asked.length = 0;
    await page.waitForTimeout(13_000);
    const run = asked.splice(0);

    // A tick runs from one /api/services to the next.
    const starts = run.filter((r) => r.path === '/api/services').map((r) => r.at);
    expect(starts.length, 'ticks seen').toBeGreaterThanOrEqual(5);
    const ticks = starts
      .slice(0, -1)
      .map((from, i) => run.filter((r) => r.at >= from && r.at < starts[i + 1]).map((r) => r.path));
    for (const tick of ticks) {
      const board = tick.filter((p) => p !== '/api/status');
      // services and integrations, and one slow read at most.
      expect(board.length, tick.join(', ')).toBeLessThanOrEqual(3);
      expect(board.filter((p) => SLOW.includes(p)).length, tick.join(', ')).toBeLessThanOrEqual(1);
    }
    // The status once a tick, on its own clock beside the board's: over the
    // run, at most one more than the ticks.
    const statuses = run.filter((r) => r.path === '/api/status').length;
    expect(statuses).toBeLessThanOrEqual(ticks.length + 2);
    expect(run.length, run.map((r) => r.path).join(', ')).toBeLessThanOrEqual(
      4 * (ticks.length + 1)
    );
    // The slow ones still come, each in its turn.
    for (const path of ['/api/history', '/api/gitea/activity'])
      expect(
        run.some((r) => r.path === path),
        path
      ).toBe(true);
    // What the old board read is never asked (#306).
    for (const path of ['/api/ups', '/api/cron/status'])
      expect(
        run.some((r) => r.path === path),
        path
      ).toBe(false);

    // Hidden: nothing at all, over three ticks.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);
    asked.length = 0;
    await page.waitForTimeout(6_500);
    expect(asked.map((r) => r.path)).toEqual([]);
  });

  test('the Monitoring page is hidden for now: /monitoring lands on the Overview and asks nothing (#751)', async ({
    page,
  }) => {
    const asked = recordApi(page);
    await openApp(page, '/monitoring', { config: { refreshInterval: 2 } });
    await expect(page.locator('[data-slot="overview-board"]')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Monitoring/ })
    ).toHaveCount(0);
    await settled(page);
    await page.waitForTimeout(5_000);
    expect(asked.filter((r) => r.path === '/api/monitoring')).toEqual([]);
  });
});
