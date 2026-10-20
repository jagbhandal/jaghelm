import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppFrames } from './useAppFrames.js';

// Which app frames are mounted (#269): an app tab mounts on its first visit and
// stays mounted, hidden, until its tab leaves the config.

const dash = { id: 'dashboard', label: 'Dashboard', type: 'dashboard' };
const grafana = { id: 'grafana', label: 'Grafana', type: 'iframe', url: 'https://grafana.example' };
const kuma = { id: 'kuma', label: 'Uptime Kuma', type: 'iframe', url: 'https://kuma.example' };

const ids = (frames) => frames.map((f) => [f.tab.id, f.active]);

function setup(tabs, activeTab) {
  return renderHook(({ tabs, activeTab }) => useAppFrames(tabs, activeTab), {
    initialProps: { tabs, activeTab },
  });
}

describe('useAppFrames', () => {
  it('mounts nothing before an app tab is visited', () => {
    const { result } = setup([dash, grafana, kuma], 'dashboard');
    expect(result.current).toEqual([]);
  });

  it('keeps a visited app mounted, inactive, after switching away', () => {
    const { result, rerender } = setup([dash, grafana, kuma], 'grafana');
    expect(ids(result.current)).toEqual([['grafana', true]]);
    rerender({ tabs: [dash, grafana, kuma], activeTab: 'dashboard' });
    expect(ids(result.current)).toEqual([['grafana', false]]);
    rerender({ tabs: [dash, grafana, kuma], activeTab: 'settings' });
    expect(ids(result.current)).toEqual([['grafana', false]]);
    rerender({ tabs: [dash, grafana, kuma], activeTab: 'kuma' });
    expect(ids(result.current)).toEqual([['grafana', false], ['kuma', true]]);
  });

  it('lists frames in first-visit order, so reordering the tabs moves no frame', () => {
    const { result, rerender } = setup([dash, grafana, kuma], 'kuma');
    rerender({ tabs: [dash, grafana, kuma], activeTab: 'grafana' });
    expect(ids(result.current)).toEqual([['kuma', false], ['grafana', true]]);
    rerender({ tabs: [dash, kuma, grafana], activeTab: 'grafana' });
    expect(ids(result.current)).toEqual([['kuma', false], ['grafana', true]]);
  });

  it('unmounts an app whose tab leaves the config, and does not bring it back', () => {
    const { result, rerender } = setup([dash, grafana, kuma], 'grafana');
    rerender({ tabs: [dash, grafana, kuma], activeTab: 'kuma' });
    rerender({ tabs: [dash, kuma], activeTab: 'kuma' });
    expect(ids(result.current)).toEqual([['kuma', true]]);
    // Added again later (same id): mounted again only once it is visited.
    rerender({ tabs: [dash, kuma, grafana], activeTab: 'kuma' });
    expect(ids(result.current)).toEqual([['kuma', true]]);
  });

  it('passes the current tab, so an edited URL reaches the frame', () => {
    const { result, rerender } = setup([dash, grafana], 'grafana');
    const moved = { ...grafana, url: 'https://grafana2.example' };
    rerender({ tabs: [dash, moved], activeTab: 'dashboard' });
    expect(result.current[0].tab).toBe(moved);
  });

  it('never mounts a tab that is not an app', () => {
    const { result } = setup([dash, { id: 'odd', label: 'Odd' }], 'odd');
    expect(result.current).toEqual([]);
  });
});
