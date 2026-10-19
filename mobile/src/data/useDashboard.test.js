import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { getServices, getUPSStatus, getCronStatus, getDisplayConfig, NOT_MODIFIED_NO_BODY } = vi.hoisted(() => ({
  getServices: vi.fn(),
  getUPSStatus: vi.fn(),
  getCronStatus: vi.fn(),
  getDisplayConfig: vi.fn(),
  NOT_MODIFIED_NO_BODY: Object.freeze({ __jaghelm304NoBody: true }),
}));
vi.mock('@shared/hooks/useData.js', () => ({
  getServices,
  getUPSStatus,
  getCronStatus,
  getDisplayConfig,
  NOT_MODIFIED_NO_BODY,
}));

// @capacitor/app: capture the appStateChange listener so a test can send the app
// to the background and back.
const { addListener, remove, appState } = vi.hoisted(() => ({
  addListener: vi.fn(),
  remove: vi.fn(),
  appState: { listener: null },
}));
vi.mock('@capacitor/app', () => ({ App: { addListener } }));

import { useDashboard } from './useDashboard.js';

const INTERVAL = 30000;
const SERVICES = { nodes: { 'vm-101': { display_name: 'VM 101', metrics: {}, services: [] } } };
const UPS = { status: 1 };
const CRON = [];

// Let resolved fetches land and React commit, without moving the clock.
const flush = () => act(async () => {
  await vi.advanceTimersByTimeAsync(0);
});
const advance = (ms) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms);
});
const setAppActive = (isActive) => act(async () => {
  appState.listener({ isActive });
  await vi.advanceTimersByTimeAsync(0);
});

// Mirrors useData.js: a 304 hands back the SAME reference as the last 200.
beforeEach(() => {
  vi.clearAllMocks(); // call counts are asserted; start each test from zero
  vi.useFakeTimers();
  getServices.mockResolvedValue(SERVICES);
  getUPSStatus.mockResolvedValue(UPS);
  getCronStatus.mockResolvedValue(CRON);
  // Real /api/display-config shape: top-level integer refreshInterval (seconds).
  getDisplayConfig.mockResolvedValue({ refreshInterval: 30 });
  appState.listener = null;
  addListener.mockImplementation((event, fn) => {
    if (event === 'appStateChange') appState.listener = fn;
    return Promise.resolve({ remove });
  });
});
afterEach(() => {
  vi.useRealTimers();
});

async function mount() {
  let renders = 0;
  const hook = renderHook(() => {
    renders += 1;
    return useDashboard();
  });
  await flush();
  return { ...hook, renders: () => renders };
}

describe('useDashboard: load and shape', () => {
  it('loads all three sources and exposes the bodies', async () => {
    const { result, unmount } = renderHook(() => useDashboard());
    expect(result.current.loading).toBe(true);
    await flush();
    expect(result.current.loading).toBe(false);
    expect(result.current.servicesBody.nodes['vm-101'].display_name).toBe('VM 101');
    expect(result.current.ups.status).toBe(1);
    expect(result.current.error).toBeNull();
    unmount();
  });

  it('surfaces an error when the primary services fetch throws', async () => {
    getServices.mockRejectedValue(new Error('HTTP 500'));
    const { result, unmount } = await mount();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeTruthy();
    expect(result.current.lastUpdated).toBeNull();
    unmount();
  });

  it('stamps lastUpdated when a round lands', async () => {
    const { result, unmount } = await mount();
    expect(result.current.lastUpdated).toBe(Date.now());
    unmount();
  });

  it('fetches every source in full on the first load', async () => {
    const { unmount } = await mount();
    expect(getServices).toHaveBeenCalledTimes(1);
    expect(getServices).toHaveBeenCalledWith(true);
    expect(getUPSStatus).toHaveBeenCalledWith(true);
    expect(getCronStatus).toHaveBeenCalledWith(true);
    unmount();
  });
});

describe('useDashboard: cadence', () => {
  it('syncs the refresh cadence to the display-config refreshInterval', async () => {
    getDisplayConfig.mockResolvedValue({ refreshInterval: 45 });
    const { result, unmount } = await mount();
    expect(result.current.intervalMs).toBe(45000);
    await advance(INTERVAL);
    expect(getServices).toHaveBeenCalledTimes(1); // not on the 30 s default
    await advance(15000);
    expect(getServices).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('falls back to the default cadence when display-config is unreadable', async () => {
    getDisplayConfig.mockRejectedValue(new Error('no config'));
    const { result, unmount } = await mount();
    expect(result.current.intervalMs).toBe(INTERVAL);
    await advance(INTERVAL);
    expect(getServices).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('never polls faster than the 5 s floor', async () => {
    getDisplayConfig.mockResolvedValue({ refreshInterval: 1 });
    const { result, unmount } = await mount();
    expect(result.current.intervalMs).toBe(5000);
    unmount();
  });

  it('arms the next poll one interval after a round LANDS, so "next in Ys" is true', async () => {
    getServices.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(SERVICES), 5000))
    );
    const start = Date.now();
    const { result, unmount } = await mount();
    await advance(5000);
    expect(result.current.lastUpdated).toBe(start + 5000);
    await advance(INTERVAL - 1);
    expect(getServices).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(getServices).toHaveBeenCalledTimes(2);
    unmount();
  });
});

describe('useDashboard: conditional polls (ETag / 304)', () => {
  it('polls after the first load send If-None-Match (skipEtag=false)', async () => {
    const { unmount } = await mount();
    await advance(INTERVAL);
    expect(getServices).toHaveBeenCalledTimes(2);
    expect(getServices).toHaveBeenLastCalledWith(false);
    expect(getUPSStatus).toHaveBeenLastCalledWith(false);
    // /cron/status has no ETag; a scheduled poll is a plain GET the server's
    // max-age may answer from cache.
    expect(getCronStatus).toHaveBeenLastCalledWith(false);
    unmount();
  });

  it('a 304 poll keeps the same data and costs one render (the clock), not a data change', async () => {
    const { result, renders, unmount } = await mount();
    const before = { s: result.current.servicesBody, u: result.current.ups, c: result.current.cron };
    const stampedAt = result.current.lastUpdated;
    const rendersBefore = renders();

    await advance(INTERVAL);

    expect(getServices).toHaveBeenCalledTimes(2);
    expect(result.current.servicesBody).toBe(before.s);
    expect(result.current.ups).toBe(before.u);
    expect(result.current.cron).toBe(before.c);
    expect(result.current.error).toBeNull();
    // The server confirmed the data is current, so the clock moves.
    expect(result.current.lastUpdated).toBe(stampedAt + INTERVAL);
    expect(renders() - rendersBefore).toBe(1);
    unmount();
  });

  it('a 304 with no cached body (cold-start sentinel) keeps the data and counts as success', async () => {
    const { result, unmount } = await mount();
    const body = result.current.servicesBody;
    getServices.mockResolvedValue(NOT_MODIFIED_NO_BODY);
    getUPSStatus.mockResolvedValue(NOT_MODIFIED_NO_BODY);
    getCronStatus.mockResolvedValue(NOT_MODIFIED_NO_BODY);
    await advance(INTERVAL);
    expect(result.current.servicesBody).toBe(body);
    expect(result.current.ups).toBe(UPS);
    expect(result.current.cron).toBe(CRON);
    expect(result.current.error).toBeNull();
    expect(result.current.lastUpdated).toBe(Date.now());
    unmount();
  });

  it('a changed body (200) replaces the data', async () => {
    const { result, unmount } = await mount();
    const next = { nodes: {} };
    getServices.mockResolvedValue(next);
    await advance(INTERVAL);
    expect(result.current.servicesBody).toBe(next);
    unmount();
  });

  it('a failed poll keeps the data and does NOT move the clock', async () => {
    const { result, unmount } = await mount();
    const stampedAt = result.current.lastUpdated;
    getServices.mockRejectedValue(new Error('HTTP 502'));
    await advance(INTERVAL);
    expect(result.current.error).toBeTruthy();
    expect(result.current.servicesBody).toBe(SERVICES);
    expect(result.current.lastUpdated).toBe(stampedAt);
    unmount();
  });

  it('a failed side source keeps its last value', async () => {
    const { result, unmount } = await mount();
    getUPSStatus.mockRejectedValue(new Error('HTTP 500'));
    getCronStatus.mockRejectedValue(new Error('HTTP 500'));
    await advance(INTERVAL);
    expect(result.current.ups).toBe(UPS);
    expect(result.current.cron).toBe(CRON);
    expect(result.current.error).toBeNull();
    unmount();
  });

  it('a tap refresh forces a full fetch past any cache', async () => {
    const { result, unmount } = await mount();
    await act(async () => {
      await result.current.refresh();
    });
    expect(getServices).toHaveBeenCalledTimes(2);
    expect(getServices).toHaveBeenLastCalledWith(true);
    expect(getUPSStatus).toHaveBeenLastCalledWith(true);
    expect(getCronStatus).toHaveBeenLastCalledWith(true);
    unmount();
  });
});

describe('useDashboard: background and foreground (appStateChange)', () => {
  it('listens for appStateChange', async () => {
    const { unmount } = await mount();
    expect(addListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));
    unmount();
  });

  it('stops polling in the background: no fetch and no timer left', async () => {
    const { unmount } = await mount();
    await setAppActive(false);
    expect(vi.getTimerCount()).toBe(0);
    await advance(INTERVAL * 10);
    expect(getServices).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('refreshes at once on return, conditionally, with cron fetched past the cache', async () => {
    const { result, unmount } = await mount();
    await setAppActive(false);
    await advance(5 * 60 * 1000);
    await setAppActive(true);
    expect(getServices).toHaveBeenCalledTimes(2);
    expect(getServices).toHaveBeenLastCalledWith(false);
    expect(getUPSStatus).toHaveBeenLastCalledWith(false);
    // cron's max-age=60 copy could be minutes old after a trip to the background.
    expect(getCronStatus).toHaveBeenLastCalledWith(true);
    expect(result.current.lastUpdated).toBe(Date.now());
    unmount();
  });

  it('resumes the cadence from the return refresh', async () => {
    const { unmount } = await mount();
    await advance(10000);
    await setAppActive(false);
    await advance(60000);
    await setAppActive(true);
    expect(getServices).toHaveBeenCalledTimes(2);
    await advance(INTERVAL - 1);
    expect(getServices).toHaveBeenCalledTimes(2); // no stale timer from before the trip
    await advance(1);
    expect(getServices).toHaveBeenCalledTimes(3);
    expect(getServices).toHaveBeenLastCalledWith(false);
    unmount();
  });

  it('no double fetch on return: repeated foreground events run one round', async () => {
    const { unmount } = await mount();
    await setAppActive(false);
    await act(async () => {
      appState.listener({ isActive: true });
      appState.listener({ isActive: true });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getServices).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('exposes foreground from the same event, for the status bar countdown', async () => {
    const { result, unmount } = await mount();
    expect(result.current.foreground).toBe(true);
    await setAppActive(false);
    expect(result.current.foreground).toBe(false);
    await setAppActive(true);
    expect(result.current.foreground).toBe(true);
    unmount();
  });

  it('a foreground event while already polling fetches nothing', async () => {
    const { unmount } = await mount();
    await setAppActive(true);
    expect(getServices).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('unmount stops the timer and removes the listener', async () => {
    const { unmount } = await mount();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    await flush();
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledTimes(1);
    await advance(INTERVAL * 3);
    expect(getServices).toHaveBeenCalledTimes(1);
  });

  it('a round landing after unmount changes nothing and arms nothing', async () => {
    let resolveLate;
    getServices.mockImplementationOnce(() => new Promise((resolve) => (resolveLate = resolve)));
    const { result, unmount } = renderHook(() => useDashboard());
    unmount();
    await act(async () => {
      resolveLate(SERVICES);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.servicesBody).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
