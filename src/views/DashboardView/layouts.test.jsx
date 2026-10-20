import { describe, it, expect } from 'vitest';
import { DEFAULT_LAYOUTS, MOBILE_PANEL_ORDER, migrateLayouts, orderForMobile } from './layouts';

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

describe('DEFAULT_LAYOUTS (a fresh install, no saved layout)', () => {
  const keys = Object.values(DEFAULT_LAYOUTS).flatMap((items) => items.map((it) => it.i));

  it('names no node, so no "Loading <node>…" panel stands in for one (#272)', () => {
    expect(keys.filter((k) => k.startsWith('node-'))).toEqual([]);
  });

  it('names no UPS or Pipeline panel: they join the board once their source is configured', () => {
    expect(keys).not.toContain('ups');
    expect(keys).not.toContain('pipeline');
  });
});

describe('mobile panel order', () => {
  it('names no node of its own (#272)', () => {
    expect(MOBILE_PANEL_ORDER.filter((k) => k.startsWith('node-') && k !== 'node-*')).toEqual([]);
  });

  it('puts Quick Launch first, then the nodes in their desktop order, then the panels, then groups', () => {
    const lg = ['node-b', 'todos', 'group-x', 'ups', 'quicklaunch', 'node-a', 'pipeline', 'cron-jobs'];
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
