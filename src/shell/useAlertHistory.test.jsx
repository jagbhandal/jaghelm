/**
 * #314: the Alerts pages' History hook. It asks /api/events for the filters,
 * a page at a time, newest first; asks the first page again on each answer of
 * the status poll; and says so when the history can't be read: a failure is
 * never an empty history, and a server older than /api/events (404) is "old",
 * not asked again.
 */
import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HISTORY_PAGE, useAlertHistory } from './useAlertHistory.js';
import { NO_FILTERS } from './alertsView.js';
import { eventsAnswer, eventsQueryOf, isEvents, respondJson } from '../testing/eventsServer.js';
import { demoEvents } from '../../server/demoEvents.js';

const NOW = Date.parse('2026-10-23T12:00:00Z');
const ALL = demoEvents({ now: NOW }).events.length;

let asked;
let answer;

beforeEach(() => {
  asked = [];
  answer = (url) => eventsAnswer(url, { now: NOW });
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      if (!isEvents(url)) return Promise.reject(new Error(`unexpected ${url}`));
      asked.push(eventsQueryOf(url));
      return Promise.resolve(answer(url));
    })
  );
});

/** A store like the status poll's `updated`, whose answers a test sends. */
function pollClock() {
  const listeners = new Set();
  return {
    get: () => NOW,
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    answer: () => act(() => listeners.forEach((fn) => fn())),
  };
}

const ids = (events) => events.map((e) => e.id);

describe('useAlertHistory', () => {
  it('loads the first page, newest first, then each older page; none left, no more', async () => {
    answer = (url) => eventsAnswer(url.replace(`limit=${HISTORY_PAGE}`, 'limit=5'), { now: NOW });
    const { result } = renderHook(() => useAlertHistory(NO_FILTERS));
    expect(result.current.state).toBe('loading');
    expect(result.current.events).toEqual([]);
    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect(asked[0]).toEqual({ limit: String(HISTORY_PAGE) });
    const top = [ALL, ALL - 1, ALL - 2, ALL - 3, ALL - 4].map(String);
    expect(ids(result.current.events)).toEqual(top);
    act(() => result.current.more());
    expect(result.current.loadingMore).toBe(true);
    await waitFor(() => expect(result.current.events).toHaveLength(10));
    expect(asked[1]).toEqual({ limit: String(HISTORY_PAGE), before: String(ALL - 4) });
    while (result.current.more) {
      const before = result.current.events.length;
      act(() => result.current.more());
      await waitFor(() => expect(result.current.events.length).toBeGreaterThan(before));
    }
    expect(ids(result.current.events)).toEqual(
      Array.from({ length: ALL }, (_, i) => String(ALL - i))
    );
    expect(result.current.more).toBeNull();
  });

  it('asks the server with the filters; new filters start again, and a late answer for the old ones is dropped', async () => {
    let hold;
    answer = (url) => {
      if (eventsQueryOf(url).kind === 'services') {
        return new Promise((resolve) => {
          hold = () => resolve(eventsAnswer(url, { now: NOW }));
        });
      }
      return eventsAnswer(url, { now: NOW });
    };
    const { result, rerender } = renderHook(({ f }) => useAlertHistory(f), {
      initialProps: { f: { ...NO_FILTERS, kind: 'services' } },
    });
    expect(asked[0]).toEqual({ kind: 'services', limit: String(HISTORY_PAGE) });
    rerender({ f: { severity: 'critical', kind: null, q: 'gitea' } });
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect(asked[1]).toEqual({ severity: 'critical', q: 'gitea', limit: String(HISTORY_PAGE) });
    expect(result.current.events.map((e) => [e.type, e.entity])).toEqual([
      ['service_down', 'services/apps:gitea'],
    ]);
    await act(async () => hold());
    expect(result.current.events.map((e) => e.entity)).toEqual(['services/apps:gitea']);
  });

  it('the same filters again (a new object) ask nothing', async () => {
    const { result, rerender } = renderHook(({ f }) => useAlertHistory(f), {
      initialProps: { f: { ...NO_FILTERS } },
    });
    await waitFor(() => expect(result.current.state).toBe('ok'));
    rerender({ f: { ...NO_FILTERS } });
    expect(asked).toHaveLength(1);
  });

  it('asks the first page again on each answer of the poll: a new event on top, older pages kept', async () => {
    const updated = pollClock();
    answer = (url) => eventsAnswer(url.replace(`limit=${HISTORY_PAGE}`, 'limit=3'), { now: NOW });
    const { result } = renderHook(() => useAlertHistory(NO_FILTERS, { updated }));
    await waitFor(() => expect(result.current.state).toBe('ok'));
    act(() => result.current.more());
    await waitFor(() => expect(result.current.events).toHaveLength(6));
    const loaded = ids(result.current.events);
    // A new event: what the server now answers has one more on top.
    const fresh = { ...result.current.events[0], id: String(ALL + 1), type: 'service_recovered' };
    answer = (url) => {
      const out = eventsAnswer(url.replace(`limit=${HISTORY_PAGE}`, 'limit=2'), { now: NOW });
      return out
        .json()
        .then((page) => respondJson({ events: [fresh, page.events[0]], next: page.events[0].id }));
    };
    updated.answer();
    await waitFor(() => expect(result.current.events[0].id).toBe(String(ALL + 1)));
    expect(ids(result.current.events)).toEqual([String(ALL + 1), ...loaded]);
    expect(asked.at(-1)).toEqual({ limit: String(HISTORY_PAGE) });
  });

  it('a server without /api/events (404) is old: no history, and not asked again', async () => {
    const updated = pollClock();
    answer = () => respondJson({ error: 'Endpoint not found' }, 404);
    const { result } = renderHook(() => useAlertHistory(NO_FILTERS, { updated }));
    await waitFor(() => expect(result.current.state).toBe('old'));
    expect(result.current.events).toEqual([]);
    expect(result.current.more).toBeNull();
    updated.answer();
    updated.answer();
    expect(asked).toHaveLength(1);
  });

  it('a failed read says error, never an empty history; Retry reads it', async () => {
    answer = () => Promise.reject(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useAlertHistory(NO_FILTERS));
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.events).toEqual([]);
    answer = (url) => eventsAnswer(url, { now: NOW });
    act(() => result.current.retry());
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect(result.current.events).toHaveLength(ALL);
  });

  it('an answer that is not a page, or a 500, is an error too', async () => {
    answer = () => respondJson({});
    const { result } = renderHook(() => useAlertHistory(NO_FILTERS));
    await waitFor(() => expect(result.current.state).toBe('error'));
    answer = () => respondJson({ error: 'boom' }, 500);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state).toBe('error'));
  });

  it('a refresh that fails keeps what the history last said, and says it failed', async () => {
    const updated = pollClock();
    const { result } = renderHook(() => useAlertHistory(NO_FILTERS, { updated }));
    await waitFor(() => expect(result.current.state).toBe('ok'));
    answer = () => Promise.reject(new TypeError('Failed to fetch'));
    updated.answer();
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.state).toBe('ok');
    expect(result.current.events).toHaveLength(ALL);
  });

  it('works under StrictMode: one list, no doubled events', async () => {
    const { result } = renderHook(() => useAlertHistory(NO_FILTERS), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.state).toBe('ok'));
    expect(result.current.events).toHaveLength(ALL);
  });
});
