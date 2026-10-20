import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStatus } from './useStatus.js';

// The header's status poll (#296): /api/status once a refresh interval, with
// the last ETag, so a steady board costs a 304 and re-renders nothing; paused
// while the browser tab is hidden; and honest about a backend it can't reach.

const INTERVAL = 30_000;
const STATUS = {
  overall: { state: 'crit', sentence: '1 service down' },
  issues: [{ id: 'services/a', state: 'crit' }],
  subsystems: [],
  entities: [],
  sources: {},
};

let requests;
let answer; // (headers) => Response-like

function respond(body, { status = 200, etag = '"v1"' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === 'etag' ? etag : null) },
    json: () => Promise.resolve(body),
  };
}

function setHidden(hidden) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

const advance = (ms) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  requests = [];
  answer = (headers) =>
    headers['If-None-Match'] === '"v1"' ? respond(null, { status: 304 }) : respond(STATUS);
  vi.stubGlobal(
    'fetch',
    vi.fn((url, opts = {}) => {
      requests.push({ url: String(url), headers: { ...opts.headers } });
      const out = answer(opts.headers || {});
      return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  delete document.hidden;
});

async function mount(intervalMs = INTERVAL) {
  const hook = renderHook(({ intervalMs }) => useStatus({ intervalMs }), {
    initialProps: { intervalMs },
  });
  await advance(0);
  return hook;
}

describe('useStatus', () => {
  it('loads /api/status at once, then once per interval', async () => {
    const { result } = await mount();
    expect(requests.map((r) => r.url)).toEqual(['/api/status']);
    expect(result.current.reach).toBe('ok');
    expect(result.current.status).toEqual(STATUS);
    await advance(INTERVAL);
    await advance(INTERVAL);
    expect(requests).toHaveLength(3);
  });

  it('starts as loading, before the first answer', () => {
    const { result } = renderHook(() => useStatus({ intervalMs: INTERVAL }));
    expect(result.current.reach).toBe('loading');
    expect(result.current.status).toBeNull();
    expect(result.current.updated.get()).toBeNull();
  });

  it('asks with the last ETag; a 304 keeps the same status object', async () => {
    const { result } = await mount();
    const first = result.current.status;
    await advance(INTERVAL);
    expect(requests[1].headers['If-None-Match']).toBe('"v1"');
    expect(result.current.status).toBe(first);
  });

  it('moves the "updated" time on every answer, 304s included, without a re-render', async () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useStatus({ intervalMs: INTERVAL });
    });
    await advance(0);
    const settled = renders;
    const seen = [];
    const stop = result.current.updated.subscribe(() => seen.push(result.current.updated.get()));
    const before = result.current.updated.get();
    await advance(INTERVAL);
    expect(result.current.updated.get()).toBeGreaterThan(before);
    expect(seen).toHaveLength(1);
    expect(renders).toBe(settled);
    stop();
  });

  it('asks nothing while the browser tab is hidden, and at once on return', async () => {
    await mount();
    setHidden(true);
    await advance(5 * INTERVAL);
    expect(requests).toHaveLength(1);
    setHidden(false);
    await advance(0);
    expect(requests).toHaveLength(2);
  });

  it('is no signal when the backend can’t be reached, keeping the last status', async () => {
    const { result } = await mount();
    answer = () => new TypeError('Failed to fetch');
    await advance(INTERVAL);
    expect(result.current.reach).toBe('down');
    expect(result.current.status).toEqual(STATUS);
    answer = () => respond({}, { status: 502 });
    await advance(INTERVAL);
    expect(result.current.reach).toBe('down');
    answer = (headers) =>
      headers['If-None-Match'] === '"v1"' ? respond(null, { status: 304 }) : respond(STATUS);
    await advance(INTERVAL);
    expect(result.current.reach).toBe('ok');
  });

  it('is waiting when the server has no status yet (503), or answers without one', async () => {
    answer = () => respond({ error: 'Status not yet available' }, { status: 503 });
    const { result } = await mount();
    expect(result.current.reach).toBe('waiting');
    answer = () => respond({}, { etag: '"empty"' });
    await advance(INTERVAL);
    expect(result.current.reach).toBe('waiting');
    expect(result.current.status).toBeNull();
  });

  it('asks once at mount under StrictMode, and shows the answer', async () => {
    const { result } = renderHook(() => useStatus({ intervalMs: INTERVAL }), {
      wrapper: StrictMode,
    });
    await advance(0);
    expect(requests).toHaveLength(1);
    expect(result.current.reach).toBe('ok');
  });

  it('follows a new interval, without asking early', async () => {
    const { rerender } = await mount();
    rerender({ intervalMs: 10_000 });
    await advance(10_000);
    expect(requests).toHaveLength(2);
  });
});
