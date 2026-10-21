import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { useAgo } from '@ui/app-header';
import { drawnState, isStale, useStatusFreshness } from './statusFreshness.js';
import { headlineOf, lastKnownLine, subsystemCells } from './statusView.js';
import { FIRST_RUN, HEALTHY, INCIDENT } from '../testing/statusFixtures.js';

// The one rule for a stale status (#480, #495): when the poll's status isn't
// current (a failed poll, or a 503 once the server's status is past its TTL),
// nothing is drawn in a level colour from it, and each place says how old it
// is, by the same clock.

function store(at) {
  let value = at;
  const listeners = new Set();
  return {
    get: () => value,
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

const NOW = new Date('2026-10-20T09:00:00Z').getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isStale', () => {
  it('is any reach but ok, and not the first load', () => {
    expect(isStale('ok')).toBe(false);
    expect(isStale('loading')).toBe(false);
    expect(isStale('down')).toBe(true);
    expect(isStale('waiting')).toBe(true);
    expect(isStale(undefined)).toBe(true);
  });
});

describe('drawnState', () => {
  it("is the model's state while fresh, and no signal while stale", () => {
    for (const s of ['ok', 'warn', 'crit', 'unknown', 'maintenance']) {
      expect(drawnState(s, { stale: false })).toBe(s);
      expect(drawnState(s, { stale: true })).toBe('unknown');
    }
  });
});

describe('headlineOf', () => {
  it('says what the status said at its top, as the panel and the header quote it', () => {
    expect(headlineOf(HEALTHY)).toBe('All systems normal');
    expect(headlineOf(FIRST_RUN)).toBe('Nothing monitored yet');
    expect(headlineOf(INCIDENT)).toBe('Critical · 2 critical, 1 warning, 1 no signal');
  });
});

describe('useStatusFreshness', () => {
  it('fresh: not stale, no age, no clock running', () => {
    const updated = store(NOW);
    const { result } = renderHook(() =>
      useStatusFreshness({ status: INCIDENT, reach: 'ok', updated })
    );
    expect(result.current).toMatchObject({ stale: false, ageText: null, lastKnown: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('before the first answer: not stale either (a placeholder, not No signal)', () => {
    const { result } = renderHook(() =>
      useStatusFreshness({ status: null, reach: 'loading', updated: store(null) })
    );
    expect(result.current.stale).toBe(false);
  });

  it('stale: "last known <age>", counting on from the last answer, and why', () => {
    const updated = store(NOW);
    const { result } = renderHook(() =>
      useStatusFreshness({ status: INCIDENT, reach: 'down', updated })
    );
    expect(result.current).toMatchObject({
      stale: true,
      ageText: 'just now',
      lastKnown: 'last known just now',
      note: 'No signal · last known just now',
      cause: "Can't reach JagHelm",
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.lastKnown).toBe('last known 30 s ago');
    act(() => {
      vi.advanceTimersByTime(20 * 60_000);
    });
    expect(result.current.note).toBe('No signal · last known 20 min ago');
  });

  it('a 503 after a status (past its TTL on the server): out of date, not waiting for a first check', () => {
    const { result, rerender } = renderHook((props) => useStatusFreshness(props), {
      initialProps: { status: HEALTHY, reach: 'waiting', updated: store(NOW) },
    });
    expect(result.current.cause).toBe("JagHelm's status is out of date");
    rerender({ status: null, reach: 'waiting', updated: store(null) });
    expect(result.current).toMatchObject({
      stale: true,
      lastKnown: null,
      note: 'No signal',
      cause: 'Waiting for the first check',
    });
  });

  it('back to fresh: everything at once, in the render that brings the answer', () => {
    const updated = store(NOW);
    const seen = [];
    const { rerender } = renderHook(
      (props) => {
        const fresh = useStatusFreshness(props);
        seen.push(fresh);
        return fresh;
      },
      { initialProps: { status: INCIDENT, reach: 'down', updated } }
    );
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    seen.length = 0;
    rerender({ status: INCIDENT, reach: 'ok', updated });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ stale: false, ageText: null, lastKnown: null, note: null });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('lastKnownLine', () => {
  it('"last known <age>: <headline>" while stale with a status; null otherwise', () => {
    expect(lastKnownLine({ stale: true, lastKnown: 'last known 3 min ago' }, HEALTHY)).toBe(
      'last known 3 min ago: All systems normal'
    );
    expect(lastKnownLine({ stale: false, lastKnown: null }, HEALTHY)).toBeNull();
    expect(lastKnownLine({ stale: true, lastKnown: null }, null)).toBeNull();
  });
});

describe('one clock for every age on screen', () => {
  function Ages({ at }) {
    const first = useAgo(at);
    return <span data-testid="ages">{first}</span>;
  }

  it('two ages of the same moment read the same, whenever each was drawn', () => {
    const at = NOW;
    render(<Ages at={at} />);
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    // Drawn half a second after the first: on its own clock it would tick half
    // a second later than the first, and read a second behind it in between.
    render(<Ages at={at} />);
    for (let i = 0; i < 12; i++) {
      act(() => {
        vi.advanceTimersByTime(500);
      });
      const [a, b] = screen.getAllByTestId('ages').map((el) => el.textContent);
      expect(b).toBe(a);
    }
    expect(screen.getAllByTestId('ages')[0]).toHaveTextContent('7 s ago');
  });
});

describe('the strip, stale (subsystemCells with the freshness)', () => {
  it('keeps the counts and words, draws every tile as no signal, marked last known', () => {
    const fresh = subsystemCells(INCIDENT);
    const stale = subsystemCells(INCIDENT, {
      stale: true,
      lastKnown: 'last known 3 min ago',
    });
    expect(stale.map((c) => c.state)).toEqual(fresh.map(() => 'unknown'));
    expect(stale.map((c) => c.value)).toEqual(fresh.map((c) => c.value));
    expect(stale.map((c) => c.word)).toEqual(fresh.map((c) => c.word));
    expect(stale.map((c) => c.sub)).toEqual(fresh.map(() => 'Last known 3 min ago'));
    expect(fresh.map((c) => c.sub)).toEqual(fresh.map(() => undefined));
  });
});
