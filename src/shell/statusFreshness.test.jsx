import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { useAgo } from '@ui/app-header';
import { drawnState, isStale, useStatusFreshness } from './statusFreshness.js';
import { headlineOf, lastKnownLine, subsystemCells } from './statusView.js';
import { staleAfterMs } from '../hooks/useStatus.js';
import { FIRST_RUN, HEALTHY, INCIDENT } from '../testing/statusFixtures.js';

// The one rule for a stale status (#480, #495): when the poll's status isn't
// current (a failed poll, a 503 once the server's status is past its TTL, or
// no answer for longer than the poll allows), nothing is drawn in a level
// colour from it, and each place says how old it is, by the same clock.

// The poll's store at the default 30 s interval: stale 72 s after its answer.
const STALE_AFTER = staleAfterMs(30_000);

function store(at, staleAfter = STALE_AFTER) {
  let value = at;
  const listeners = new Set();
  return {
    staleAfter,
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

/** The poll's store from a server that says when it built the status (#499). */
function builtStore(at, built) {
  const base = store(at);
  let builtValue = built;
  return {
    ...base,
    builtAt: () => builtValue,
    /** An answer: when it came, and when the status it carried was built. */
    answer(v, b) {
      builtValue = b;
      base.set(v);
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
  delete document.hidden;
});

function setHidden(hidden) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** The hook on `props`, keeping what each of its renders returned. */
function renderFreshness(props) {
  const seen = [];
  const view = renderHook(
    (p) => {
      const fresh = useStatusFreshness(p);
      seen.push(fresh);
      return fresh;
    },
    { initialProps: props }
  );
  return { ...view, seen };
}

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
  it('fresh: not stale, no age, no clock: one timer, to the boundary, for every place', () => {
    const updated = store(NOW);
    const { result, seen } = renderFreshness({ status: INCIDENT, reach: 'ok', updated });
    renderHook(() => useStatusFreshness({ status: INCIDENT, reach: 'ok', updated }));
    expect(result.current).toMatchObject({ stale: false, ageText: null, lastKnown: null });
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(STALE_AFTER - 1);
    });
    expect(seen).toHaveLength(1);
  });

  it('before the first answer: not stale either (a placeholder, not No signal), however long', () => {
    const { result } = renderHook(() =>
      useStatusFreshness({ status: null, reach: 'loading', updated: store(null) })
    );
    expect(result.current.stale).toBe(false);
    act(() => {
      vi.advanceTimersByTime(3 * 3_600_000);
    });
    expect(result.current.stale).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
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
    const { rerender, seen } = renderFreshness({ status: INCIDENT, reach: 'down', updated });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    seen.length = 0;
    rerender({ status: INCIDENT, reach: 'ok', updated });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ stale: false, ageText: null, lastKnown: null, note: null });
    // No clock left running: nothing renders until the boundary.
    act(() => {
      vi.advanceTimersByTime(STALE_AFTER - 5_000 - 1);
    });
    expect(seen).toHaveLength(1);
  });
});

describe('stale by its age: no answer for longer than the poll allows (#480)', () => {
  it('the threshold: two polls and the request timeout, 72 s at the default 30 s', () => {
    expect(STALE_AFTER).toBe(72_000);
    expect(staleAfterMs(120_000)).toBe(252_000);
  });

  it('the boundary: one ms before it, fresh; at it, stale, and out of date', () => {
    const { result } = renderFreshness({ status: HEALTHY, reach: 'ok', updated: store(NOW) });
    act(() => {
      vi.advanceTimersByTime(STALE_AFTER - 1);
    });
    expect(result.current.stale).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toMatchObject({
      stale: true,
      lastKnown: 'last known 1 min ago',
      note: 'No signal · last known 1 min ago',
      cause: "JagHelm's status is out of date",
      reach: 'expired',
    });
  });

  it('each answer moves the boundary', () => {
    const updated = store(NOW);
    const { result } = renderFreshness({ status: HEALTHY, reach: 'ok', updated });
    act(() => {
      vi.advanceTimersByTime(60_000);
      updated.set(Date.now());
    });
    act(() => {
      vi.advanceTimersByTime(STALE_AFTER - 1);
    });
    expect(result.current.stale).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.stale).toBe(true);
  });

  it('a tab shown again hours later: stale in its first render, before any answer', () => {
    const updated = store(NOW);
    const { seen } = renderFreshness({ status: INCIDENT, reach: 'ok', updated });
    setHidden(true);
    // Three hours, and no timer run: a hidden tab's are held back, a sleeping
    // laptop's stopped. The poll asked nothing, so its reach is still 'ok'.
    vi.setSystemTime(NOW + 3 * 3_600_000);
    seen.length = 0;
    setHidden(false);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].stale).toBe(true);
    expect(seen.every((fresh) => fresh.stale)).toBe(true);
    expect(seen.at(-1)).toMatchObject({
      lastKnown: 'last known 3 h ago',
      cause: "JagHelm's status is out of date",
    });
  });

  it('a tab shown again: an age already on screen reads the time at once, not its last tick', () => {
    const updated = store(NOW);
    const { result } = renderFreshness({ status: INCIDENT, reach: 'down', updated });
    expect(result.current.lastKnown).toBe('last known just now');
    setHidden(true);
    vi.setSystemTime(NOW + 3 * 3_600_000);
    setHidden(false);
    expect(result.current.lastKnown).toBe('last known 3 h ago');
  });

  it('an answer brings it back in one render', () => {
    const updated = store(NOW);
    const { seen } = renderFreshness({ status: INCIDENT, reach: 'ok', updated });
    act(() => {
      vi.advanceTimersByTime(STALE_AFTER + 30_000);
    });
    expect(seen.at(-1)).toMatchObject({ stale: true, lastKnown: 'last known 1 min ago' });
    seen.length = 0;
    act(() => {
      updated.set(Date.now());
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ stale: false, ageText: null, lastKnown: null, note: null });
  });

  it('a failed poll says so, however old the status', () => {
    const { result } = renderFreshness({ status: INCIDENT, reach: 'down', updated: store(NOW) });
    act(() => {
      vi.advanceTimersByTime(STALE_AFTER);
    });
    expect(result.current).toMatchObject({ cause: "Can't reach JagHelm", reach: 'down' });
  });
});

// #499: two times, two rules. Stale goes by when the last answer came (is the
// poll getting answers?); the age it shows goes by when the server built the
// status (how old is what it shows?), when the server says.
describe('the age counts from when the status was built (#499)', () => {
  it('after a TTL 503: "last known" from the build time, older than the last answer', () => {
    // The last good answer came at NOW, carrying a status built 40 s before.
    const updated = builtStore(NOW, NOW - 40_000);
    const { result } = renderFreshness({ status: HEALTHY, reach: 'waiting', updated });
    expect(result.current).toMatchObject({
      stale: true,
      ageText: '40 s ago',
      lastKnown: 'last known 40 s ago',
      cause: "JagHelm's status is out of date",
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.note).toBe('No signal · last known 1 min ago');
  });

  it('with no build time (an older server): from the answer, as before', () => {
    const updated = builtStore(NOW, null);
    const { result } = renderFreshness({ status: HEALTHY, reach: 'waiting', updated });
    expect(result.current.lastKnown).toBe('last known just now');
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current.lastKnown).toBe('last known 30 s ago');
  });

  it('stale by age still goes by the answer: the boundary is the answer plus staleAfter, whatever the build time', () => {
    const updated = builtStore(NOW, NOW - 50_000);
    const { result } = renderFreshness({ status: HEALTHY, reach: 'ok', updated });
    act(() => {
      vi.advanceTimersByTime(STALE_AFTER - 1);
    });
    expect(result.current.stale).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    // 72 s since the answer, 122 s since the build.
    expect(result.current).toMatchObject({ stale: true, lastKnown: 'last known 2 min ago' });
  });

  it('a new answer brings its own build time: the age moves with it', () => {
    const updated = builtStore(NOW, NOW - 10_000);
    const { result } = renderFreshness({ status: INCIDENT, reach: 'down', updated });
    expect(result.current.lastKnown).toBe('last known 10 s ago');
    act(() => {
      vi.advanceTimersByTime(20_000);
      updated.answer(Date.now(), Date.now() - 5_000);
    });
    expect(result.current.lastKnown).toBe('last known 5 s ago');
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
