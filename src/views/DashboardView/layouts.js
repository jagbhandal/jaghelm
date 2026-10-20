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

// Below the nodes, the panels go in these rows, each panel taking its share of
// the row's width; a panel without its pair takes the whole row. Heights are
// minimums: a panel grows to fit its content (HelmGrid).
const PANEL_ROWS = [
  [
    { i: 'ups', share: 1 / 3, h: 5 },
    { i: 'pipeline', share: 2 / 3, h: 5 },
  ],
  [
    { i: 'cron-jobs', share: 2 / 3, h: 7 },
    { i: 'todos', share: 1 / 3, h: 7 },
  ],
  [{ i: 'quicklaunch', share: 1, h: 4, minH: 2 }],
];
const NODE_H = 8;
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
  // grid is too narrow for that many at MIN_W), spread evenly so no row is
  // left with one node, each row filling the width.
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

  // Then the panels, paired where both show and fit side by side.
  for (const row of PANEL_ROWS) {
    const shown = row.filter((p) => panels.includes(p.i));
    const ws = shown.length > 1 ? shown.map((p) => Math.round(cols * p.share)) : [cols];
    if (shown.length > 1) ws[ws.length - 1] = cols - ws.slice(0, -1).reduce((a, b) => a + b, 0);
    const sideBySide = shown.length > 1 && ws.every((w) => w >= MIN_W);
    let x = 0;
    let rowH = 0;
    shown.forEach((p, k) => {
      const w = sideBySide ? ws[k] : cols;
      if (!sideBySide && k > 0) {
        y += rowH;
        rowH = 0;
        x = 0;
      }
      items.push({ i: p.i, x, y, w, h: p.h, minW: Math.min(MIN_W, cols), minH: p.minH || 3 });
      x += w;
      rowH = Math.max(rowH, p.h);
    });
    y += rowH;
  }
  return items;
}

/**
 * The grid for a board without a saved layout (#248): its nodes first, in
 * their /api/services order, at most three to a row (two at the md
 * breakpoint), spread evenly over the rows, each row filling the width. Then
 * the panels in `panels`: UPS beside Pipeline, Scheduled Jobs beside the
 * Checklist, then Quick Launch. A fresh install and the demo both get it; a
 * saved layout is never replaced by it (DashboardView uses this only when
 * there is none). `cols` is the grid's columns per breakpoint.
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
