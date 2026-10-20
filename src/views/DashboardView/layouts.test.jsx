import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PANELS,
  MOBILE_PANEL_ORDER,
  defaultLayouts,
  migrateLayouts,
  orderForMobile,
} from './layouts';

describe('migrateLayouts', () => {
  it('renames legacy keys to their node-prefixed equivalents', () => {
    const saved = { lg: [{ i: 'gateway', x: 0, y: 0, w: 24, h: 7 }] };
    const out = migrateLayouts(saved);
    expect(out.lg.map((it) => it.i)).toEqual(['node-gateway']);
  });

  it('strips retired keys', () => {
    const saved = { lg: [{ i: 'node-pi', x: 0, y: 0, w: 4, h: 3 }, { i: 'ups', x: 4, y: 0, w: 4, h: 3 }] };
    const out = migrateLayouts(saved);
    expect(out.lg.map((it) => it.i)).toEqual(['ups']);
  });

  it('de-dupes when a legacy key migrates onto an already-present node key (keeps first)', () => {
    // Saved layout has BOTH the migrated "node-gateway" and the legacy "gateway".
    // Without de-duping, the rename produces two items with i==="node-gateway"
    // and react-grid-layout (which keys on i) drops/overlaps one.
    const saved = {
      lg: [
        { i: 'node-gateway', x: 0, y: 0, w: 24, h: 7 },
        { i: 'ups', x: 0, y: 7, w: 12, h: 5 },
        { i: 'gateway', x: 12, y: 7, w: 12, h: 7 }, // legacy → node-gateway (dup)
      ],
    };
    const out = migrateLayouts(saved);
    const ids = out.lg.map((it) => it.i);
    expect(ids).toEqual(['node-gateway', 'ups']);
    // First occurrence is kept verbatim (its x/y/w/h), not the migrated duplicate.
    expect(out.lg.find((it) => it.i === 'node-gateway')).toMatchObject({ x: 0, y: 0, w: 24, h: 7 });
  });

  it('de-dupes plain duplicate ids per breakpoint (keeps first)', () => {
    const saved = {
      lg: [
        { i: 'ups', x: 0, y: 0, w: 12, h: 5 },
        { i: 'ups', x: 12, y: 0, w: 12, h: 5 },
      ],
    };
    const out = migrateLayouts(saved);
    expect(out.lg.map((it) => it.i)).toEqual(['ups']);
  });

  it('de-dupes independently per breakpoint', () => {
    const saved = {
      lg: [{ i: 'gateway' }, { i: 'node-gateway' }],
      md: [{ i: 'node-gateway' }, { i: 'gateway' }],
    };
    const out = migrateLayouts(saved);
    expect(out.lg.map((it) => it.i)).toEqual(['node-gateway']);
    expect(out.md.map((it) => it.i)).toEqual(['node-gateway']);
  });

  it('returns the original object unchanged when nothing migrated', () => {
    const saved = { lg: [{ i: 'ups', x: 0, y: 0, w: 12, h: 5 }] };
    expect(migrateLayouts(saved)).toBe(saved);
  });

  it('returns null for nullish input', () => {
    expect(migrateLayouts(null)).toBeNull();
    expect(migrateLayouts(undefined)).toBeNull();
  });
});

describe('defaultLayouts (a board with no saved layout)', () => {
  const keysOf = (layouts) => Object.values(layouts).flatMap((items) => items.map((it) => it.i));
  // Rows of a breakpoint's layout, top to bottom: each the panel ids at one y, left to right.
  const rows = (items) => {
    const byY = new Map();
    for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (!byY.has(it.y)) byY.set(it.y, []);
      byY.get(it.y).push(it);
    }
    return [...byY.values()];
  };
  const ids = (row) => row.map((it) => it.i);
  const widths = (row) => row.map((it) => it.w);
  // No two items overlap, and none leaves the grid.
  const assertPacked = (items, cols) => {
    for (const a of items) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(cols);
      for (const b of items) {
        if (a === b) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${a.i} overlaps ${b.i}`).toBe(true);
      }
    }
  };

  it('names no node when there is none, and no UPS or Pipeline panel by default (#272)', () => {
    const keys = keysOf(defaultLayouts([]));
    expect(keys.filter((k) => k.startsWith('node-'))).toEqual([]);
    expect(keys).not.toContain('ups');
    expect(keys).not.toContain('pipeline');
    expect(DEFAULT_PANELS).toEqual(['cron-jobs', 'todos', 'quicklaunch']);
  });

  it('puts the nodes first, in their order, three to a row at most, each row filling the width (#248)', () => {
    const { lg, md } = defaultLayouts(['edge', 'apps', 'storage']);
    const [nodes] = rows(lg);
    expect(ids(nodes)).toEqual(['node-edge', 'node-apps', 'node-storage']);
    expect(widths(nodes)).toEqual([8, 8, 8]);
    // Two to a row at the md breakpoint's 20 columns.
    expect(rows(md).slice(0, 2).map(ids)).toEqual([['node-edge', 'node-apps'], ['node-storage']]);
    expect(rows(md).slice(0, 2).map(widths)).toEqual([[10, 10], [20]]);
  });

  it('spreads the nodes evenly over the rows: three to a row leaves no node alone (#248)', () => {
    const nodeRows = (n, bp) =>
      rows(defaultLayouts(Array.from({ length: n }, (_, i) => `n${i}`))[bp])
        .map(ids)
        .filter((r) => r[0].startsWith('node-'))
        .map((r) => r.length);
    expect(nodeRows(1, 'lg')).toEqual([1]);
    expect(nodeRows(2, 'lg')).toEqual([2]);
    expect(nodeRows(4, 'lg')).toEqual([2, 2]);
    expect(nodeRows(5, 'lg')).toEqual([3, 2]);
    expect(nodeRows(7, 'lg')).toEqual([3, 2, 2]);
    expect(nodeRows(10, 'lg')).toEqual([3, 3, 2, 2]);
    for (let n = 2; n <= 12; n += 1) expect(nodeRows(n, 'lg')).not.toContain(1);
    expect(widths(rows(defaultLayouts(['a']).lg)[0])).toEqual([24]);
    // Two to a row (md): an odd count leaves the last node alone, the whole width.
    expect(nodeRows(3, 'md')).toEqual([2, 1]);
    expect(nodeRows(5, 'md')).toEqual([2, 2, 1]);
    expect(widths(rows(defaultLayouts(['a', 'b', 'c']).md)[1])).toEqual([20]);
  });

  // Panels side by side start level and share the row's height, so the row below can sit flush.
  const assertLevelRows = (items) => {
    for (const row of rows(items))
      expect(new Set(row.map((it) => it.h)).size, ids(row).join()).toBe(1);
  };

  it('pairs the panels by height: Pipeline with Scheduled Jobs, then UPS with the Checklist, then Quick Launch', () => {
    const { lg, md } = defaultLayouts(['a', 'b'], {
      panels: ['ups', 'pipeline', 'cron-jobs', 'todos', 'quicklaunch'],
    });
    expect(rows(lg).map(ids)).toEqual([
      ['node-a', 'node-b'],
      ['pipeline', 'cron-jobs'],
      ['ups', 'todos'],
      ['quicklaunch'],
    ]);
    // Both pairs half and half: each panel of the second pair sits under one of the first.
    expect(rows(lg).map(widths)).toEqual([[12, 12], [12, 12], [12, 12], [24]]);
    expect(rows(md).slice(1).map(widths)).toEqual([[10, 10], [10, 10], [20]]);
    assertLevelRows(lg);
    assertPacked(lg, 24);
  });

  it('puts the two panels left over from the pairs side by side, the tall one wider', () => {
    // A fresh install (no UPS, no Pipeline): Scheduled Jobs beside the Checklist.
    const fresh = defaultLayouts(['a']).lg;
    expect(rows(fresh).map(ids)).toEqual([['node-a'], ['cron-jobs', 'todos'], ['quicklaunch']]);
    expect(rows(fresh).map(widths)).toEqual([[24], [16, 8], [24]]);
    assertLevelRows(fresh);
    // Pipeline set up, Checklist switched off: Pipeline beside the UPS.
    const mixed = defaultLayouts(['a'], { panels: ['pipeline', 'ups', 'quicklaunch'] }).lg;
    expect(rows(mixed).map(ids)).toEqual([['node-a'], ['pipeline', 'ups'], ['quicklaunch']]);
    expect(rows(mixed).map(widths)).toEqual([[24], [16, 8], [24]]);
  });

  it('gives a panel left alone the whole row, and places only the panels it is given', () => {
    const pipeline = defaultLayouts(['a'], { panels: ['pipeline', 'cron-jobs', 'todos'] }).lg;
    expect(rows(pipeline).map(ids)).toEqual([['node-a'], ['pipeline', 'cron-jobs'], ['todos']]);
    expect(rows(pipeline).map(widths)).toEqual([[24], [12, 12], [24]]);
    const ups = defaultLayouts(['a'], { panels: ['ups', 'cron-jobs', 'todos'] }).lg;
    expect(rows(ups).map(ids)).toEqual([['node-a'], ['ups', 'todos'], ['cron-jobs']]);
    const alone = defaultLayouts([], { panels: ['todos', 'quicklaunch'] }).lg;
    expect(rows(alone).map(ids)).toEqual([['todos'], ['quicklaunch']]);
    expect(rows(alone).map(widths)).toEqual([[24], [24]]);
  });

  it('fits a narrow grid: fewer nodes to a row and no panel narrower than its minimum', () => {
    const cols = { lg: 6, md: 6 };
    const layouts = defaultLayouts(['a', 'b', 'c'], { panels: ['ups', 'pipeline', 'todos'], cols });
    for (const bp of ['lg', 'md']) {
      assertPacked(layouts[bp], 6);
      for (const it of layouts[bp]) expect(it.w).toBeGreaterThanOrEqual(it.minW);
    }
  });

  it('never overlaps two panels, whatever the node count', () => {
    for (let n = 0; n <= 9; n += 1) {
      const nodes = Array.from({ length: n }, (_, i) => `n${i}`);
      const layouts = defaultLayouts(nodes, { panels: ['ups', 'pipeline', ...DEFAULT_PANELS] });
      assertPacked(layouts.lg, 24);
      assertPacked(layouts.md, 20);
    }
  });
});

describe('mobile panel order', () => {
  it('names no node of its own (#272)', () => {
    expect(MOBILE_PANEL_ORDER.filter((k) => k.startsWith('node-') && k !== 'node-*')).toEqual([]);
  });

  it('puts Quick Launch first, then the nodes in their desktop order, then the panels, then groups', () => {
    const lg = [
      'node-b',
      'todos',
      'group-x',
      'ups',
      'quicklaunch',
      'node-a',
      'pipeline',
      'cron-jobs',
    ];
    expect(orderForMobile(lg)).toEqual([
      'quicklaunch',
      'node-b',
      'node-a',
      'ups',
      'pipeline',
      'todos',
      'cron-jobs',
      'group-x',
    ]);
  });

  it('leaves out what the layout does not have', () => {
    expect(orderForMobile(['todos', 'node-a'])).toEqual(['node-a', 'todos']);
    expect(orderForMobile([])).toEqual([]);
  });
});
