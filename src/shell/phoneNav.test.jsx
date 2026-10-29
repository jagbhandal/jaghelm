import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { SHEETS, sheetsOf, usePhoneNav } from './phoneNav.js';

// The phone screens' navigation on the web (#303): the shared nav stack, a
// history entry per detail, under its entity's URL (#309). App.phone.test.jsx
// drives it through the app.

const url = () => window.location.pathname + window.location.search;

describe('sheetsOf', () => {
  it('reads the details a history entry holds, and nothing else', () => {
    expect(sheetsOf(null)).toEqual([]);
    expect(sheetsOf({})).toEqual([]);
    expect(sheetsOf({ [SHEETS]: 'x' })).toEqual([]);
    expect(
      sheetsOf({
        [SHEETS]: [
          { screen: 'node', params: { nodeKey: 'a' } },
          null,
          { params: {} },
          { screen: 'incident' },
        ],
      })
    ).toEqual([
      { screen: 'node', params: { nodeKey: 'a' } },
      { screen: 'incident', params: {} },
    ]);
  });
});

describe('usePhoneNav', () => {
  it('pushes a history entry per detail, under its entity’s URL, keeping the path and what else the entry held', () => {
    window.history.replaceState({ other: 1 }, '', '/services');
    const { result } = renderHook(() => usePhoneNav('services'));
    expect(result.current.details).toEqual([]);
    expect(result.current.canPop).toBe(false);
    const before = window.history.length;
    act(() => result.current.push('serviceDetail', { uid: 'a:b' }));
    expect(result.current.details).toEqual([{ screen: 'serviceDetail', params: { uid: 'a:b' } }]);
    expect(result.current.stack[0]).toEqual({ screen: 'services' });
    expect(window.history.length).toBe(before + 1);
    expect(url()).toBe('/services?entity=services/a:b');
    expect(window.history.state).toEqual({
      other: 1,
      [SHEETS]: [{ screen: 'serviceDetail', params: { uid: 'a:b' } }],
    });

    // A detail from the detail: the stack under it, its own URL.
    act(() => result.current.push('incident', { id: 'power/ups' }));
    expect(url()).toBe('/services?entity=power/ups');
    expect(result.current.details).toEqual([
      { screen: 'serviceDetail', params: { uid: 'a:b' } },
      { screen: 'incident', params: { id: 'power/ups' } },
    ]);
  });

  it('a drive’s alert opens its node with the drive in the URL, and not in the sheet’s params (#728)', () => {
    window.history.replaceState(null, '', '/alerts');
    const { result } = renderHook(() => usePhoneNav('alerts'));
    act(() => result.current.push('node', { nodeKey: 'nas', drive: 'sdb' }));
    expect(url()).toBe('/alerts?entity=nodes/nas&drive=sdb');
    expect(result.current.details).toEqual([{ screen: 'node', params: { nodeKey: 'nas' } }]);
    // Another detail's params never name one.
    act(() => result.current.push('incident', { id: 'power/ups', drive: 'sdb' }));
    expect(url()).toBe('/alerts?entity=power/ups');
  });

  it('follows the entry on Back and Forward (popstate)', () => {
    window.history.replaceState(null, '', '/');
    const { result } = renderHook(() => usePhoneNav('overview'));
    act(() => {
      window.history.replaceState(
        { [SHEETS]: [{ screen: 'node', params: { nodeKey: 'n' } }] },
        '',
        '/?entity=nodes/n'
      );
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.details).toEqual([{ screen: 'node', params: { nodeKey: 'n' } }]);
    act(() => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.details).toEqual([]);
  });

  it('draws the URL’s entity alone when the entry holds no stack for it (a link, a push)', () => {
    window.history.replaceState(null, '', '/?entity=services/apps:jellyfin');
    const { result } = renderHook(() => usePhoneNav('overview'));
    expect(result.current.details).toEqual([
      { screen: 'serviceDetail', params: { uid: 'apps:jellyfin' } },
    ]);
    // A stack for another entity is not this URL's.
    act(() => {
      window.history.replaceState(
        { [SHEETS]: [{ screen: 'node', params: { nodeKey: 'n' } }] },
        '',
        '/?entity=backups/storage:nightly'
      );
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.details).toEqual([
      { screen: 'incident', params: { id: 'backups/storage:nightly' } },
    ]);
  });

  it('closing a detail opened from its URL leaves the tab’s URL, adding no entry', () => {
    window.history.replaceState(null, '', '/alerts?entity=nodes/n');
    const { result } = renderHook(() => usePhoneNav('alerts'));
    expect(result.current.details).toHaveLength(1);
    const before = window.history.length;
    act(() => result.current.pop());
    expect(url()).toBe('/alerts');
    expect(window.history.length).toBe(before);
    expect(result.current.details).toEqual([]);
  });

  it('a new tab starts with what its URL says', () => {
    window.history.replaceState(
      { [SHEETS]: [{ screen: 'node', params: { nodeKey: 'n' } }] },
      '',
      '/?entity=nodes/n'
    );
    const { result, rerender } = renderHook(({ tab }) => usePhoneNav(tab), {
      initialProps: { tab: 'overview' },
    });
    expect(result.current.details).toHaveLength(1);
    window.history.pushState(null, '', '/alerts');
    rerender({ tab: 'alerts' });
    expect(result.current.details).toEqual([]);
    expect(result.current.stack).toEqual([{ screen: 'alerts' }]);
  });
});
