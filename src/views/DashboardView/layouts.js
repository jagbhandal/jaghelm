/**
 * Dashboard layout defaults and migration helpers.
 *
 * `defaultLayouts` builds the grid a board without a saved layout gets, from
 * the nodes it has. `migrateLayouts` updates legacy layout keys (renamed or
 * retired panels) so old `display-config.json` payloads keep working.
 */

// 24-column grid; minW:4 ≈ 17% (six panels per row), minH:3 ≈ 156px.
const MIN_W = 4;

// The panels every install has, in the order a new board shows them. The UPS
// and Pipeline panels join only once their source is set up
// (configuredPanels.js), so DashboardView passes them when they show (#272).
export const DEFAULT_PANELS = ['cron-jobs', 'todos', 'quicklaunch'];

// Below the nodes, the panels pair up by height. HelmGrid grows a panel to fit
// its content and only ever pushes a panel down, so a panel spanning two
// columns of different heights lands under the taller one and leaves a hole
// under the other. Two panels of about the same height, side by side, end
// level, and the pair below them shares their split, so each sits under one
// panel. The tall pair (Pipeline, Scheduled Jobs) comes first, then the short
// pair (UPS, Checklist), each half and half. When one of a pair is not shown,
// the two left over (one tall, one short) share a row, the tall one 2/3; a
// panel left alone takes the whole row. Quick Launch closes the board.
const TALL_PANELS = ['pipeline', 'cron-jobs'];
const SHORT_PANELS = ['ups', 'todos'];
// Minimum heights: a panel grows to fit its content (HelmGrid). Panels side by
// side all get the row's tallest minimum, so a short pair starts the same height.
const PANEL_H = { pipeline: 5, 'cron-jobs': 7, ups: 5, todos: 7, quicklaunch: 4 };
const PANEL_MIN_H = { quicklaunch: 2 };
const NODE_H = 8;

/** The panel rows for `panels`, top to bottom: each a list of [panel, share of the width]. */
function panelRows(panels) {
  const tall = TALL_PANELS.filter((i) => panels.includes(i));
  const short = SHORT_PANELS.filter((i) => panels.includes(i));
  const rows = [];
  if (tall.length === 2) rows.push(tall.map((i) => [i, 1 / 2]));
  if (short.length === 2) rows.push(short.map((i) => [i, 1 / 2]));
  const leftOver = [tall.length === 1 && [tall[0], 2 / 3], short.length === 1 && [short[0], 1 / 3]];
  const left = leftOver.filter(Boolean);
  if (left.length) rows.push(left.length === 1 ? [[left[0][0], 1]] : left);
  if (panels.includes('quicklaunch')) rows.push([['quicklaunch', 1]]);
  return rows;
}
// Nodes to a row at most, per breakpoint.
const NODES_PER_ROW = { lg: 3, md: 2 };

/** `n` items in `rows` rows, as evenly as can be, the longer rows first. */
function spread(n, rows) {
  const base = Math.floor(n / rows);
  const extra = n % rows;
  return Array.from({ length: rows }, (_, r) => base + (r < extra ? 1 : 0));
}

/** `count` widths filling `cols`, the remainder on the last. */
function evenWidths(count, cols) {
  const w = Math.floor(cols / count);
  return Array.from({ length: count }, (_, k) => (k === count - 1 ? cols - w * (count - 1) : w));
}

function breakpointLayout(nodeKeys, panels, cols, perRowMax) {
  const items = [];
  let y = 0;

  // Nodes first, in their order: rows of at most perRowMax (fewer when the
  // grid is too narrow for that many at MIN_W), spread evenly over the fewest
  // rows that hold them, the longer rows first, each row filling the width.
  // Three to a row leaves no node alone in a row (2 nodes: 2; 4: 2 + 2; 7:
  // 3 + 2 + 2). Two to a row (md, or a grid under 12 columns) leaves the last
  // node of an odd count alone, the whole width (3: 2 + 1).
  const perRow = Math.max(1, Math.min(perRowMax, Math.floor(cols / MIN_W)));
  const rowCount = Math.ceil(nodeKeys.length / perRow);
  let next = 0;
  for (const count of rowCount ? spread(nodeKeys.length, rowCount) : []) {
    let x = 0;
    for (const w of evenWidths(count, cols)) {
      items.push({
        i: `node-${nodeKeys[next++]}`,
        x,
        y,
        w,
        h: NODE_H,
        minW: Math.min(MIN_W, cols),
        minH: 3,
      });
      x += w;
    }
    y += NODE_H;
  }

  // Then the panels, in their pairs where both fit side by side; one stacked
  // on the other, each the whole width, where they don't.
  const place = (i, x, w, h) =>
    items.push({ i, x, y, w, h, minW: Math.min(MIN_W, cols), minH: PANEL_MIN_H[i] || 3 });
  for (const row of panelRows(panels)) {
    const ws = row.map(([, share]) => Math.round(cols * share));
    ws[ws.length - 1] = cols - ws.slice(0, -1).reduce((a, b) => a + b, 0);
    if (row.length > 1 && ws.every((w) => w >= MIN_W)) {
      const h = Math.max(...row.map(([i]) => PANEL_H[i]));
      let x = 0;
      row.forEach(([i], k) => {
        place(i, x, ws[k], h);
        x += ws[k];
      });
      y += h;
    } else {
      for (const [i] of row) {
        place(i, 0, cols, PANEL_H[i]);
        y += PANEL_H[i];
      }
    }
  }
  return items;
}

/**
 * The grid for a board without a saved layout (#248): its nodes first, in
 * their /api/services order, at most three to a row (two at the md
 * breakpoint), spread evenly over the rows, each row filling the width; at two
 * to a row an odd count leaves the last node alone. Then the panels in
 * `panels`, paired by height: Pipeline beside Scheduled Jobs, UPS beside the
 * Checklist, then Quick Launch (panelRows). A fresh install and the demo both
 * get it; a saved layout is never replaced by it (DashboardView uses this only
 * when there is none). `cols` is the grid's columns per breakpoint.
 *
 * @param {string[]} nodeKeys
 * @param {{ panels?: string[], cols?: { lg: number, md: number } }} [options]
 */
export function defaultLayouts(
  nodeKeys,
  { panels = DEFAULT_PANELS, cols = { lg: 24, md: 20 } } = {}
) {
  return {
    lg: breakpointLayout(nodeKeys, panels, cols.lg, NODES_PER_ROW.lg),
    md: breakpointLayout(nodeKeys, panels, cols.md, NODES_PER_ROW.md),
  };
}

// Old section keys → new node-prefixed keys for layout migration.
const LEGACY_KEY_MAP = {
  gateway: 'node-gateway',
  production: 'node-production',
  staging: 'node-staging',
};

// Keys that should be stripped from saved layouts (retired/renamed nodes).
const STRIP_KEYS = new Set(['node-pi']);

export function migrateLayouts(layouts) {
  if (!layouts) return null;

  const migrated = {};
  let changed = false;

  for (const [bp, items] of Object.entries(layouts)) {
    // De-dupe `i` per breakpoint, keeping the FIRST occurrence. Renaming a
    // legacy key (e.g. "gateway" → "node-gateway") can collide with an already-
    // migrated "node-gateway" already present in the saved layout, producing two
    // grid items with the same `i`. react-grid-layout keys on `i`, so the
    // duplicate would drop/overlap a panel. Drop the later duplicate here.
    const seen = new Set();
    migrated[bp] = items
      .map((item) => {
        const newKey = LEGACY_KEY_MAP[item.i];
        if (newKey) {
          changed = true;
          return { ...item, i: newKey };
        }
        return item;
      })
      .filter((item) => {
        if (STRIP_KEYS.has(item.i)) {
          changed = true;
          return false;
        }
        if (seen.has(item.i)) {
          changed = true;
          return false;
        }
        seen.add(item.i);
        return true;
      });
  }

  return changed ? migrated : layouts;
}

// Phone-width (sm) order, used when the layout has no sm breakpoint of its own.
// `node-*` stands for every node panel, in the order the desktop layout has them.
// Anything not named (custom groups) follows, in desktop order.
export const MOBILE_PANEL_ORDER = [
  'quicklaunch',
  'node-*',
  'ups',
  'pipeline',
  'todos',
  'cron-jobs',
];

/** `keys` (a desktop layout's panel ids, in its order) in MOBILE_PANEL_ORDER. */
export function orderForMobile(keys) {
  const placed = new Set();
  const out = [];
  const take = (k) => {
    if (!placed.has(k)) {
      placed.add(k);
      out.push(k);
    }
  };
  for (const entry of MOBILE_PANEL_ORDER) {
    if (entry.endsWith('*')) {
      const prefix = entry.slice(0, -1);
      keys.filter((k) => k.startsWith(prefix)).forEach(take);
    } else if (keys.includes(entry)) {
      take(entry);
    }
  }
  keys.forEach(take);
  return out;
}

// The board's own panels: the layout reconciler adds one a layout lacks while
// it is shown (not switched off in Settings; the UPS and Pipeline panels only
// once their source is configured, #272).
export const STATIC_PANEL_KEYS = ['ups', 'pipeline', 'todos', 'cron-jobs', 'quicklaunch'];
