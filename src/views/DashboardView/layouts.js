/**
 * Dashboard layout constants and migration helpers.
 *
 * `DEFAULT_LAYOUTS` is the fallback grid used when a user has no saved layout.
 * `migrateLayouts` updates legacy layout keys (renamed/retired panels) so old
 * `display-config.json` payloads keep working after key changes.
 */

// 24-column grid; minW:4 ≈ 17% (six panels per row), minH:3 ≈ 156px.
//
// Only the panels every install has. It names no node: node panels come from
// the nodes discovered (useEffectiveLayouts adds them), so a fresh install
// shows the "Connect your first node" empty state instead of a "Loading …"
// panel for a node it doesn't have (#272). The UPS and Pipeline panels join
// the same way once their source is configured (configuredPanels.js).
export const DEFAULT_LAYOUTS = {
  lg: [
    { i: 'cron-jobs', x: 0, y: 0, w: 16, h: 7, minW: 4, minH: 3 },
    { i: 'todos', x: 16, y: 0, w: 8, h: 7, minW: 4, minH: 3 },
    { i: 'quicklaunch', x: 0, y: 7, w: 24, h: 4, minW: 4, minH: 2 },
  ],
  md: [
    { i: 'cron-jobs', x: 0, y: 0, w: 20, h: 7 },
    { i: 'todos', x: 0, y: 7, w: 20, h: 5 },
    { i: 'quicklaunch', x: 0, y: 12, w: 20, h: 4 },
  ],
};

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

// Static panels the layout reconciler adds when a layout lacks them. The UPS and
// Pipeline panels are added only once their source is configured (#272).
export const STATIC_PANEL_KEYS = ['ups', 'pipeline', 'todos', 'cron-jobs', 'quicklaunch'];
