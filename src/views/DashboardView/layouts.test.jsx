import { describe, it, expect } from 'vitest';
import { migrateLayouts } from './layouts';

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
