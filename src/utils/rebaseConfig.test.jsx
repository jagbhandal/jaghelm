import { describe, it, expect } from 'vitest';
import { rebaseConfig, sameConfig } from './rebaseConfig.js';

// #547: a refused display-config save keeps only what this device changed
// since the copy it read, laid over the server's copy now.

const BASE = Object.freeze({
  title: 'Home',
  theme: 'dark',
  refreshInterval: 30,
  overviewSections: { strip: true, services: true, infrastructure: true },
  links: [{ name: 'Grafana', url: 'https://grafana.example/' }],
  sections: { ups: { visible: true, order: 1 } },
});

const clone = (v) => structuredClone(v);

describe('rebaseConfig', () => {
  it("keeps the other device's change and this device's, in different settings", () => {
    const fresh = {
      ...clone(BASE),
      overviewSections: { ...BASE.overviewSections, services: false },
    };
    const local = { ...clone(BASE), title: 'Lab' };
    expect(rebaseConfig(BASE, local, fresh)).toEqual({
      ...clone(BASE),
      title: 'Lab',
      overviewSections: { strip: true, services: false, infrastructure: true },
    });
  });

  it('merges two switches in the same object, leaf by leaf', () => {
    const fresh = clone(BASE);
    fresh.overviewSections.services = false;
    const local = clone(BASE);
    local.overviewSections.infrastructure = false;
    expect(rebaseConfig(BASE, local, fresh).overviewSections).toEqual({
      strip: true,
      services: false,
      infrastructure: false,
    });
  });

  it("a leaf both devices changed takes this device's value; nothing else is lost", () => {
    const fresh = { ...clone(BASE), title: 'Theirs', refreshInterval: 60 };
    fresh.sections.ups.order = 3;
    const local = { ...clone(BASE), title: 'Mine' };
    local.overviewSections.strip = false;
    expect(rebaseConfig(BASE, local, fresh)).toEqual({
      ...clone(BASE),
      title: 'Mine',
      refreshInterval: 60,
      overviewSections: { strip: false, services: true, infrastructure: true },
      sections: { ups: { visible: true, order: 3 } },
    });
  });

  it("an array is one leaf: replaced whole when this device changed it, else the server's stays", () => {
    const theirs = [{ name: 'Kuma', url: 'https://kuma.example/' }];
    const mine = [...BASE.links, { name: 'NAS', url: 'https://nas.example/' }];
    expect(
      rebaseConfig(BASE, { ...clone(BASE), links: mine }, { ...clone(BASE), links: theirs }).links
    ).toEqual(mine);
    expect(rebaseConfig(BASE, clone(BASE), { ...clone(BASE), links: theirs }).links).toEqual(
      theirs
    );
  });

  it('a key this device added or removed is added or removed; one the other device added stays', () => {
    const local = { ...clone(BASE), showClock: false };
    delete local.refreshInterval;
    const fresh = { ...clone(BASE), weatherLat: 43.7 };
    const out = rebaseConfig(BASE, local, fresh);
    expect(out.showClock).toBe(false);
    expect(Object.hasOwn(out, 'refreshInterval')).toBe(false);
    expect(out.weatherLat).toBe(43.7);
  });

  it('an object both devices created merges too', () => {
    const base = { title: 'Home' };
    const fresh = { title: 'Home', overviewSections: { services: false } };
    const local = { title: 'Home', overviewSections: { rail: false } };
    expect(rebaseConfig(base, local, fresh).overviewSections).toEqual({
      services: false,
      rail: false,
    });
  });

  it('with no copy read, every setting of this device is its own', () => {
    const local = { title: 'Mine', overviewSections: { rail: false } };
    expect(
      rebaseConfig(null, local, { theme: 'light', overviewSections: { services: false } })
    ).toEqual({
      title: 'Mine',
      theme: 'light',
      overviewSections: { services: false, rail: false },
    });
    expect(rebaseConfig(null, local, null)).toEqual(local);
  });

  it('changes none of its arguments', () => {
    const base = clone(BASE);
    const local = { ...clone(BASE), title: 'Lab' };
    local.overviewSections.services = false;
    const fresh = { ...clone(BASE), theme: 'light' };
    const copies = clone([base, local, fresh]);
    rebaseConfig(base, local, fresh);
    expect([base, local, fresh]).toEqual(copies);
  });
});

describe('sameConfig', () => {
  it('compares JSON values deeply, key order aside', () => {
    expect(sameConfig({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameConfig({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameConfig([1, 2], [2, 1])).toBe(false);
    expect(sameConfig({ a: [] }, { a: {} })).toBe(false);
    expect(sameConfig(null, {})).toBe(false);
  });
});
