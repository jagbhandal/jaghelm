import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEALTHY } from '../testing/statusFixtures.js';
import { REQUEST_TIMEOUT_MS } from '../hooks/useData.js';
import { isTooOld, staleAfterMs, staleAt } from './freshness.js';
import { useStatusFreshness } from './statusFreshness.js';
import { useDashboardData } from './useDashboardData.js';

// One rule and one clock for how old the client's last answer is (#559): the
// header (useStatusFreshness, on the status poll's answers) and the Overview's
// sections' notes (useDashboardData, on /api/services' and /api/integrations')
// call an answer stale by the same helper, on the same "now", so for the same
// answer time they flip together, by construction. Before, the header called
// it at 2 polls and the request timeout, on a timer to the boundary, and the
// panels at 2 polls, on a stepped clock read only when the board rendered,
// with a hidden tab excused: a few seconds either way of disagreement.

const KEYS = ['services', 'integrations'];
// A whole number of every interval below after the epoch, so `phase` is the phase.
const BASE = 120_000 * 15_000_000;

/** The status poll's `updated` store, as useStatus serves it. */
function store(staleAfter) {
  let value = null;
  const listeners = new Set();
  return {
    staleAfter,
    get: () => value,
    builtAt: () => null,
    set(v) {
      value = v;
      for (const l of [...listeners]) l();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  };
}

// Whether the board's endpoints answer: while false, every request hangs.
let answering;

beforeEach(() => {
  if (!AbortSignal.timeout) AbortSignal.timeout = () => new AbortController().signal;
  answering = true;
  vi.stubGlobal(
    'fetch',
    vi.fn((url) =>
      answering
        ? Promise.resolve(jsonResponse(String(url) === '/api/services' ? { nodes: {} } : {}))
        : new Promise(() => {})
    )
  );
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete document.hidden;
});

function setHidden(hidden) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

const settle = () => act(async () => {});

/**
 * The header's judge and the board's, side by side, as the shell wires them:
 * the header on the poll's store, the board on its own reads, at one interval.
 */
async function renderBoth(intervalMs) {
  const updated = store(staleAfterMs(intervalMs));
  const view = renderHook(
    ({ tick, active }) => ({
      header: useStatusFreshness({ status: HEALTHY, reach: 'ok', updated }),
      board: useDashboardData(0, { tick, active, refreshIntervalMs: intervalMs }),
    }),
    { initialProps: { tick: 0, active: true } }
  );
  await settle(); // the board's first answers, now
  act(() => updated.set(Date.now())); // and the poll's, the same moment
  return { ...view, updated };
}

/** What each judge says: the header's stale, and each panel's note. */
const said = ({ header, board }) => ({
  header: header.stale,
  ...Object.fromEntries(KEYS.map((k) => [k, board.sources[k].staleNote != null])),
});
const all = (stale) => ({ header: stale, services: stale, integrations: stale });

describe('one helper: interval → stale-after', () => {
  it('two polls and the request timeout: 72 s at the default 30 s, 32 s at the 10 s minimum', () => {
    expect(staleAfterMs(30_000)).toBe(2 * 30_000 + REQUEST_TIMEOUT_MS);
    expect(staleAfterMs(30_000)).toBe(72_000);
    expect(staleAfterMs(10_000)).toBe(32_000);
  });

  it('stale from the boundary on, not before; nothing to judge before an answer', () => {
    expect(staleAt(1_000, 72_000)).toBe(73_000);
    expect(isTooOld(1_000, 72_000, 72_999)).toBe(false);
    expect(isTooOld(1_000, 72_000, 73_000)).toBe(true);
    expect(staleAt(null, 72_000)).toBeNull();
    expect(isTooOld(null, 72_000, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});

describe('the header and the panels agree on stale, for the same answer time (#559)', () => {
  // Every phase an eighth of an interval apart, against the epoch and the
  // ticks (which fall on whole intervals of it), each followed a quarter
  // second at a time from the answer to an interval past the boundary.
  for (const intervalMs of [2_000, 30_000]) {
    it(`at every clock phase, at a ${intervalMs / 1000} s interval: both flip at the boundary, together`, async () => {
      const staleAfter = staleAfterMs(intervalMs);
      const wrong = [];
      for (let phase = 0; phase < intervalMs; phase += intervalMs / 8) {
        vi.setSystemTime(BASE + phase);
        answering = true;
        const { result, rerender, unmount } = await renderBoth(intervalMs);
        // Nothing answers from here: the status poll asks nothing (a hung
        // request keeps its reach 'ok'), and each tick's reads hang.
        answering = false;
        let tick = 0;
        for (let t = 250; t <= staleAfter + intervalMs; t += 250) {
          act(() => {
            vi.advanceTimersByTime(250);
          });
          if ((phase + t) % intervalMs === 0) rerender({ tick: ++tick, active: true });
          const got = said(result.current);
          const want = all(t >= staleAfter);
          if (JSON.stringify(got) !== JSON.stringify(want))
            wrong.push(`phase ${phase} ms, +${t} ms: ${JSON.stringify(got)}`);
        }
        unmount();
      }
      expect(wrong).toEqual([]);
    });
  }

  it('a machine that slept: stale together as it wakes, before any answer; fresh together on the answers', async () => {
    vi.setSystemTime(BASE);
    const { result, rerender, updated } = await renderBoth(30_000);
    expect(said(result.current)).toEqual(all(false));

    // Five minutes asleep: no timer ran, no visibilitychange.
    vi.setSystemTime(BASE + 5 * 60_000);
    // Waking: the timers held over fire.
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(said(result.current)).toEqual(all(true));
    // The tick that was due, before its answers: still both.
    rerender({ tick: 1, active: true });
    expect(said(result.current)).toEqual(all(true));

    // The answers: the board's, and the poll's.
    await act(async () => {
      updated.set(Date.now());
    });
    expect(said(result.current)).toEqual(all(false));
  });

  it('a tab shown again hours later: stale together in its first render, before any answer; fresh together on the answers', async () => {
    vi.setSystemTime(BASE);
    const { result, rerender, updated } = await renderBoth(30_000);

    // Hidden: the poll asks nothing, and the board is paused (the shell's
    // `active` is false in a hidden tab).
    act(() => setHidden(true));
    rerender({ tick: 0, active: false });
    vi.setSystemTime(BASE + 3 * 3_600_000);

    // Shown again: the clock moves at once, the board resumes and asks.
    act(() => setHidden(false));
    expect(said(result.current)).toEqual(all(true));
    rerender({ tick: 0, active: true });
    expect(said(result.current)).toEqual(all(true));
    expect(result.current.board.sources.services.staleNote).toBe('updated 3h ago');
    expect(result.current.header.lastKnown).toBe('last known 3 h ago');

    await act(async () => {
      updated.set(Date.now());
    });
    expect(said(result.current)).toEqual(all(false));
  });

  it('the Overview back from another page, the tab showing: no note before its reads land; the header, its poll answered meanwhile, fresh too', async () => {
    vi.setSystemTime(BASE);
    const { result, rerender, updated } = await renderBoth(30_000);
    // Another page: the board asks nothing, the header's poll goes on.
    rerender({ tick: 0, active: false });
    for (let i = 0; i < 10; i++) {
      act(() => {
        vi.advanceTimersByTime(30_000);
        updated.set(Date.now());
      });
    }
    // Back, its own answers five minutes old: its first render draws no
    // note, before its reads land.
    rerender({ tick: 0, active: true });
    expect(said(result.current)).toEqual(all(false));
    await settle();
    expect(said(result.current)).toEqual(all(false));
  });
});
