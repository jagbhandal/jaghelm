import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clock } from './clock.js';

// The one clock (#480, #559): every age on screen and every judge of how old
// an answer is read one "now", which moves for all of them at once.

const NOW = new Date('2026-10-23T09:00:00Z').getTime();
const stops = [];
const keep = (stop) => stops.push(stop);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  while (stops.length) stops.pop()();
  vi.useRealTimers();
  delete document.hidden;
});

describe('the one clock', () => {
  it('idle, it reads the time itself, and keeps no timer', () => {
    expect(clock.get()).toBe(NOW);
    vi.setSystemTime(NOW + 5_000);
    expect(clock.get()).toBe(NOW + 5_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('one timer for every judge, to the earliest deadline; each hears every move, at one now', () => {
    const heard = [];
    keep(
      clock.watch(
        () => NOW + 10_000,
        () => heard.push(['a', clock.get()])
      )
    );
    keep(
      clock.watch(
        () => NOW + 4_000,
        () => heard.push(['b', clock.get()])
      )
    );
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(3_999);
    expect(heard).toEqual([]);
    expect(clock.get()).toBe(NOW);
    vi.advanceTimersByTime(1);
    expect(heard).toEqual([
      ['a', NOW + 4_000],
      ['b', NOW + 4_000],
    ]);
    // Then the next deadline, the same one timer.
    expect(vi.getTimerCount()).toBe(1);
    heard.length = 0;
    vi.advanceTimersByTime(6_000);
    expect(heard.map(([, at]) => at)).toEqual([NOW + 10_000, NOW + 10_000]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('between moves, now holds: whatever reads it in between reads the last move', () => {
    keep(
      clock.watch(
        () => NOW + 60_000,
        () => {}
      )
    );
    vi.advanceTimersByTime(30_000);
    expect(clock.get()).toBe(NOW);
  });

  it('a deadline already due as it is watched moves the clock at once, for every listener', () => {
    const heard = [];
    keep(
      clock.watch(
        () => NOW + 60_000,
        () => heard.push('early')
      )
    );
    // The machine slept past it, or the judge came late.
    vi.setSystemTime(NOW + 90_000);
    keep(
      clock.watch(
        () => NOW + 72_000,
        () => heard.push('late')
      )
    );
    expect(clock.get()).toBe(NOW + 90_000);
    expect(heard).toEqual(['early', 'late']);
  });

  it('a deadline that comes nearer (an answer after none) waits for rearm', () => {
    let deadline = null;
    const heard = [];
    keep(
      clock.watch(
        () => deadline,
        () => heard.push(clock.get())
      )
    );
    expect(vi.getTimerCount()).toBe(0);
    deadline = NOW + 2_000;
    clock.rearm();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(2_000);
    expect(heard).toEqual([NOW + 2_000]);
  });

  it('ages tick each second, on the same now the judges read', () => {
    const ages = [];
    const judged = [];
    keep(clock.subscribe(() => ages.push(clock.get())));
    keep(
      clock.watch(
        () => NOW + 1_500,
        () => judged.push(clock.get())
      )
    );
    ages.length = 0;
    judged.length = 0;
    vi.advanceTimersByTime(2_000);
    expect(ages).toEqual([NOW + 1_000, NOW + 1_500, NOW + 2_000]);
    expect(judged).toEqual(ages);
  });

  it('a tab shown again moves it at once, before the page hears the event', () => {
    keep(
      clock.watch(
        () => NOW + 72_000,
        () => {}
      )
    );
    let seenByPage = null;
    const page = () => {
      seenByPage = clock.get();
    };
    document.addEventListener('visibilitychange', page);
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      vi.setSystemTime(NOW + 3 * 3_600_000);
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(seenByPage).toBe(NOW + 3 * 3_600_000);
    } finally {
      document.removeEventListener('visibilitychange', page);
    }
  });

  it('a deadline past the longest timer (a clock set back): one timer, no tight loop, the deadline still kept', () => {
    // setTimeout holds 2^31 − 1 ms (24.8 days); a longer delay fires at once.
    const MAX = 2 ** 31 - 1;
    const deadline = NOW + 30 * 86_400_000;
    const heard = [];
    keep(
      clock.watch(
        () => deadline,
        () => heard.push(clock.get())
      )
    );
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(heard).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);
    // The longest timer runs out early: the clock re-arms for the rest.
    vi.advanceTimersByTime(MAX - 1_000);
    expect(heard.every((at) => at < deadline)).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(deadline - NOW - MAX);
    expect(heard.at(-1)).toBe(deadline);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops when nothing listens: no timer, no interval', () => {
    const a = clock.subscribe(() => {});
    const b = clock.watch(
      () => NOW + 72_000,
      () => {}
    );
    expect(vi.getTimerCount()).toBe(2);
    a();
    b();
    expect(vi.getTimerCount()).toBe(0);
  });
});
