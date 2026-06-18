import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useDashboardData } from './useDashboardData';

// The 304-stable-identity contract: a refresh tick that produces an all-304
// /api/services response must return the SAME object reference as the prior 200,
// so setState bails via Object.is and the DashboardView subtree does not
// re-render. This test stubs fetch to answer 200-then-304 for /api/services and
// asserts the hook's serviceData reference is stable across the 304 tick.
//
// NOTE: useData.js keeps a module-level etagStore/resultStore keyed by URL. The
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
