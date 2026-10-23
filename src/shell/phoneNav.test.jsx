import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { SHEETS, sheetsOf, usePhoneNav } from './phoneNav.js';

// The phone screens' navigation on the web (#303): the shared nav stack, a
// history entry per detail. App.phone.test.jsx drives it through the app.

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
  it('pushes a history entry per detail, keeping the URL and what else the entry held', () => {
    window.history.replaceState({ other: 1 }, '', '/services');
    const { result } = renderHook(() => usePhoneNav('services'));
    expect(result.current.details).toEqual([]);
    expect(result.current.canPop).toBe(false);
    const before = window.history.length;
    act(() => result.current.push('serviceDetail', { uid: 'a:b' }));
    expect(result.current.details).toEqual([{ screen: 'serviceDetail', params: { uid: 'a:b' } }]);
    expect(result.current.stack[0]).toEqual({ screen: 'services' });
    expect(window.history.length).toBe(before + 1);
    expect(window.location.pathname).toBe('/services');
    expect(window.history.state).toEqual({
      other: 1,
      [SHEETS]: [{ screen: 'serviceDetail', params: { uid: 'a:b' } }],
    });
  });

  it('follows the entry on Back and Forward (popstate)', () => {
    window.history.replaceState(null, '', '/');
    const { result } = renderHook(() => usePhoneNav('overview'));
    act(() => {
      window.history.replaceState({ [SHEETS]: [{ screen: 'node', params: { nodeKey: 'n' } }] }, '');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.details).toEqual([{ screen: 'node', params: { nodeKey: 'n' } }]);
    act(() => {
      window.history.replaceState(null, '');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.details).toEqual([]);
  });

  it('a new tab starts with no detail over it', () => {
    window.history.replaceState({ [SHEETS]: [{ screen: 'node', params: {} }] }, '', '/');
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
