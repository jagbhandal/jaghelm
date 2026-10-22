/*
 * The no-hiding guarantee (#302, spec §3 goal 3 and §8): the Overview at
 * every width from 360 to 2560px, in the demo's healthy and incident
 * scenarios, hides nothing.
 *
 *  - The sweep, at 360, 390, 768, 1024, 1280, 1440, 1920 and 2560px: the page
 *    doesn't scroll sideways (the document no wider than its window); no
 *    element clips its content (an element whose content overflows its box,
 *    on an axis it clips with `overflow: hidden` or `clip`), unless it is a
 *    deliberate ellipsis with the whole text in its `title` or its accessible
 *    name; no text spilling out of its box; and every service's and node's
 *    name is whole and inside the window. A failure names the element, the
 *    width and the scenario. Then the same at every width on the incident
 *    with the model's longest subsystem details, six tiles of them.
 *  - A tablet (768 and 1023px) is the desktop Overview in one column, the
 *    strip wrapping.
 *  - The layout doesn't jump as it loads (#243): at 390 × 844 on the
 *    incident, the cumulative layout shift of the first load, by a
 *    PerformanceObserver on `layout-shift` (shifts after input left out, as
 *    CLS does), is 0.1 or less. And on a phone (360 and 390px), every frame
 *    today's board paints, from its first, has it in the page's flow, every
 *    panel inside it and as tall as its content: none drawn at a saved
 *    height and then grown. At 1600px a tick that changes nothing measures
 *    no panel.
 *
 * Full-page screenshots of the sweep, for the PR, in test-results/e2e/shots/.
 *
 * Today's board under the sections (DashboardView's HelmGrid panels) is
 * checked for its panels' heights only: #306 deletes it (`oldBoard`, below).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { demo, openApp } from './app.mjs';

/** The widths of the sweep (spec §8): phones, a tablet, desktops, a 4K-wide window. */
const SWEEP = [360, 390, 768, 1024, 1280, 1440, 1920, 2560];
const heightAt = (width) => (width < 768 ? 844 : width >= 2560 ? 1440 : 900);
const SCENARIOS = ['healthy', 'incident'];

/** The names the Overview must show whole: each node's and each service's, from the model. */
const namesOf = (scenario) => {
  const { entities } = demo('/api/status', { scenario }).body;
  return {
    nodes: entities.filter((e) => e.kind === 'node').map((e) => e.name),
    services: entities.filter((e) => e.kind === 'service').map((e) => e.name),
  };
};

/** The Overview in `scenario`, every section and today's board drawn, fonts in. */
async function openOverview(page, scenario) {
  await openApp(page, '/', { scenario });
  const { nodes, services } = namesOf(scenario);
  await expect(
    page.locator('[data-slot="overview-status"]').getByRole('region').first()
  ).toBeVisible();
  await expect(page.locator('[data-slot="node-card"]')).toHaveCount(nodes.length);
  await expect(page.locator('[data-slot="services-section"] [data-slot="entity-row"]')).toHaveCount(
    services.length
  );
  await expect(page.locator('.helmgrid .section-title', { hasText: 'Network Edge' })).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Two frames: the board's last measure, and the layout after it.
    for (let i = 0; i < 2; i += 1) await new Promise((r) => requestAnimationFrame(r));
  });
}

/**
 * What the page hides at its width, one line each: the page scrolling
 * sideways, each element that clips its content, and each name (of `names`)
 * not drawn whole in the window. An element is named by its tag, data-slot,
 * id and classes, with its parents', and the start of its text.
 */
function hidden(page, names) {
  return page.evaluate((names) => {
    const out = [];
    const SLACK = 1; // scroll sizes are whole pixels: a rounding, not a cut
    const one = (el) => {
      const slot = el.dataset?.slot ? `[data-slot="${el.dataset.slot}"]` : '';
      const id = el.id ? `#${el.id}` : '';
      const classes = [...(el.classList ?? [])]
        .slice(0, 3)
        .map((c) => `.${c}`)
        .join('');
      return `${el.tagName.toLowerCase()}${slot}${id}${classes}`;
    };
    const where = (el) => {
      const path = [];
      for (let at = el; at && at !== document.body && path.length < 4; at = at.parentElement)
        path.unshift(one(at));
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${path.join(' > ')}${text ? ` "${text}"` : ''}`;
    };
    // Hidden from sight on purpose: screen-reader text, a handle shown on focus.
    const unseen = (el, cs) => {
      if (el.closest('.sr-only')) return true;
      if (cs.clipPath === 'inset(50%)' || (cs.clip !== 'auto' && cs.clip !== '')) return true;
      const box = el.getBoundingClientRect();
      return box.width <= 1 && box.height <= 1;
    };
    const drawn = (el, cs) =>
      cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
    // The whole text is still there to get at: in a title, or in an
    // accessible name (an aria-label, or a link's or button's own content,
    // which its name is made of when it has no label).
    const NAMED_BY_CONTENT = 'a[href], button, [role="link"], [role="button"], [role="tab"]';
    const told = (el) => {
      const text = el.textContent.trim();
      for (let at = el; at; at = at.parentElement) {
        if (at.title?.includes(text) || at.getAttribute('aria-label')?.includes(text)) return true;
        if (
          at.matches(NAMED_BY_CONTENT) &&
          !at.hasAttribute('aria-label') &&
          !at.hasAttribute('aria-labelledby')
        )
          return true;
      }
      return false;
    };

    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth)
      out.push(`the page scrolls sideways: ${doc.scrollWidth}px wide in ${doc.clientWidth}px`);

    for (const el of document.body.querySelectorAll('*')) {
      if (!(el instanceof HTMLElement)) continue;
      const cs = getComputedStyle(el);
      if (!drawn(el, cs) || unseen(el, cs)) continue;
      // Today's board (#306 deletes it): only its panels' heights are
      // checked, which are HelmGrid's (each as tall as its content). What its
      // old panels draw inside in width is left to #306: at 360 and 390px the
      // Pipeline's commit messages end in an ellipsis with no title, and the
      // Checklist's add row is wider than its card.
      const oldBoard = el.closest('.helmgrid-item') !== null;
      const clipsX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      const clipsY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
      if (!clipsX && !clipsY) {
        // Text that spills out of its box, where what is drawn beside it
        // covers it: a word wider than a strip's tile (#302).
        const spills =
          !oldBoard &&
          cs.overflowX === 'visible' &&
          !cs.display.startsWith('inline') &&
          [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) &&
          el.scrollWidth > el.clientWidth + SLACK;
        if (spills)
          out.push(`spills (${el.scrollWidth}px wide in ${el.clientWidth}px): ${where(el)}`);
        continue;
      }
      const wide = clipsX && !oldBoard && el.scrollWidth > el.clientWidth + SLACK;
      const tall = clipsY && el.scrollHeight > el.clientHeight + SLACK;
      if (!wide && !tall) continue;
      if (wide && !tall && cs.textOverflow === 'ellipsis' && told(el)) continue;
      const how = [
        wide && `${el.scrollWidth}px wide in ${el.clientWidth}px`,
        tall && `${el.scrollHeight}px tall in ${el.clientHeight}px`,
      ]
        .filter(Boolean)
        .join(', ');
      out.push(`clipped (${how}): ${where(el)}`);
    }

    // Each name, whole: not cut short, inside the window, and inside every
    // box around it that clips.
    const nameEls = [
      ...document.querySelectorAll(
        '[data-slot="services-section"] [data-slot="entity-name"], [data-slot="node-card"] h3'
      ),
    ];
    const shown = new Set(nameEls.map((el) => el.textContent.trim()));
    for (const name of names) if (!shown.has(name)) out.push(`the name "${name}" isn't drawn`);
    for (const el of nameEls) {
      const name = el.textContent.trim();
      const box = el.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth + SLACK) out.push(`"${name}" is cut short: ${where(el)}`);
      if (box.left < -0.5 || box.right > window.innerWidth + 0.5)
        out.push(`"${name}" is outside the window: ${where(el)}`);
      for (let at = el.parentElement; at && at !== document.body; at = at.parentElement) {
        const cs = getComputedStyle(at);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const frame = at.getBoundingClientRect();
        if (
          box.left < frame.left - 0.5 ||
          box.right > frame.right + 0.5 ||
          box.top < frame.top - 0.5 ||
          box.bottom > frame.bottom + 0.5
        ) {
          out.push(`"${name}" is cut by ${where(at)}`);
          break;
        }
      }
    }
    return out;
  }, names);
}

for (const scenario of SCENARIOS) {
  const { nodes, services } = namesOf(scenario);
  for (const width of SWEEP) {
    test(`${scenario} at ${width}px: no sideways scroll, nothing clipped, every name whole`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: heightAt(width) });
      await openOverview(page, scenario);
      const found = await hidden(page, [...nodes, ...services]);
      // The whole page, for the PR, before the check can stop the test.
      const dir = join(test.info().project.outputDir, 'shots');
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: `${dir}/reflow-${scenario}-${width}.png`, fullPage: true });
      expect(found, `at ${width}px, ${scenario}:\n  ${found.join('\n  ')}`).toEqual([]);
    });
  }
}

// The model's longest subsystem details (detailOf, server/status/summary.js)
// in all six tiles: the count, then "· 1 in maintenance" and "· 1 no signal",
// on the incident, with the integrations it lacks. A word as long as
// "maintenance" is wider than a tile when six share a row.
const LONG_DETAILS = (() => {
  const status = structuredClone(demo('/api/status').body);
  for (const s of status.subsystems) {
    if (s.id === 'integrations') {
      s.counts = { total: 12, ok: 10, warn: 0, crit: 0, unknown: 1, maintenance: 1 };
      s.detail = '10 / 12 answering';
    }
    if (s.id !== 'power') s.detail = `${s.detail} · 1 in maintenance · 1 no signal`;
  }
  return status;
})();

test('the longest subsystem details, at every width: nothing clipped', async ({ page }) => {
  const { nodes, services } = namesOf('incident');
  await page.setViewportSize({ width: SWEEP[0], height: heightAt(SWEEP[0]) });
  await openApp(page, '/', { scenario: 'incident', answers: { '/api/status': LONG_DETAILS } });
  await expect(page.getByRole('region', { name: 'Subsystems' })).toContainText('1 in maintenance');
  const found = [];
  for (const width of SWEEP) {
    await page.setViewportSize({ width, height: heightAt(width) });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r))));
    found.push(...(await hidden(page, [...nodes, ...services])).map((f) => `${width}px: ${f}`));
  }
  expect(found, found.join('\n')).toEqual([]);
});

// A tablet (768–1023px, spec §8): the desktop Overview in one column, the
// subsystem strip wrapping to its width. 768 is PHONE_WIDTH's edge (the
// sidebar's first width); 1023 the last before the desktop's.
const SECTIONS = [
  '[data-slot="overview-status"]',
  '[data-slot="overview-infrastructure"]',
  '[data-slot="overview-services"]',
  '.helmgrid',
];
for (const width of [768, 1023]) {
  test(`a tablet at ${width}px: the Overview in one column, the strip wrapping`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1024 });
    await openOverview(page, 'incident');
    await expect(page.locator('[data-slot="side-nav"]')).toBeVisible();
    await expect(page.locator('.overview-rail')).toHaveCount(0);
    const boxes = [];
    for (const selector of SECTIONS) boxes.push(await page.locator(selector).boundingBox());
    // Each section under the one before, none beside another.
    for (let i = 1; i < boxes.length; i += 1)
      expect(boxes[i].y, `${SECTIONS[i]} under ${SECTIONS[i - 1]}`).toBeGreaterThanOrEqual(
        boxes[i - 1].y + boxes[i - 1].height - 0.5
      );
    // The strip's tiles fill its rows, as many to a row as fit.
    const strip = page.getByRole('region', { name: 'Subsystems' });
    const tiles = await strip
      .locator('[data-slot="subsystem-tile"]')
      .evaluateAll((all) => all.map((el) => Math.round(el.getBoundingClientRect().top)));
    const rows = new Set(tiles).size;
    const frame = await strip.boundingBox();
    expect(rows, `${tiles.length} tiles in ${Math.round(frame.width)}px`).toBe(
      frame.width >= 672 ? 1 : 2
    );
  });
}

/**
 * The layout shifts of the page's first load, as the browser reports them
 * (`layout-shift` entries, buffered from the start), recorded from before the
 * app's first script: each one's value, whether input came just before it,
 * its time, and what moved.
 */
async function recordShifts(page) {
  await page.addInitScript(() => {
    window.__shifts = [];
    const one = (node) => {
      if (!(node instanceof Element)) return node?.nodeName ?? '?';
      const slot = node.getAttribute('data-slot');
      return `${node.tagName.toLowerCase()}${slot ? `[data-slot="${slot}"]` : ''}${[
        ...node.classList,
      ]
        .slice(0, 2)
        .map((c) => `.${c}`)
        .join('')}`;
    };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__shifts.push({
          value: e.value,
          input: e.hadRecentInput,
          at: Math.round(e.startTime),
          moved: (e.sources ?? []).map(
            (s) =>
              `${one(s.node)} ${Math.round(s.previousRect.y)}→${Math.round(s.currentRect.y)}` +
              ` (${Math.round(s.previousRect.height)}→${Math.round(s.currentRect.height)} tall)`
          ),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

/**
 * CLS from the shifts: the largest session window (shifts less than 1 s
 * apart, the window at most 5 s), leaving out shifts after input, as the
 * browser's own Web Vitals measure it.
 */
function cls(shifts) {
  let worst = 0;
  let sum = 0;
  let first = null;
  let last = null;
  for (const s of shifts.filter((s) => !s.input)) {
    if (first == null || s.at - last >= 1000 || s.at - first >= 5000) {
      first = s.at;
      sum = 0;
    }
    sum += s.value;
    last = s.at;
    worst = Math.max(worst, sum);
  }
  return worst;
}

test('the first load at 390 × 844, incident: CLS 0.1 or less (#243)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await recordShifts(page);
  await openOverview(page, 'incident');
  // The load's last shift has had time to land: a second of quiet.
  await page.waitForTimeout(1000);
  const shifts = await page.evaluate(() => window.__shifts);
  const score = cls(shifts);
  test.info().annotations.push({ type: 'CLS at 390px, incident', description: score.toFixed(4) });
  console.log(`CLS at 390px, incident: ${score.toFixed(4)}`);
  expect(
    score,
    `CLS ${score.toFixed(3)}; the shifts:\n  ${shifts
      .map(
        (s) => `${s.at} ms ${s.value.toFixed(4)}${s.input ? ' (input)' : ''}: ${s.moved.join(', ')}`
      )
      .join('\n  ')}`
  ).toBeLessThanOrEqual(0.1);
});

/**
 * Each frame today's board paints, from the page's start: sampled in
 * requestAnimationFrame, just before the paint, while it has panels, until
 * `frames` frames have had them. For each: whether the board is in the page's
 * flow, and, by title, each panel outside the board's box or shorter than
 * its content (its card clipping it).
 */
async function recordBoardFrames(page, frames = 30) {
  await page.addInitScript((frames) => {
    window.__boardFrames = [];
    const title = (el) => el.querySelector('.section-title')?.textContent ?? el.className;
    const sample = () => {
      const board = document.querySelector('.helmgrid');
      const items = board ? [...board.querySelectorAll(':scope > .helmgrid-item')] : [];
      if (items.length) {
        const frame = board.getBoundingClientRect();
        window.__boardFrames.push({
          flow: board.classList.contains('helmgrid-flow'),
          outside: items
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return box.left < frame.left - 0.5 || box.right > frame.right + 0.5;
            })
            .map(title),
          cut: items
            .filter((el) => {
              const card = el.querySelector('.glass-card');
              return card && card.scrollHeight > card.clientHeight + 1;
            })
            .map(title),
        });
      }
      if (window.__boardFrames.length < frames) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, frames);
}

for (const width of [360, 390]) {
  test(`at ${width}px today's board is one column in the page's flow from its first frame, every panel whole (#243)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: heightAt(width) });
    await recordBoardFrames(page);
    await openOverview(page, 'incident');
    await expect.poll(() => page.evaluate(() => window.__boardFrames.length)).toBe(30);
    const frames = await page.evaluate(() => window.__boardFrames);
    const wrong = frames.filter((f) => !f.flow || f.outside.length || f.cut.length);
    expect(wrong, `${wrong.length} of ${frames.length} frames`).toEqual([]);
  });
}

// A wide board is laid out by HelmGrid, which measures a panel's content (a
// forced layout) only when its size can have changed: a tick whose answers
// change nothing measures none (#243 counted ~57 forced layouts a tick).
test("at 1600px a tick that changes nothing measures none of today's panels (#243)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(() => {
    window.__measures = 0;
    const real = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
    Object.defineProperty(Element.prototype, 'scrollHeight', {
      get() {
        if (this.classList?.contains('helmgrid-item')) window.__measures += 1;
        return real.get.call(this);
      },
    });
  });
  // A tick every 2 s: the board asks again, and gets the same answers.
  await openApp(page, '/', { scenario: 'incident', config: { refreshInterval: 2 } });
  await expect(page.locator('.helmgrid .section-title', { hasText: 'Network Edge' })).toBeVisible();
  await expect(page.locator('.helmgrid:not(.helmgrid-flow)')).toBeVisible();
  await page.waitForTimeout(1500);
  const settled = await page.evaluate(() => window.__measures);
  expect(settled, 'the panels measured as they loaded').toBeGreaterThan(0);
  await page.waitForRequest('**/api/services');
  await page.waitForRequest('**/api/services');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__measures)).toBe(settled);
});
