/*
 * The no-hiding guarantee (#302, spec §3 goal 3 and §8): the Overview at
 * every width from 360 to 2560px, in the demo's healthy and incident
 * scenarios, hides nothing: below 768px the phone's (#303), from 768px the
 * desktop's.
 *
 *  - The sweep, at 360, 390, 768, 1024, 1280, 1440, 1920 and 2560px: the page
 *    doesn't scroll sideways (the document no wider than its window); no
 *    element clips its content (an element whose content overflows its box,
 *    on an axis it clips with `overflow: hidden` or `clip`), unless it is a
 *    deliberate ellipsis with the whole text in its `title` or its accessible
 *    name, and at least 64px of it drawn (#303); no text spilling out of its
 *    box; and every service's and node's name is whole and inside the
 *    window. A failure names the element, the width and the scenario. Then
 *    the same at every width on the incident with the model's longest
 *    subsystem sub-lines, six tiles of them.
 *  - Each status fixture's strip at 1024, 1280, 1440 and 1460px, in each
 *    typeface (#541): every tile's value and sub-line the model's, whole (no
 *    word cut, nothing clipped or ending in an ellipsis), the value on one
 *    line; and six tiles in one row from 816px of strip, never 5 + 1, with
 *    room there for every value the model gives a tile.
 *  - A tablet (768 and 1023px) is the desktop Overview in one column, the
 *    strip wrapping.
 *  - The layout doesn't jump as it loads (#243): at 390 × 844 on the
 *    incident, the cumulative layout shift of the first load, by a
 *    PerformanceObserver on `layout-shift` (shifts after input left out, as
 *    CLS does), is 0.1 or less. (Today's board isn't drawn below 768px any
 *    more, #303, so its one-column flow on a phone has no frames to check.)
 *    At 1600px a tick that changes nothing measures no panel, and a panel
 *    keeps its last height until the slowest source has answered, then takes
 *    its own once.
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
import { runScenario, STATUS_SCENARIOS } from '../server/testing/statusScenarios.js';
import { TYPEFACES } from '../src/ui/typefaces.js';

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

/** The phone screens' Overview (#303), below 768px. */
const PHONE = '[data-slot="phone-view"]';

/**
 * The Overview in `scenario` drawn whole at the window's width: below 768px
 * the phone's (#303), its lists of services and nodes; from 768px every
 * section and today's board.
 */
async function drawn(page, scenario) {
  const { nodes, services } = namesOf(scenario);
  if (page.viewportSize().width < 768) {
    const cards = Object.values(demo('/api/services', { scenario }).body.nodes).flatMap(
      (n) => n.services
    );
    await expect(page.locator(`${PHONE} [data-slot="attention-panel"]`)).toBeVisible();
    await expect(page.locator(`${PHONE} [data-slot="entity-row"]`)).toHaveCount(
      cards.length + nodes.length
    );
  } else {
    await expect(
      page.locator('[data-slot="overview-status"]').getByRole('region').first()
    ).toBeVisible();
    await expect(page.locator('[data-slot="node-card"]')).toHaveCount(nodes.length);
    await expect(
      page.locator('[data-slot="services-section"] [data-slot="entity-row"]')
    ).toHaveCount(services.length);
    await expect(
      page.locator('.helmgrid .section-title', { hasText: 'Network Edge' })
    ).toBeVisible();
  }
}

/** The Overview in `scenario`, every section (and from 768px today's board) drawn, fonts in. */
async function openOverview(page, scenario) {
  await openApp(page, '/', { scenario });
  await drawn(page, scenario);
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
    // which its name is made of when it has no label). And enough of it is
    // drawn to read before the ellipsis: a label squeezed to a few letters
    // (the header's sentence beside the lamp on a phone, #303) is hidden,
    // whatever its name says.
    const NAMED_BY_CONTENT = 'a[href], button, [role="link"], [role="button"], [role="tab"]';
    const MIN_TOLD = 64; // px of text drawn before the ellipsis
    const told = (el) => {
      if (el.clientWidth < MIN_TOLD) return false;
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
        '[data-slot="services-section"] [data-slot="entity-name"], [data-slot="node-card"] h3, ' +
          '[data-slot="phone-view"] [data-slot="entity-name"]'
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

// The model's longest subsystem sub-lines (tileOf, server/status/summary.js,
// #541) in all six tiles: the word, then "· 1 in maintenance" and "· 1 no
// signal", on the incident, with the integrations it lacks, and the UPS's
// longest word as its value. A word as long as "maintenance" is most of a
// tile's line when six share a row.
const LONG_DETAILS = (() => {
  const status = structuredClone(demo('/api/status').body);
  for (const s of status.subsystems) {
    if (s.id === 'integrations') {
      s.counts = { total: 12, ok: 10, warn: 0, crit: 0, unknown: 1, maintenance: 1 };
      Object.assign(s, { detail: '10 / 12 OK', value: '10 / 12', sub: 'OK' });
    }
    if (s.id === 'power') Object.assign(s, { value: 'Low battery', sub: '9 % charge' });
    else {
      s.detail = `${s.detail} · 1 in maintenance · 1 no signal`;
      s.sub = `${s.sub} · 1 in maintenance · 1 no signal`;
    }
  }
  return status;
})();

test('the longest subsystem sub-lines, at every width: nothing clipped', async ({ page }) => {
  const { nodes, services } = namesOf('incident');
  await page.setViewportSize({ width: SWEEP[0], height: heightAt(SWEEP[0]) });
  await openApp(page, '/', { scenario: 'incident', answers: { '/api/status': LONG_DETAILS } });
  await expect(page.getByRole('region', { name: 'Subsystems' })).toContainText('1 in maintenance');
  const found = [];
  for (const width of SWEEP) {
    await page.setViewportSize({ width, height: heightAt(width) });
    // Across 768px the page is drawn anew: the phone's screens or the desktop's (#303).
    await drawn(page, 'incident');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r))));
    found.push(...(await hidden(page, [...nodes, ...services])).map((f) => `${width}px: ${f}`));
  }
  expect(found, found.join('\n')).toEqual([]);
});

// Each status fixture's subsystem tiles at the desktop widths (#541), in each
// typeface (src/ui/typefaces.js): the model's value and sub-line drawn as
// they are, and whole. No word or number is cut in two (a word wider than its
// line spills, which the check finds), nothing clips or ends in an ellipsis,
// and the value keeps to one line, so "31 / 32" never breaks at its spaces.
// 1460px is past the page's split into two columns (#544), where the strip is
// narrower than at 1440. A strip too narrow for six in a row has them in two
// rows of three, never 5 + 1.
const FIT = [1024, 1280, 1440, 1460];

/**
 * Draws the page in `face` (its `data-typeface` on every root, a root drawn
 * since included), its file loaded, and checks the strip's values use it.
 */
async function useTypeface(page, { id, family }) {
  const loaded = await page.evaluate(
    async ({ id, family }) => {
      for (const root of document.querySelectorAll('.jh-ui'))
        root.setAttribute('data-typeface', id);
      await document.fonts.load(`700 16px "${family}"`);
      await document.fonts.load(`400 12px "${family}"`);
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
      // A tile's value, or the root's text on a board with no tiles.
      const text =
        document.querySelector('[data-slot="subsystem-value"]') ?? document.querySelector('.jh-ui');
      return (
        document.fonts.check(`700 16px "${family}"`) &&
        getComputedStyle(text).fontFamily.startsWith(`"${family}"`)
      );
    },
    { id, family }
  );
  expect(loaded, `${family} drawn`).toBe(true);
}

/**
 * The low-battery board with integrations set up too (#541): six tiles share
 * the row with the widest value the model gives, "Low battery", and its
 * longest sub-line, "1 with a refused login · 1 in maintenance · 1 no
 * signal".
 */
function lowBatterySix() {
  const board = runScenario('low-battery', { now: Date.now() });
  Object.assign(
    board.status.subsystems.find((s) => s.id === 'integrations'),
    {
      state: 'warn',
      counts: { total: 3, ok: 0, warn: 1, crit: 0, unknown: 1, maintenance: 1 },
      detail: '0 / 3 OK · 1 in maintenance · 1 no signal',
      value: '0 / 3',
      sub: '1 with a refused login · 1 in maintenance · 1 no signal',
    }
  );
  return board;
}

/** Opens the Overview on `board` (a fixture's status and cards), its strip drawn. */
async function openBoard(page, { status, cycle }, width) {
  await page.setViewportSize({ width, height: 900 });
  await openApp(page, '/', {
    scenario: 'incident',
    answers: { '/api/status': status, '/api/services': cycle.caches.getCached('services') },
  });
  await expect(
    page.locator('[data-slot="overview-status"]').getByRole('region').first()
  ).toBeVisible();
  const tiles = page.locator('[data-slot="subsystem-tile"]');
  await expect(tiles).toHaveCount(status.subsystems.filter((s) => s.counts.total > 0).length);
  return tiles;
}

const FIT_FIXTURES = [
  ...STATUS_SCENARIOS.map((name) => [name, () => runScenario(name, { now: Date.now() })]),
  ['low-battery, six tiles', lowBatterySix],
];
for (const [name, build] of FIT_FIXTURES) {
  test(`${name}: each tile's value and sub-line whole at ${FIT.join(', ')}px, in each typeface (#541)`, async ({
    page,
  }) => {
    const board = build();
    const shown = board.status.subsystems.filter((s) => s.counts.total > 0);
    const tiles = await openBoard(page, board, FIT[0]);
    const found = [];
    for (const face of TYPEFACES) {
      for (const width of FIT) {
        await page.setViewportSize({ width, height: 900 });
        await useTypeface(page, face);
        const drawn = await tiles.evaluateAll((all) =>
          all.map((tile) => {
            const read = (slot) => {
              const el = tile.querySelector(`[data-slot="${slot}"]`);
              if (!el) return null;
              const cs = getComputedStyle(el);
              const range = document.createRange();
              range.selectNodeContents(el);
              const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
              // Each word's own boxes: one line each, inside the tile's content box.
              const box = tile.getBoundingClientRect();
              const right = box.right - parseFloat(getComputedStyle(tile).paddingRight) + 0.5;
              const text = el.textContent;
              const cut = [];
              for (const m of text.matchAll(/\S+/g)) {
                const r = document.createRange();
                r.setStart(el.firstChild, m.index);
                r.setEnd(el.firstChild, m.index + m[0].length);
                const rects = [...r.getClientRects()];
                const tops = new Set(rects.map((x) => Math.round(x.top)));
                if (tops.size > 1 || rects.some((x) => x.right > right)) cut.push(m[0]);
              }
              return {
                text,
                lines,
                cut,
                shown: cs.display !== 'none',
                wrap: `${cs.overflowWrap} ${cs.wordBreak}`,
                clips: cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis',
                spills: el.scrollWidth > el.clientWidth + 1,
              };
            };
            return {
              width: Math.round(tile.getBoundingClientRect().width),
              top: Math.round(tile.getBoundingClientRect().top),
              value: read('subsystem-value'),
              sub: read('subsystem-sub'),
            };
          })
        );
        const tops = drawn.map((d) => d.top);
        const perRow = [...new Set(tops)].map((top) => tops.filter((t) => t === top).length);
        const at0 = `${face.label}, ${width}px`;
        if (shown.length === 6 && !['6', '3,3'].includes(perRow.join(',')))
          found.push(`${at0}: six tiles in rows of ${perRow.join(' + ')}`);
        shown.forEach((s, i) => {
          const d = drawn[i];
          const at = `${at0}, ${s.id}`;
          if (d.value?.text !== s.value)
            found.push(`${at}: value "${d.value?.text}", the model's "${s.value}"`);
          if (s.sub && d.sub?.text !== s.sub)
            found.push(`${at}: sub "${d.sub?.text}", the model's "${s.sub}"`);
          if (s.sub && !d.sub?.shown) found.push(`${at}: sub "${s.sub}" not shown`);
          for (const [line, r] of [
            ['value', d.value],
            ['sub', d.sub],
          ]) {
            if (!r) continue;
            if (r.wrap !== 'normal normal')
              found.push(`${at}: the ${line} breaks words (${r.wrap})`);
            if (r.clips) found.push(`${at}: the ${line} clips or ends in an ellipsis`);
            if (r.spills) found.push(`${at}: the ${line} "${r.text}" spills out of its tile`);
            if (r.cut.length)
              found.push(`${at}: the ${line} cuts ${r.cut.map((w) => `"${w}"`).join(', ')}`);
          }
          if (d.value && d.value.lines > 1)
            found.push(`${at}: the value "${s.value}" takes ${d.value.lines} lines`);
        });
        test.info().annotations.push({
          type: at0,
          description: `${shown.length} tiles in rows of ${perRow.join(' + ')}, ${drawn[0]?.width}px each`,
        });
      }
    }
    expect(found, found.join('\n')).toEqual([]);
  });
}

// Where six tiles share a row (#541, subsystem-strip.jsx `columns`): from
// 816px of the strip's own width. A row's tiles are one width, so six tiles
// that carry every value the model gives a tile, one each (counts to "888 /
// 888", the UPS's "Low battery", "On battery", "On mains" and "No signal"),
// prove it for all of them: at each strip width from 672px (the wide tile) to
// 1200px, in each typeface, the six sit in one row or in two of three, never
// 5 + 1; in one row from 816px and not below; and there every value keeps to
// one line inside its tile.
const VOCABULARY = ['888 / 888', '12 / 12', 'Low battery', 'On battery', 'On mains', 'No signal'];
const SIX_IN_A_ROW = 816;
test('six tiles share a row from 816px of strip, with room for every value in each typeface (#541)', async ({
  page,
}) => {
  const board = lowBatterySix();
  board.status.subsystems.forEach((s, i) => Object.assign(s, { value: VOCABULARY[i] }));
  await openBoard(page, board, 1280);
  const found = [];
  for (const face of TYPEFACES) {
    await useTypeface(page, face);
    const { problems, firstOneRow } = await page.evaluate(
      ({ from, to }) => {
        const strip = document.querySelector('[data-slot="subsystem-strip"]');
        const wrapper = strip.parentElement;
        const problems = [];
        let firstOneRow = null;
        for (let w = from; w <= to; w++) {
          wrapper.style.width = `${w}px`;
          const tiles = [...strip.querySelectorAll('[data-slot="subsystem-tile"]')];
          const tops = tiles.map((t) => Math.round(t.getBoundingClientRect().top));
          const perRow = [...new Set(tops)].map((top) => tops.filter((x) => x === top).length);
          const rows = perRow.join(',');
          if (rows !== '6' && rows !== '3,3')
            problems.push(`${w}px: rows of ${perRow.join(' + ')}`);
          if (rows !== '6') continue;
          firstOneRow ??= w;
          for (const tile of tiles) {
            const value = tile.querySelector('[data-slot="subsystem-value"]');
            const range = document.createRange();
            range.selectNodeContents(value);
            const rects = [...range.getClientRects()];
            const right =
              tile.getBoundingClientRect().right - parseFloat(getComputedStyle(tile).paddingRight);
            if (new Set(rects.map((r) => Math.round(r.top))).size > 1)
              problems.push(`${w}px: "${value.textContent}" takes two lines`);
            else if (rects.some((r) => r.right > right + 0.5))
              problems.push(`${w}px: "${value.textContent}" runs past its tile`);
          }
        }
        wrapper.style.width = '';
        return { problems, firstOneRow };
      },
      { from: 672, to: 1200 }
    );
    if (firstOneRow !== SIX_IN_A_ROW)
      found.push(`${face.label}: one row from ${firstOneRow}px, not ${SIX_IN_A_ROW}px`);
    found.push(...problems.map((p) => `${face.label}, ${p}`));
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

// While the board's data comes in, each panel keeps the height it had last
// time (HelmGrid's `reserve`, #302): however long a source takes, no panel
// shrinks before every source has answered, and then it takes its own height
// in one step.
test('at 1600px a panel keeps its last height until every source has answered, then takes its own once', async ({
  page,
}) => {
  const HEIGHTS = 'jaghelm-grid-heights'; // HEIGHTS_PREF, HelmGrid.jsx
  await page.setViewportSize({ width: 1600, height: 900 });
  await openApp(page, '/', { scenario: 'incident' });
  await expect(page.locator('.helmgrid .section-title', { hasText: 'Network Edge' })).toBeVisible();
  // The heights this visit kept; the Network Edge panel's made 200px taller,
  // as if it had held more last time.
  await expect
    .poll(() => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), HEIGHTS))
    .toHaveProperty('node-edge');
  await page.evaluate((k) => {
    const kept = JSON.parse(localStorage.getItem(k));
    kept['node-edge'][1] += 200;
    localStorage.setItem(k, JSON.stringify(kept));
  }, HEIGHTS);

  // The panel's height in every frame from the reload on, on the page's clock.
  await page.addInitScript(() => {
    window.__heights = [];
    const sample = () => {
      const el = [...document.querySelectorAll('.helmgrid-item')].find(
        (e) => e.querySelector('.section-title')?.textContent === 'Network Edge'
      );
      if (el)
        window.__heights.push({
          at: performance.timeOrigin + performance.now(),
          h: Math.round(el.getBoundingClientRect().height),
        });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  // Scheduled Jobs answers after 4 s, the last source to.
  let answeredAt = null;
  await page.route('**/api/cron/status', async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    answeredAt = Date.now();
    await route.fallback();
  });
  await page.reload();
  await page.waitForResponse('**/api/cron/status', { timeout: 15_000 });
  await page.waitForTimeout(500);

  const frames = await page.evaluate(() => window.__heights);
  const steps = frames.filter((f, i) => i === 0 || f.h !== frames[i - 1].h);
  expect(steps.length, `heights: ${steps.map((s) => s.h).join(' → ')}`).toBe(2);
  const [kept, own] = steps;
  expect(kept.h).toBeGreaterThan(own.h);
  expect(own.at, 'took its own height only once the last source answered').toBeGreaterThanOrEqual(
    answeredAt
  );
});
