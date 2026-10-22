import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useDashboardData, pollPeriodMs } from './useDashboardData';
import { sourceBanner } from './sourceHealth';

// The 304-stable-identity contract: a refresh tick that produces an all-304
// /api/services response must return the SAME object reference as the prior 200,
// so setState bails via Object.is and the DashboardView subtree does not
// re-render. This test stubs fetch to answer 200-then-304 for /api/services and
// asserts the hook's serviceData reference is stable across the 304 tick.
//
// NOTE: useData.js keeps a module-level map of { etag, body } keyed by URL. The
// first request the hook makes is skipEtag (no If-None-Match), which the stub
// answers 200; later requests carry If-None-Match and get 304.

function jsonResponse(body, { status = 200, etag = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === 'etag' ? etag : null) },
    json: () => Promise.resolve(body),
  };
}

describe('useDashboardData — 304 stable identity', () => {
  let callCount;

  beforeEach(() => {
    callCount = 0;
    // AbortSignal.timeout is used by fetchJson; jsdom may lack it.
    if (!AbortSignal.timeout) {
      AbortSignal.timeout = () => new AbortController().signal;
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the same serviceData reference across a 304 refresh', async () => {
    const servicesBody = { nodes: { prod: { display_name: 'Prod', services: [] } } };

    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        const u = String(url);
        if (u.includes('/api/services') && !u.includes('/api/services/')) {
          callCount += 1;
          // First call (skipEtag, no If-None-Match): full 200 with an ETag.
          // Subsequent calls: 304 Not Modified.
          if (callCount === 1) {
            return Promise.resolve(jsonResponse(servicesBody, { etag: 'W/"v1"' }));
          }
          return Promise.resolve(jsonResponse(null, { status: 304 }));
        }
        // All other endpoints (ups/gitea/cron/integrations): inert empties so the
        // hook's other fetches settle without affecting the services identity test.
        return Promise.resolve(jsonResponse({}, {}));
      })
    );

    const { result, rerender } = renderHook(({ key }) => useDashboardData(key), {
      initialProps: { key: 0 },
    });

    // Wait for the first (200) load to populate serviceData with the body.
    await waitFor(() => {
      expect(result.current.serviceData.nodes).toHaveProperty('prod');
    });

    const firstRef = result.current.serviceData;
    expect(firstRef).toEqual(servicesBody);

    // Tick the refresh: this request carries If-None-Match → our stub returns 304,
    // and getServices returns the SAME reference the prior 200 produced.
    rerender({ key: 1 });

    // Let the 304 fetch settle.
    await waitFor(() => {
      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    // The reference must be identical — Object.is(firstRef, current) === true.
    // This is the load-bearing guarantee the refactor must not break.
    expect(result.current.serviceData).toBe(firstRef);
  });
});

describe('useDashboardData — per-source health + retry', () => {
  beforeEach(() => {
    if (!AbortSignal.timeout) {
      AbortSignal.timeout = () => new AbortController().signal;
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes a sources health map with an entry per source', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({}, {})))
    );
    const { result } = renderHook(() => useDashboardData(0));

    await waitFor(() => {
      expect(result.current.servicesLoaded).toBe(true);
    });

    for (const key of ['services', 'ups', 'commits', 'cron', 'integrations']) {
      expect(result.current.sources).toHaveProperty(key);
      expect(result.current.sources[key]).toHaveProperty('error');
      expect(result.current.sources[key]).toHaveProperty('lastSuccessMs');
    }
  });

  it('records a per-source error when /api/services fails (naming carries the cause upstream)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        const u = String(url);
        if (u.includes('/api/services') && !u.includes('/api/services/')) {
          return Promise.reject(new Error('Network down'));
        }
        return Promise.resolve(jsonResponse({}, {}));
      })
    );

    const { result } = renderHook(() => useDashboardData(0));

    await waitFor(() => {
      expect(result.current.sources.services.error).toBeTruthy();
    });
    // Other sources stay healthy — failure is isolated to the source that failed.
    expect(result.current.sources.ups.error).toBeNull();
  });

  it('retry() forces a full re-fetch (skips ETags) and is a stable callback', async () => {
    const headers = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url, opts) => {
        const u = String(url);
        if (u.includes('/api/services') && !u.includes('/api/services/')) {
          headers.push(opts?.headers?.['If-None-Match'] ?? null);
          return Promise.resolve(jsonResponse({ nodes: {} }, { etag: 'W/"v1"' }));
        }
        return Promise.resolve(jsonResponse({}, {}));
      })
    );

    const { result } = renderHook(() => useDashboardData(0));

    await waitFor(() => expect(result.current.servicesLoaded).toBe(true));
    const firstRetry = result.current.retry;
    const callsBefore = headers.length;

    // Trigger a user retry.
    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(headers.length).toBeGreaterThan(callsBefore));

    // The retry-driven fetch must NOT carry If-None-Match — it's a forced full fetch.
    expect(headers[headers.length - 1]).toBeNull();
    // retry identity is stable across renders (safe to use in deps / memo lists).
    expect(result.current.retry).toBe(firstRetry);
  });
});

describe('useDashboardData — settled (#302)', () => {
  beforeEach(() => {
    if (!AbortSignal.timeout) {
      AbortSignal.timeout = () => new AbortController().signal;
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is false until every source has answered or failed once, then stays true', async () => {
    let failCron;
    vi.stubGlobal(
      'fetch',
      vi.fn((url) =>
        String(url).includes('/api/cron/')
          ? new Promise((_, reject) => {
              failCron = () => reject(new Error('Network down'));
            })
          : Promise.resolve(jsonResponse({}, {}))
      )
    );
    const { result, rerender } = renderHook(({ tick }) => useDashboardData(0, { tick }), {
      initialProps: { tick: 0 },
    });
    await waitFor(() => expect(result.current.servicesLoaded).toBe(true));
    // Every other source has answered by now; cron hasn't.
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(result.current.settled).toBe(false);

    // The slow source fails: it has answered, as a failure.
    await act(async () => failCron());
    expect(result.current.settled).toBe(true);
    rerender({ tick: 1 });
    expect(result.current.settled).toBe(true);
  });
});

describe('useDashboardData — polling schedule', () => {
  const SOURCE_PATHS = [
    '/api/services',
    '/api/ups',
    '/api/integrations',
    '/api/history',
    '/api/cron/status',
    '/api/gitea/activity',
  ];
  let paths;

  beforeEach(() => {
    if (!AbortSignal.timeout) {
      AbortSignal.timeout = () => new AbortController().signal;
    }
    paths = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        paths.push(String(url));
        if (String(url) === '/api/services') {
          return Promise.resolve(jsonResponse({ nodes: {}, overallHealth: 'down' }));
        }
        return Promise.resolve(jsonResponse({}, {}));
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const render = (props) =>
    renderHook(({ refreshKey, tick, active }) => useDashboardData(refreshKey, { tick, active }), {
      initialProps: { refreshKey: 0, tick: 0, active: true, ...props },
    });
  const settle = () => act(async () => {});
  const take = () => paths.splice(0).sort();

  it('a tick fetches the live sources plus one slow source, each slow one in turn', async () => {
    const { rerender } = render();
    await settle();
    expect(take()).toEqual([...SOURCE_PATHS].sort());

    const slowSeen = [];
    for (let tick = 1; tick <= 3; tick++) {
      rerender({ refreshKey: 0, tick, active: true });
      await settle();
      const got = take();
      expect(got).toHaveLength(4);
      expect(got).toEqual(
        expect.arrayContaining(['/api/services', '/api/ups', '/api/integrations'])
      );
      slowSeen.push(
        got.find((p) => ['/api/history', '/api/cron/status', '/api/gitea/activity'].includes(p))
      );
    }
    expect(slowSeen).toEqual(['/api/history', '/api/cron/status', '/api/gitea/activity']);
  });

  it('a manual refresh (refreshKey) fetches every source', async () => {
    const { rerender } = render();
    await settle();
    take();
    rerender({ refreshKey: 1, tick: 0, active: true });
    await settle();
    expect(take()).toEqual([...SOURCE_PATHS].sort());
  });

  it('fetches nothing while inactive, then every source at once on resume', async () => {
    const { rerender } = render();
    await settle();
    take();
    rerender({ refreshKey: 0, tick: 0, active: false });
    await settle();
    expect(take()).toEqual([]);

    rerender({ refreshKey: 0, tick: 0, active: true });
    await settle();
    expect(take()).toEqual([...SOURCE_PATHS].sort());
  });

  it('makes no request at all when mounted inactive (a tab opened in the background)', async () => {
    const { rerender } = render({ active: false });
    await settle();
    expect(take()).toEqual([]);
    rerender({ refreshKey: 0, tick: 0, active: true });
    await settle();
    expect(take()).toEqual([...SOURCE_PATHS].sort());
  });

  it('shows no stale notes on the first render back after a long pause', async () => {
    // Only Date is faked, so fetch promises and act() still run normally.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const T0 = 1_000_000_000_000;
      vi.setSystemTime(T0);
      const { result, rerender } = render();
      await settle();
      rerender({ refreshKey: 0, tick: 0, active: false });
      await settle();

      // Five minutes away, far past every source's stale threshold.
      vi.setSystemTime(T0 + 5 * 60_000);
      rerender({ refreshKey: 0, tick: 0, active: true });
      // The resume render itself, before its refresh lands.
      const { sources } = result.current;
      for (const key of ['services', 'ups', 'commits', 'cron', 'integrations']) {
        const { staleNote } = sourceBanner(
          sources[key],
          key,
          pollPeriodMs(key, 30_000),
          Date.now()
        );
        expect(staleNote, key).toBeNull();
      }
      await settle();
    } finally {
      vi.useRealTimers();
    }
  });
});

// The stale rule is "2 missed polls of that source", built on the hook's own poll
// period (pollPeriodMs reads the slow-source rotation), so it can't drift from
// the schedule.
describe("useDashboardData — stale threshold follows each source's poll period", () => {
  const NOW = 1_000_000_000_000;
  const staleAt = (key, intervalMs, ageMs) =>
    sourceBanner(
      { error: null, lastSuccessMs: NOW - ageMs, watchedSinceMs: null },
      key,
      pollPeriodMs(key, intervalMs),
      NOW
    ).staleNote !== null;

  it('history, cron and Gitea go stale after 3 minutes at the default 30 s interval', () => {
    for (const key of ['history', 'cron', 'commits']) {
      expect(pollPeriodMs(key, 30_000), key).toBe(90_000);
      expect(staleAt(key, 30_000, 180_000), key).toBe(false);
      expect(staleAt(key, 30_000, 181_000), key).toBe(true);
    }
  });

  it('live sources go stale after 1 minute at the default 30 s interval', () => {
    for (const key of ['services', 'ups', 'integrations']) {
      expect(staleAt(key, 30_000, 60_000), key).toBe(false);
      expect(staleAt(key, 30_000, 61_000), key).toBe(true);
    }
  });

  it('moves with the refresh interval (60 s: 6 minutes for slow sources, 2 for live)', () => {
    expect(staleAt('cron', 60_000, 360_000)).toBe(false);
    expect(staleAt('cron', 60_000, 361_000)).toBe(true);
    expect(staleAt('commits', 60_000, 361_000)).toBe(true);
    expect(staleAt('services', 60_000, 120_000)).toBe(false);
    expect(staleAt('services', 60_000, 121_000)).toBe(true);
  });
});

// A source that answers every poll never reads stale (#545). The banners are
// judged at `healthNow`, on the clock `sources` read the last answers on. When
// the answers were read on a separate 15 s clock, at a 2 s interval a source
// that answered 2 s ago could read "updated 4s ago" until the next 15 s step.
describe('useDashboardData — no stale note on a source that answers every poll (#545)', () => {
  const INTERVAL = 2000;
  const KEYS = ['services', 'ups', 'commits', 'cron', 'integrations'];
  // A whole number of 15 s steps after the epoch, so `offset` is the phase.
  const BASE = 15_000 * 66_666_667;

  beforeEach(() => {
    if (!AbortSignal.timeout) {
      AbortSignal.timeout = () => new AbortController().signal;
    }
    vi.stubGlobal(
      'fetch',
      vi.fn((url) =>
        Promise.resolve(jsonResponse(String(url) === '/api/services' ? { nodes: {} } : {}))
      )
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const settle = () => act(async () => {});
  const notesOf = ({ sources, healthNow }) =>
    KEYS.map((key) => [
      key,
      sourceBanner(sources[key], key, pollPeriodMs(key, INTERVAL), healthNow).staleNote,
    ]).filter(([, note]) => note !== null);

  it('at a 2 s interval, wherever the clock falls against the load', async () => {
    // Only Date is faked, so fetch promises and act() still run normally.
    vi.useFakeTimers({ toFake: ['Date'] });
    const seen = [];
    // Every phase a quarter second apart, over the old 15 s clock.
    for (let offset = 0; offset < 15_000; offset += 250) {
      const T0 = BASE + offset;
      vi.setSystemTime(T0);
      const { result, rerender, unmount } = renderHook(
        ({ tick }) => useDashboardData(0, { tick, active: true, refreshIntervalMs: INTERVAL }),
        { initialProps: { tick: 0 } }
      );
      await settle();
      for (let tick = 1; tick <= 8; tick++) {
        vi.setSystemTime(T0 + tick * INTERVAL);
        rerender({ tick }); // the tick's render, before its answers
        for (const [key, note] of notesOf(result.current))
          seen.push(`+${offset} ms, tick ${tick}: ${key} ${note}`);
        await settle(); // its answers
        for (const [key, note] of notesOf(result.current))
          seen.push(`+${offset} ms, tick ${tick} answered: ${key} ${note}`);
      }
      unmount();
    }
    expect(seen).toEqual([]);
  });

  it('still notes a source that stops answering, once 2 of its polls have gone by', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const T0 = BASE + 300;
    vi.setSystemTime(T0);
    const { result, rerender } = renderHook(
      ({ tick }) => useDashboardData(0, { tick, active: true, refreshIntervalMs: INTERVAL }),
      { initialProps: { tick: 0 } }
    );
    await settle();
    // /api/ups stops answering from here: each poll fails.
    fetch.mockImplementation((url) =>
      String(url) === '/api/ups'
        ? Promise.reject(new Error('down'))
        : Promise.resolve(jsonResponse(String(url) === '/api/services' ? { nodes: {} } : {}))
    );
    const upsNote = () =>
      sourceBanner(result.current.sources.ups, 'ups', INTERVAL, result.current.healthNow).staleNote;
    for (let tick = 1; tick <= 2; tick++) {
      vi.setSystemTime(T0 + tick * INTERVAL);
      rerender({ tick });
      await settle();
      expect(upsNote(), `tick ${tick}`).toBeNull();
    }
    vi.setSystemTime(T0 + 3 * INTERVAL);
    rerender({ tick: 3 });
    await settle();
    // 5.7 s silent at the step's start: 3 polls due, 2 missed.
    expect(upsNote()).toBe('updated 5s ago');
  });
});
