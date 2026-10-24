import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { staleAfterMs, useStatus } from './useStatus.js';
import { REQUEST_TIMEOUT_MS } from './useData.js';
import { refreshHints } from '../pollSchedule.js';

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

function respond(body, { status = 200, etag = '"v1"', modified = null, date = null, hint = null } = {}) {
  const headers = { etag, 'last-modified': modified, date, 'x-next-refresh-ms': hint };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => headers[h.toLowerCase()] ?? null },
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
  refreshHints.clear();
  vi.spyOn(Math, 'random').mockReturnValue(0);
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
  vi.restoreAllMocks();
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
  it('polls when the server says its next cycle is done (#630), not on the fixed interval', async () => {
    answer = () => respond(STATUS, { hint: '12000' });
    await mount();
    expect(requests).toHaveLength(1);
    await advance(11_900);
    expect(requests).toHaveLength(1);
    await advance(200);
    expect(requests).toHaveLength(2);
    // Each answer's hint times the next: 12 s again, not 30 s.
    await advance(12_000);
    expect(requests).toHaveLength(3);
  });

  it('keeps the fixed interval when the hint is missing or garbage', async () => {
    answer = () => respond(STATUS, { hint: 'soon' });
    await mount();
    await advance(INTERVAL - 100);
    expect(requests).toHaveLength(1);
    await advance(200);
    expect(requests).toHaveLength(2);
  });

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

  // #480 review: a hidden tab or a sleeping laptop asks nothing and leaves
  // `reach` at 'ok', so the store says how old its answer may get.
  it('says how old its answer may get: two intervals and the request timeout, the same store across answers', async () => {
    const { result, rerender } = renderHook((props) => useStatus(props), {
      initialProps: { intervalMs: INTERVAL },
    });
    expect(staleAfterMs(30_000)).toBe(2 * 30_000 + REQUEST_TIMEOUT_MS);
    expect(REQUEST_TIMEOUT_MS).toBe(12_000);
    const store = result.current.updated;
    expect(store.staleAfter).toBe(staleAfterMs(INTERVAL));
    await advance(INTERVAL);
    expect(result.current.updated).toBe(store);
    rerender({ intervalMs: 120_000 });
    expect(result.current.updated.staleAfter).toBe(252_000);
    expect(result.current.updated.get()).toBe(store.get());
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

  // #499: how old the status is counts from when the server built it, which
  // its Last-Modified says, on a 200 and a 304 alike; not from the answer.
  it('keeps when the status was built (Last-Modified) beside the answer, from a 200 and a 304', async () => {
    const t0 = new Date('2026-10-22T09:00:00Z').getTime();
    vi.setSystemTime(t0);
    const built = t0 - 25_000;
    // The first answer a 200, the next a 304 (the status built again, the same).
    answer = () =>
      requests.length === 1
        ? respond(STATUS, { modified: new Date(built).toUTCString() })
        : respond(null, { status: 304, modified: new Date(built + 30_000).toUTCString() });
    const { result } = await mount();
    expect(result.current.updated.get()).toBe(t0);
    expect(result.current.updated.builtAt()).toBe(built);
    await advance(INTERVAL);
    expect(result.current.updated.get()).toBe(t0 + INTERVAL);
    expect(result.current.updated.builtAt()).toBe(built + 30_000);
    // A 503 (past the server's TTL) brings no new one: the last stays.
    answer = () => respond({ error: 'Status not yet available' }, { status: 503 });
    await advance(INTERVAL);
    expect(result.current.reach).toBe('waiting');
    expect(result.current.updated.builtAt()).toBe(built + 30_000);
  });

  it('without a Last-Modified (an older server), knows no build time', async () => {
    const { result } = await mount();
    expect(result.current.updated.get()).not.toBeNull();
    expect(result.current.updated.builtAt()).toBeNull();
  });

  // The age is the server's own difference, its Date less its Last-Modified,
  // taken back from the answer's time: neither clock's skew enters it.
  it.each([
    ['ahead of', 90_000],
    ['behind', -90_000],
  ])('a server clock %s this one: the build time by its own Date', async (_, skew) => {
    const t0 = new Date('2026-10-22T09:00:00Z').getTime();
    vi.setSystemTime(t0);
    const http = (ms) => new Date(ms).toUTCString();
    answer = () => respond(STATUS, { modified: http(t0 + skew - 25_000), date: http(t0 + skew) });
    const { result } = await mount();
    expect(result.current.updated.builtAt()).toBe(t0 - 25_000);
  });

  it('a build time after the answer, and no Date to correct it: the answer time', async () => {
    const t0 = new Date('2026-10-22T09:00:00Z').getTime();
    vi.setSystemTime(t0);
    answer = () => respond(STATUS, { modified: new Date(t0 + 90_000).toUTCString() });
    const { result } = await mount();
    expect(result.current.updated.builtAt()).toBe(t0);
  });
});
