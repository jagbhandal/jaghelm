import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useDashboardData } from './useDashboardData.js';
import { staleAfterMs } from './freshness.js';

// The 304-stable-identity contract: a refresh tick that produces an all-304
// /api/services response must return the SAME object reference as the prior 200,
// so setState bails via Object.is and the Overview's sections do not
// re-render (#252). This test stubs fetch to answer 200-then-304 for /api/services and
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
        // The other endpoints (integrations, history): inert empties so the
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

    expect(Object.keys(result.current.sources)).toEqual(['services', 'integrations']);
    for (const key of ['services', 'integrations']) {
      expect(result.current.sources).toHaveProperty(key);
      expect(result.current.sources[key]).toEqual({ error: null, staleNote: null });
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
    expect(result.current.sources.integrations.error).toBeNull();
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

describe('useDashboardData — polling schedule', () => {
  // What the old board read beside these (/api/ups, /api/cron/status,
  // /api/gitea/activity) went with it (#306).
  const SOURCE_PATHS = ['/api/services', '/api/integrations', '/api/history'];
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

  it('a tick reads services and integrations, and history on ticks 1, 4, 7 … only (tickBudget.js)', async () => {
    const { rerender } = render();
    await settle();
    expect(take()).toEqual([...SOURCE_PATHS].sort());

    const seen = [];
    for (let tick = 1; tick <= 6; tick++) {
      rerender({ refreshKey: 0, tick, active: true });
      await settle();
      const got = take();
      expect(got).toEqual(expect.arrayContaining(['/api/services', '/api/integrations']));
      seen.push(got.includes('/api/history'));
      // At most 3: the status poll makes the tick's 4th, and the rail's
      // Pipeline takes ticks history leaves (2, 5 …).
      expect(got.length).toBeLessThanOrEqual(3);
    }
    expect(seen).toEqual([true, false, false, true, false, false]);
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

  it('back from another page after a long while, the tab showing: no stale notes in its first render', async () => {
    // The clock's timers run (they wake the hook at each boundary); fetch
    // promises and act() still run as they do.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000_000_000);
      const { result, rerender } = render();
      await settle();
      // Another page: the board asks nothing, and the tab is showing.
      rerender({ refreshKey: 0, tick: 0, active: false });
      await settle();

      // Five minutes away, far past every source's stale boundary.
      act(() => {
        vi.advanceTimersByTime(5 * 60_000);
      });
      rerender({ refreshKey: 0, tick: 0, active: true });
      // The resume render itself, before its refresh lands.
      for (const key of ['services', 'integrations'])
        expect(result.current.sources[key].staleNote, key).toBeNull();
      await settle();
    } finally {
      vi.useRealTimers();
    }
  });
});

// The rule is the header's (freshness.js, #559): two polls and the request
// timeout. Every source the Overview reads polls each tick, so it goes stale
// that long after its last answer: 72 s at the default 30 s interval.
describe('useDashboardData — stale boundary follows the refresh interval', () => {
  beforeEach(() => {
    if (!AbortSignal.timeout) {
      AbortSignal.timeout = () => new AbortController().signal;
    }
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('goes stale 72 s after its last answer at the default 30 s interval, 132 s at 60 s', async () => {
    for (const intervalMs of [30_000, 60_000]) {
      let answering = true;
      vi.stubGlobal(
        'fetch',
        vi.fn((url) =>
          answering
            ? Promise.resolve(jsonResponse(String(url) === '/api/services' ? { nodes: {} } : {}))
            : new Promise(() => {})
        )
      );
      const { result, unmount } = renderHook(() =>
        useDashboardData(0, { tick: 0, active: true, refreshIntervalMs: intervalMs })
      );
      await act(async () => {});
      answering = false;
      const notes = () =>
        ['services', 'integrations'].map((k) => result.current.sources[k].staleNote);
      act(() => {
        vi.advanceTimersByTime(staleAfterMs(intervalMs) - 1);
      });
      expect(notes(), `${intervalMs} ms`).toEqual([null, null]);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      const said = intervalMs === 30_000 ? 'updated 1m ago' : 'updated 2m ago';
      expect(notes(), `${intervalMs} ms`).toEqual([said, said]);
      unmount();
    }
  });
});

// A source that answers every poll never reads stale (#545): each judgement
// reads its last answer then, on the one clock. When the answers were read on
// a separate 15 s clock, at a 2 s interval a source that answered 2 s ago
// could read "updated 4s ago" until the next 15 s step.
describe('useDashboardData — no stale note on a source that answers every poll (#545)', () => {
  const INTERVAL = 2000;
  const KEYS = ['services', 'integrations'];
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
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const settle = () => act(async () => {});
  const notesOf = ({ sources }) =>
    KEYS.map((key) => [key, sources[key].staleNote]).filter(([, note]) => note !== null);

  it('at a 2 s interval, wherever the clock falls against the load', async () => {
    const seen = [];
    // Every phase a quarter second apart, over the old 15 s clock.
    for (let offset = 0; offset < 15_000; offset += 250) {
      vi.setSystemTime(BASE + offset);
      const { result, rerender, unmount } = renderHook(
        ({ tick }) => useDashboardData(0, { tick, active: true, refreshIntervalMs: INTERVAL }),
        { initialProps: { tick: 0 } }
      );
      await settle();
      for (let tick = 1; tick <= 8; tick++) {
        act(() => {
          vi.advanceTimersByTime(INTERVAL);
        });
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

  it('still notes a source that stops answering, once two of its polls and the request timeout have gone by', async () => {
    vi.setSystemTime(BASE + 300);
    const { result, rerender } = renderHook(
      ({ tick }) => useDashboardData(0, { tick, active: true, refreshIntervalMs: INTERVAL }),
      { initialProps: { tick: 0 } }
    );
    await settle();
    // /api/integrations stops answering from here: each poll fails.
    fetch.mockImplementation((url) =>
      String(url) === '/api/integrations'
        ? Promise.reject(new Error('down'))
        : Promise.resolve(jsonResponse(String(url) === '/api/services' ? { nodes: {} } : {}))
    );
    const failingNote = () => result.current.sources.integrations.staleNote;
    // 16 s at a 2 s interval: 7 polls failed, and the eighth's timeout.
    const staleAfter = staleAfterMs(INTERVAL);
    for (let tick = 1; tick < staleAfter / INTERVAL; tick++) {
      act(() => {
        vi.advanceTimersByTime(INTERVAL);
      });
      rerender({ tick });
      await settle();
      expect(failingNote(), `tick ${tick}`).toBeNull();
      expect(result.current.sources.integrations.error).toBe('down');
    }
    act(() => {
      vi.advanceTimersByTime(INTERVAL);
    });
    // At the boundary, by the clock, not by the next tick.
    expect(failingNote()).toBe('updated 16s ago');
    expect(result.current.sources.services.staleNote).toBeNull();
  });

  it('a note’s age moves on the one clock while it shows, with no tick', async () => {
    vi.setSystemTime(BASE);
    const { result } = renderHook(() =>
      useDashboardData(0, { tick: 0, active: true, refreshIntervalMs: INTERVAL })
    );
    await settle();
    act(() => {
      vi.advanceTimersByTime(staleAfterMs(INTERVAL));
    });
    expect(result.current.sources.services.staleNote).toBe('updated 16s ago');
    act(() => {
      vi.advanceTimersByTime(50_000);
    });
    expect(result.current.sources.services.staleNote).toBe('updated 1m ago');
  });

  it('clears a stale note the moment its source answers again, a 304 too; a healthy 304 tick draws nothing', async () => {
    // 200 with an ETag at load, then 304 to every request that sends it back.
    fetch.mockImplementation((url, opts) =>
      Promise.resolve(
        opts?.headers?.['If-None-Match']
          ? jsonResponse(null, { status: 304 })
          : jsonResponse(String(url) === '/api/services' ? { nodes: {} } : {}, { etag: 'W/"1"' })
      )
    );
    const T0 = BASE;
    vi.setSystemTime(T0);
    let renders = 0;
    const { result, rerender } = renderHook(
      ({ tick }) => {
        renders += 1;
        return useDashboardData(0, { tick, active: true, refreshIntervalMs: INTERVAL });
      },
      { initialProps: { tick: 0 } }
    );
    await settle();
    const note = () => result.current.sources.services.staleNote;

    // A healthy tick whose answers are all 304s: its own render, nothing more.
    act(() => {
      vi.advanceTimersByTime(INTERVAL);
    });
    rerender({ tick: 1 });
    const afterTick = renders;
    await settle();
    expect(renders).toBe(afterTick);
    expect(note()).toBeNull();

    // The laptop slept 5 minutes: no visibilitychange, the board still
    // active. Waking, the timers held over fire.
    vi.setSystemTime(T0 + INTERVAL + 5 * 60_000);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(note()).toBe('updated 5m ago');
    rerender({ tick: 2 }); // the tick's render, before its answers
    expect(note()).toBe('updated 5m ago');
    await settle(); // its answers: 304s, no new data
    expect(note()).toBeNull();
  });
});

describe('useDashboardData — only some sources (#303)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads only the sources asked for, each on every refresh', async () => {
    if (!AbortSignal.timeout) AbortSignal.timeout = () => new AbortController().signal;
    const asked = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        asked.push(String(url).split('?')[0]);
        return Promise.resolve(jsonResponse({ nodes: {} }, {}));
      })
    );
    const { result, rerender } = renderHook(
      ({ tick }) => useDashboardData(0, { tick, only: ['services', 'history'] }),
      { initialProps: { tick: 0 } }
    );
    await waitFor(() => expect(result.current.servicesLoaded).toBe(true));
    expect([...new Set(asked)].sort()).toEqual(['/api/history', '/api/services']);
    // A scheduled tick, one history would skip: the same two, every tick.
    for (const tick of [2, 3]) {
      asked.length = 0;
      rerender({ tick });
      await waitFor(() => expect(asked).toHaveLength(2));
      expect(asked.sort()).toEqual(['/api/history', '/api/services']);
    }
  });
});
