/**
 * Dashboard layout constants and migration helpers.
 *
 * `DEFAULT_LAYOUTS` is the fallback grid used when a user has no saved layout.
 * `migrateLayouts` updates legacy layout keys (renamed/retired panels) so old
 * `display-config.json` payloads keep working after key changes.
 */

// 24-column grid; minW:4 ≈ 17% (six panels per row), minH:3 ≈ 156px
export const DEFAULT_LAYOUTS = {
  lg: [
    { i: 'node-gateway', x: 0, y: 0, w: 24, h: 7, minW: 4, minH: 3 },
    { i: 'node-production', x: 0, y: 7, w: 24, h: 7, minW: 4, minH: 3 },
    { i: 'node-staging', x: 0, y: 14, w: 12, h: 6, minW: 4, minH: 3 },
    { i: 'ups', x: 12, y: 14, w: 12, h: 5, minW: 4, minH: 3 },
    { i: 'pipeline', x: 0, y: 20, w: 16, h: 5, minW: 4, minH: 3 },
    { i: 'todos', x: 16, y: 20, w: 8, h: 5, minW: 4, minH: 3 },
    { i: 'cron-jobs', x: 0, y: 25, w: 24, h: 7, minW: 4, minH: 3 },
    { i: 'quicklaunch', x: 0, y: 32, w: 24, h: 4, minW: 4, minH: 2 },
  ],
  md: [
    { i: 'node-gateway', x: 0, y: 0, w: 20, h: 7 },
    { i: 'node-production', x: 0, y: 7, w: 20, h: 7 },
    { i: 'node-staging', x: 0, y: 14, w: 20, h: 6 },
    { i: 'ups', x: 0, y: 20, w: 20, h: 5 },
    { i: 'pipeline', x: 0, y: 25, w: 20, h: 5 },
    { i: 'todos', x: 0, y: 30, w: 20, h: 5 },
    { i: 'cron-jobs', x: 0, y: 35, w: 20, h: 7 },
    { i: 'quicklaunch', x: 0, y: 42, w: 20, h: 4 },
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

// Mobile breakpoint ordering — explicit so retired panels don't surface in unwanted positions.
export const MOBILE_PANEL_ORDER = [
  'quicklaunch',
  'node-pi1',
  'node-pi2',
  'node-vm103',
  'node-vm101',
  'node-pve',
  'node-nas',
  'ups',
  'pipeline',
  'todos',
  'cron-jobs',
];

// Static panels that the layout reconciler must always include.
export const STATIC_PANEL_KEYS = ['ups', 'pipeline', 'todos', 'cron-jobs', 'quicklaunch'];
