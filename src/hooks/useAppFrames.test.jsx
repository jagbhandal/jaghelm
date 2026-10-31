import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MAX_LOADED_APPS, useAppFrames } from './useAppFrames.js';

// Which app frames are mounted (#269): an app tab mounts on its first visit and
// stays mounted, hidden, until its tab leaves the config, it is unloaded, or
// more than MAX_LOADED_APPS are loaded and it is the least recently used (#296).

const dash = { id: 'dashboard', label: 'Dashboard', type: 'dashboard' };
const netdata = { id: 'netdata', label: 'Netdata', type: 'iframe', url: 'https://netdata.example' };
const kuma = { id: 'kuma', label: 'Uptime Kuma', type: 'iframe', url: 'https://kuma.example' };

const ids = (frames) => frames.map((f) => [f.tab.id, f.active]);

function setup(tabs, activeTab) {
  const hook = renderHook(({ tabs, activeTab }) => useAppFrames(tabs, activeTab), {
    initialProps: { tabs, activeTab },
  });
  // The frames, as the tests below read them; the hook's unload beside them.
  return {
    result: {
      get current() {
        return hook.result.current.frames;
      },
    },
    unload: (id) => act(() => hook.result.current.unload(id)),
    reload: (id) => act(() => hook.result.current.reload(id)),
    rerender: hook.rerender,
  };
}

describe('useAppFrames', () => {
  it('mounts nothing before an app tab is visited', () => {
    const { result } = setup([dash, netdata, kuma], 'dashboard');
    expect(result.current).toEqual([]);
  });

  it('keeps a visited app mounted, inactive, after switching away', () => {
    const { result, rerender } = setup([dash, netdata, kuma], 'netdata');
    expect(ids(result.current)).toEqual([['netdata', true]]);
    rerender({ tabs: [dash, netdata, kuma], activeTab: 'dashboard' });
    expect(ids(result.current)).toEqual([['netdata', false]]);
    rerender({ tabs: [dash, netdata, kuma], activeTab: 'settings' });
    expect(ids(result.current)).toEqual([['netdata', false]]);
    rerender({ tabs: [dash, netdata, kuma], activeTab: 'kuma' });
    expect(ids(result.current)).toEqual([['netdata', false], ['kuma', true]]);
  });

  it('lists frames in first-visit order, so reordering the tabs moves no frame', () => {
    const { result, rerender } = setup([dash, netdata, kuma], 'kuma');
    rerender({ tabs: [dash, netdata, kuma], activeTab: 'netdata' });
    expect(ids(result.current)).toEqual([['kuma', false], ['netdata', true]]);
    rerender({ tabs: [dash, kuma, netdata], activeTab: 'netdata' });
    expect(ids(result.current)).toEqual([['kuma', false], ['netdata', true]]);
  });

  it('unmounts an app whose tab leaves the config, and does not bring it back', () => {
    const { result, rerender } = setup([dash, netdata, kuma], 'netdata');
    rerender({ tabs: [dash, netdata, kuma], activeTab: 'kuma' });
    rerender({ tabs: [dash, kuma], activeTab: 'kuma' });
    expect(ids(result.current)).toEqual([['kuma', true]]);
    // Added again later (same id): mounted again only once it is visited.
    rerender({ tabs: [dash, kuma, netdata], activeTab: 'kuma' });
    expect(ids(result.current)).toEqual([['kuma', true]]);
  });

  it('keeps the URL a hidden frame last showed until it is opened again', () => {
    const { result, rerender } = setup([dash, netdata], 'netdata');
    // Typed in Settings, a key at a time: the hidden frame doesn't follow.
    for (const url of ['https://g', 'https://netdata2', 'https://netdata2.example']) {
      rerender({ tabs: [dash, { ...netdata, label: 'Netdata 2', url }], activeTab: 'settings' });
      expect(result.current[0].tab.url).toBe('https://netdata.example');
      expect(result.current[0].tab.label).toBe('Netdata 2');
    }
    const moved = { ...netdata, url: 'https://netdata2.example' };
    rerender({ tabs: [dash, moved], activeTab: 'netdata' });
    expect(result.current[0].tab).toBe(moved);
    rerender({ tabs: [dash, moved], activeTab: 'dashboard' });
    expect(result.current[0].tab).toBe(moved);
  });

  it('never mounts a tab that is not an app', () => {
    const { result } = setup([dash, { id: 'odd', label: 'Odd' }], 'odd');
    expect(result.current).toEqual([]);
  });

  describe('the cap: at most MAX_LOADED_APPS loaded, the least recently used unloads', () => {
    const apps = Array.from({ length: 7 }, (_, i) => ({
      id: `app${i}`,
      label: `App ${i}`,
      type: 'iframe',
      url: `https://app${i}.example`,
    }));
    const tabs = [dash, ...apps];

    it('is five', () => {
      expect(MAX_LOADED_APPS).toBe(5);
    });

    it('unloads the least recently opened, not the first visited', () => {
      const { result, rerender } = setup(tabs, 'app0');
      for (const id of ['app1', 'app2', 'app3', 'app4']) rerender({ tabs, activeTab: id });
      expect(result.current).toHaveLength(5);
      // Back to app0: now app1 is the least recently used.
      rerender({ tabs, activeTab: 'dashboard' });
      rerender({ tabs, activeTab: 'app0' });
      rerender({ tabs, activeTab: 'app5' });
      // First-visit order holds for those left, so no frame moves in the page.
      expect(ids(result.current)).toEqual([
        ['app0', false],
        ['app2', false],
        ['app3', false],
        ['app4', false],
        ['app5', true],
      ]);
      rerender({ tabs, activeTab: 'app6' });
      expect(ids(result.current).map(([id]) => id)).toEqual([
        'app0',
        'app3',
        'app4',
        'app5',
        'app6',
      ]);
    });

    it('opening a loaded app counts as using it', () => {
      const { result, rerender } = setup(tabs, 'app0');
      for (const id of ['app1', 'app2', 'app3', 'app4', 'app1', 'app0']) {
        rerender({ tabs, activeTab: id });
      }
      rerender({ tabs, activeTab: 'app5' });
      expect(ids(result.current).map(([id]) => id)).toEqual([
        'app0',
        'app1',
        'app3',
        'app4',
        'app5',
      ]);
    });

    it('never unloads the open app, and stays at the cap', () => {
      const { result, rerender } = setup(tabs, 'app0');
      for (const id of ['app1', 'app2', 'app3', 'app4', 'app5', 'app6']) {
        rerender({ tabs, activeTab: id });
        expect(result.current.length).toBeLessThanOrEqual(MAX_LOADED_APPS);
        expect(result.current.find((f) => f.active)?.tab.id).toBe(id);
      }
    });
  });

  describe('unload', () => {
    it('unmounts a loaded app; opening it again mounts it afresh', () => {
      const { result, rerender, unload } = setup([dash, netdata, kuma], 'netdata');
      rerender({ tabs: [dash, netdata, kuma], activeTab: 'kuma' });
      unload('netdata');
      expect(ids(result.current)).toEqual([['kuma', true]]);
      rerender({ tabs: [dash, netdata, kuma], activeTab: 'netdata' });
      expect(ids(result.current)).toEqual([
        ['kuma', false],
        ['netdata', true],
      ]);
    });

    it('leaves the open app alone (no reload, no move), and ignores an app not loaded', () => {
      const { result, rerender, unload } = setup([dash, netdata, kuma], 'netdata');
      rerender({ tabs: [dash, netdata, kuma], activeTab: 'kuma' });
      rerender({ tabs: [dash, netdata, kuma], activeTab: 'netdata' });
      unload('netdata');
      unload('nope');
      expect(ids(result.current)).toEqual([
        ['netdata', true],
        ['kuma', false],
      ]);
    });
  });

  describe('reload', () => {
    it("counts a reload on that app only, which keeps its place and stays loaded", () => {
      const { result, rerender, reload } = setup([dash, netdata, kuma], 'netdata');
      rerender({ tabs: [dash, netdata, kuma], activeTab: 'kuma' });
      rerender({ tabs: [dash, netdata, kuma], activeTab: 'netdata' });
      const reloads = () => result.current.map((f) => [f.tab.id, f.reloads]);
      expect(reloads()).toEqual([
        ['netdata', 0],
        ['kuma', 0],
      ]);
      reload('netdata');
      reload('netdata');
      expect(reloads()).toEqual([
        ['netdata', 2],
        ['kuma', 0],
      ]);
      reload('nope');
      expect(reloads()).toEqual([
        ['netdata', 2],
        ['kuma', 0],
      ]);
    });
  });

  // #362: an app set to open in a new browser tab never gets a frame.
  it('mounts no frame for an app that opens in a new browser tab', () => {
    const outside = { ...kuma, newTab: true };
    const { result } = setup([dash, netdata, outside], 'kuma');
    expect(result.current).toEqual([]);
  });
});
