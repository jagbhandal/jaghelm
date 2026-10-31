import { describe, it, expect } from 'vitest';
import { ATOMIC_KEYS, rebaseConfig, rebaseDetailed, sameConfig } from './rebaseConfig.js';

// #547: a refused display-config save keeps only what this device changed
// since the copy it read, laid over the server's copy now.

const BASE = Object.freeze({
  title: 'Home',
  theme: 'dark',
  refreshInterval: 30,
  overviewSections: { strip: true, services: true, infrastructure: true },
  links: [{ name: 'Netdata', url: 'https://netdata.example/' }],
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

// #330: the arrangement's keys never merge from a stale base.
describe('rebaseDetailed: the conflict policy for arrangement keys', () => {
  const base = {
    ...clone(BASE),
    overviewLayout: { pinned: ['a:one'] },
    customGroups: [{ id: 'g', title: 'G', containers: [] }],
  };

  it('names the arrangement keys', () => {
    expect(ATOMIC_KEYS).toEqual(['overviewLayout', 'customGroups', 'themes', 'nodeOrder', 'diskForecastDays', 'alerts', 'backupAgeHours', 'expiry', 'expiryDays', 'energy']);
  });

  it('energy (#801): two tabs editing the rates take the server’s whole copy, not a rate-by-rate merge', () => {
    const was = { ...clone(base), energy: { currency: '$', rates: [{ from: '00:00', perKwh: 0.1 }] } };
    const fresh = { ...clone(was), energy: { currency: '$', rates: [{ from: '00:00', perKwh: 0.2 }] } };
    const local = { ...clone(was), energy: { currency: '£', rates: [{ from: '00:00', perKwh: 0.1 }] } };
    const { config, dropped } = rebaseDetailed(was, local, fresh);
    expect(config.energy).toEqual(fresh.energy);
    expect(dropped).toEqual(['energy']);
    // The plain rebase would have mixed the two: the other tab's rate under this tab's symbol.
    expect(rebaseConfig(was, local, fresh).energy).toEqual({
      currency: '£',
      rates: [{ from: '00:00', perKwh: 0.2 }],
    });
  });

  it('a list both devices changed takes the server’s, and says it dropped this device’s', () => {
    const fresh = { ...clone(base), overviewLayout: { pinned: ['a:one', 'b:two'] } };
    const local = { ...clone(base), overviewLayout: { pinned: ['a:one', 'c:three'] } };
    const { config, dropped } = rebaseDetailed(base, local, fresh);
    expect(config.overviewLayout).toEqual({ pinned: ['a:one', 'b:two'] });
    expect(dropped).toEqual(['overviewLayout']);
    // The plain rebase would have replaced the server's pins with this device's.
    expect(rebaseConfig(base, local, fresh).overviewLayout).toEqual({
      pinned: ['a:one', 'c:three'],
    });
  });

  it('groups the same: the server’s whole list stands over a stale edit', () => {
    const fresh = {
      ...clone(base),
      customGroups: [{ id: 'g', title: 'Renamed', containers: ['x:y'] }],
    };
    const local = {
      ...clone(base),
      customGroups: [...base.customGroups, { id: 'h', title: 'H', containers: [] }],
    };
    const { config, dropped } = rebaseDetailed(base, local, fresh);
    expect(config.customGroups).toEqual(fresh.customGroups);
    expect(dropped).toEqual(['customGroups']);
  });

  it('a removal of the key (Reset) over a changed server copy is dropped too', () => {
    const fresh = { ...clone(base), overviewLayout: { pinned: ['b:two'] } };
    const local = clone(base);
    delete local.overviewLayout;
    const { config, dropped } = rebaseDetailed(base, local, fresh);
    expect(config.overviewLayout).toEqual({ pinned: ['b:two'] });
    expect(dropped).toEqual(['overviewLayout']);
  });

  it('a key only this device changed, or only the server changed, is not a conflict', () => {
    const mine = { ...clone(base), overviewLayout: { pinned: [] } };
    expect(rebaseDetailed(base, mine, clone(base))).toEqual({ config: mine, dropped: [] });
    const theirs = { ...clone(base), overviewLayout: { pinned: ['b:two'] } };
    expect(rebaseDetailed(base, clone(base), theirs)).toEqual({ config: theirs, dropped: [] });
  });

  it('both devices making the same change is no conflict', () => {
    const both = { ...clone(base), overviewLayout: { pinned: ['a:one', 'b:two'] } };
    expect(rebaseDetailed(base, both, both).dropped).toEqual([]);
  });

  it('other settings keep the leaf merge, beside a dropped arrangement', () => {
    const fresh = { ...clone(base), overviewLayout: { pinned: ['b:two'] }, theme: 'light' };
    const local = { ...clone(base), overviewLayout: { pinned: ['c:three'] }, title: 'Lab' };
    const { config, dropped } = rebaseDetailed(base, local, fresh);
    expect(dropped).toEqual(['overviewLayout']);
    expect(config).toMatchObject({
      title: 'Lab',
      theme: 'light',
      overviewLayout: { pinned: ['b:two'] },
    });
  });
});

describe('custom themes are atomic (#331)', () => {
  const A = { id: 'a', name: 'A', base: 'dark', tokens: { bg: '#000000' } };
  const B = { ...A, id: 'b', name: 'B' };
  it('two devices each adding a theme: the server copy stands, this device’s add is dropped and named', () => {
    const { config, dropped } = rebaseDetailed({ themes: [] }, { themes: [A] }, { themes: [B] });
    expect(config.themes).toEqual([B]);
    expect(dropped).toEqual(['themes']);
  });
  it('a theme only this device changed is kept', () => {
    const { config, dropped } = rebaseDetailed(
      { themes: [] },
      { themes: [A], x: 1 },
      { themes: [] }
    );
    expect(config.themes).toEqual([A]);
    expect(dropped).toEqual([]);
  });
});
