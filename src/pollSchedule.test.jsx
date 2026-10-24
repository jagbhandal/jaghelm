import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createHintStore,
  JITTER_MS,
  MIN_DELAY_MS,
  nextDelayMs,
  parseHint,
  startPhaseLock,
} from './pollSchedule.js';

const INTERVAL = 30_000;
const none = () => 0;

describe('parseHint', () => {
  it('reads a whole number of ms and nothing else', () => {
    expect(parseHint('12345')).toBe(12345);
    expect(parseHint(' 800 ')).toBe(800);
    for (const bad of [null, undefined, '', 'soon', '-5', '1.5', '1e9', 'NaN', '99999999999']) {
      expect(parseHint(bad)).toBeNull();
    }
  });
});

describe('nextDelayMs', () => {
  it('waits for the hint, less the time since it came, plus jitter', () => {
    const hint = { ms: 20_000, at: 1_000 };
    expect(nextDelayMs({ hint, now: 1_000, intervalMs: INTERVAL, random: none })).toBe(20_000);
    expect(nextDelayMs({ hint, now: 6_000, intervalMs: INTERVAL, random: none })).toBe(15_000);
    expect(nextDelayMs({ hint, now: 1_000, intervalMs: INTERVAL, random: () => 1 })).toBe(
      20_000 + JITTER_MS
    );
  });

  it('falls back to the fixed interval with no hint, or one that has run out or is unusable', () => {
    const args = { now: 50_000, intervalMs: INTERVAL, random: none };
    expect(nextDelayMs({ ...args, hint: null })).toBe(INTERVAL);
    expect(nextDelayMs({ ...args, hint: { ms: 5_000, at: 1_000 } })).toBe(INTERVAL);
    expect(nextDelayMs({ ...args, hint: { ms: NaN, at: 50_000 } })).toBe(INTERVAL);
  });

  it('holds a hint to 1 s .. 2 x the interval', () => {
    const args = { now: 0, intervalMs: INTERVAL, random: none };
    expect(nextDelayMs({ ...args, hint: { ms: 100, at: 0 } })).toBe(MIN_DELAY_MS);
    expect(nextDelayMs({ ...args, hint: { ms: 2 * INTERVAL, at: 0 } })).toBe(2 * INTERVAL);
    expect(nextDelayMs({ ...args, hint: { ms: 10 * INTERVAL, at: 0 } })).toBe(2 * INTERVAL);
  });

  it('follows a new interval: a 10 s slider holds a 25 s hint to 20 s', () => {
    const hint = { ms: 25_000, at: 0 };
    expect(nextDelayMs({ hint, now: 0, intervalMs: 10_000, random: none })).toBe(20_000);
    expect(nextDelayMs({ hint: { ms: 15_000, at: 0 }, now: 0, intervalMs: 10_000, random: none })).toBe(15_000);
  });
});

describe('startPhaseLock', () => {
  let hints;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    hints = createHintStore();
  });
  afterEach(() => vi.useRealTimers());

  const lock = (fire, intervalMs = INTERVAL) =>
    startPhaseLock({ fire, intervalMs, hints, random: none });

  it('polls at the interval when no hint ever comes', () => {
    const fire = vi.fn();
    lock(fire);
    vi.advanceTimersByTime(INTERVAL - 1);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(INTERVAL);
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it('polls at the hint once one arrives, in place of the interval', () => {
    const fire = vi.fn();
    lock(fire);
    vi.advanceTimersByTime(5_000);
    hints.note('12000');
    vi.advanceTimersByTime(11_999);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('ignores a garbage hint', () => {
    const fire = vi.fn();
    lock(fire);
    hints.note('banana');
    vi.advanceTimersByTime(INTERVAL);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('after a poll, re-times from the answer it brings', () => {
    const fire = vi.fn(() => setTimeout(() => hints.note('28000'), 40)); // the answer, 40 ms later
    lock(fire);
    vi.advanceTimersByTime(INTERVAL);
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(40 + 27_999);
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it('stop() ends it, and a later hint starts nothing', () => {
    const fire = vi.fn();
    const stop = lock(fire);
    stop();
    hints.note('1000');
    vi.advanceTimersByTime(3 * INTERVAL);
    expect(fire).not.toHaveBeenCalled();
  });

  it('a resume (a new lock after the tab was hidden) times itself from the last hint, or the interval when it ran out', () => {
    const fire = vi.fn();
    hints.note('20000');
    const stop = lock(fire);
    stop();
    vi.advanceTimersByTime(60_000); // hidden for a minute
    lock(fire);
    vi.advanceTimersByTime(INTERVAL);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('a new interval re-times: the lock restarted at 10 s polls by it without a hint', () => {
    const fire = vi.fn();
    const stop = lock(fire, INTERVAL);
    stop();
    lock(fire, 10_000);
    vi.advanceTimersByTime(10_000);
    expect(fire).toHaveBeenCalledTimes(1);
  });
});

describe('two locks on one cycle', () => {
  it('a hint that lands between them does not push the later one past its cycle', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const hints = createHintStore();
    hints.note('12000');
    const early = vi.fn(() => setTimeout(() => hints.note('29000'), 30)); // its answer carries the next cycle's hint
    const late = vi.fn();
    startPhaseLock({ fire: early, intervalMs: INTERVAL, hints, random: () => 0 });
    startPhaseLock({ fire: late, intervalMs: INTERVAL, hints, random: () => 0.1 }); // 25 ms of jitter later
    vi.advanceTimersByTime(12_100);
    expect(early).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
