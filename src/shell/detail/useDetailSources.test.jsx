import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDetailSources } from './useDetailSources.js';

// The detail's reads (#310): as it opens, again on each answer of the status
// poll while open, and none while closed. Each answer is a tick of the
// header's poll (useStatus's `updated` store).

function respond(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  });
}

/** A status poll's clock: `tick()` is one answer. */
function clock() {
  const listeners = new Set();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => 0,
    tick: () => [...listeners].forEach((l) => l()),
    listening: () => listeners.size,
  };
}

const asked = (path) =>
  vi.mocked(fetch).mock.calls.filter(([u]) => String(u).startsWith(path)).length;

let ups;
beforeEach(() => {
  localStorage.setItem('jaghelm-token', 'tok');
  ups = { status: 1, charge: 100, load: 18 };
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const path = String(url).split('?')[0];
      if (path === '/api/ups') return ups instanceof Error ? Promise.reject(ups) : respond(ups);
      if (path === '/api/integrations') return respond({ proxmox: { _preset: 'proxmox' } });
      if (path === '/api/services') return respond({ nodes: {} });
      return respond({});
    })
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('useDetailSources (#310)', () => {
  it('reads what is wanted as it opens, and again on each status answer while open', async () => {
    const updated = clock();
    const { result } = renderHook(() => useDetailSources(['ups'], updated));
    await waitFor(() => expect(result.current.ups?.body).toEqual(ups));
    expect(asked('/api/ups')).toBe(1);
    expect(asked('/api/services')).toBe(0);

    // The answer that follows the first read at once doesn't ask again.
    act(() => updated.tick());
    expect(asked('/api/ups')).toBe(1);

    vi.setSystemTime(Date.now() + 30_000);
    ups = { ...ups, load: 22 };
    act(() => updated.tick());
    await waitFor(() => expect(result.current.ups?.body.load).toBe(22));
    expect(asked('/api/ups')).toBe(2);
  });

  it('reads nothing while closed, and stops when it closes, keeping what it read', async () => {
    const updated = clock();
    const { result, rerender } = renderHook(({ wanted }) => useDetailSources(wanted, updated), {
      initialProps: { wanted: [] },
    });
    act(() => updated.tick());
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(updated.listening()).toBe(0);

    rerender({ wanted: ['services', 'integrations'] });
    await waitFor(() => expect(result.current.integrations?.body).toBeTruthy());
    expect(asked('/api/services')).toBe(1);
    expect(asked('/api/integrations')).toBe(1);
    expect(updated.listening()).toBe(1);

    rerender({ wanted: [] });
    expect(updated.listening()).toBe(0);
    vi.setSystemTime(Date.now() + 30_000);
    act(() => updated.tick());
    expect(asked('/api/services')).toBe(1);
    expect(asked('/api/integrations')).toBe(1);
    // Closed, it still has what it drew, so it closes as it was.
    expect(result.current.integrations.body).toEqual({ proxmox: { _preset: 'proxmox' } });
  });

  it('a read that fails keeps the body it had, with the error, until it answers again', async () => {
    const updated = clock();
    const { result } = renderHook(() => useDetailSources(['ups'], updated));
    await waitFor(() => expect(result.current.ups?.body).toEqual(ups));
    const had = result.current.ups.body;

    ups = new TypeError('Failed to fetch');
    vi.setSystemTime(Date.now() + 30_000);
    act(() => updated.tick());
    await waitFor(() => expect(result.current.ups.error).toBe('Failed to fetch'));
    expect(result.current.ups.body).toBe(had);

    ups = { status: 1, charge: 99, load: 18 };
    vi.setSystemTime(Date.now() + 30_000);
    act(() => updated.tick());
    await waitFor(() => expect(result.current.ups.error).toBeNull());
    expect(result.current.ups.body.charge).toBe(99);
  });
});
