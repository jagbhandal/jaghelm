import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPollScheduler } from './pollScheduler.js';

// A run() whose rounds the test settles by hand, so "in flight" is observable.
function manualRun() {
  const calls = [];
  const run = vi.fn((reason) => new Promise((resolve) => calls.push({ reason, resolve })));
  const settle = async (i = calls.length - 1) => {
    calls[i].resolve();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { run, calls, settle };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createPollScheduler', () => {
  it('runs a round at once on start, then one per interval after each round settles', async () => {
    const run = vi.fn(async () => {});
    const s = createPollScheduler(run, { intervalMs: 1000 });
    s.start('force');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenLastCalledWith('force');
    await vi.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith('poll');
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(3);
    s.stop();
  });

  it('arms the next poll from when a round settles, not when it started', async () => {
    const { run, settle } = manualRun();
    const s = createPollScheduler(run, { intervalMs: 1000 });
    s.start('force');
    await vi.advanceTimersByTimeAsync(5000); // a slow round: nothing else starts meanwhile
    expect(run).toHaveBeenCalledTimes(1);
    await settle();
    await vi.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it('stop() cancels the pending poll and leaves no timer behind', async () => {
    const run = vi.fn(async () => {});
    const s = createPollScheduler(run, { intervalMs: 1000 });
    s.start('force');
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    s.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a round still in flight when stopped does not re-arm the timer', async () => {
    const { run, settle } = manualRun();
    const s = createPollScheduler(run, { intervalMs: 1000 });
    s.start('force');
    s.stop();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('start() while already running is a no-op (no second round)', async () => {
    const run = vi.fn(async () => {});
    const s = createPollScheduler(run, { intervalMs: 1000 });
    s.start('force');
    s.start('resume');
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it('start() after stop() runs one round at once with the given reason', async () => {
    const run = vi.fn(async () => {});
    const s = createPollScheduler(run, { intervalMs: 1000 });
    s.start('force');
    await vi.advanceTimersByTimeAsync(0);
    s.stop();
    s.start('resume');
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith('resume');
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenLastCalledWith('poll');
    s.stop();
  });

  it('never overlaps rounds: triggers during a round fold into one follow-up', async () => {
    const { run, calls, settle } = manualRun();
    const s = createPollScheduler(run, { intervalMs: 1000 });
    s.start('force');
    s.refresh('poll');
    s.refresh('resume');
    expect(run).toHaveBeenCalledTimes(1);
    await settle(0);
    expect(run).toHaveBeenCalledTimes(2);
    // The follow-up carries the strongest reason asked for.
    expect(calls[1].reason).toBe('resume');
    await settle(1);
    expect(run).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it('a forced refresh outranks a queued resume', async () => {
    const { run, calls, settle } = manualRun();
    const s = createPollScheduler(run, { intervalMs: 1000 });
    s.start('force');
    s.refresh('resume');
    s.refresh('force');
    await settle(0);
    expect(calls[1].reason).toBe('force');
    await settle(1);
    s.stop();
  });

  it('refresh() runs at once and restarts the interval from that round', async () => {
    const run = vi.fn(async () => {});
    const s = createPollScheduler(run, { intervalMs: 1000 });
    s.start('force');
    await vi.advanceTimersByTimeAsync(600);
    s.refresh();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith('force');
    await vi.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(3);
    s.stop();
  });

  it('refresh() resolves once its round has settled', async () => {
    const { run, settle } = manualRun();
    const s = createPollScheduler(run, { intervalMs: 1000 });
    s.start('force');
    const done = vi.fn();
    s.refresh().then(done);
    await settle(0);
    expect(done).not.toHaveBeenCalled(); // that was the round already in flight
    await settle(1);
    expect(done).toHaveBeenCalled();
    s.stop();
  });

  it('a queued follow-up is dropped (and its promise settled) on stop', async () => {
    const { run, settle } = manualRun();
    const s = createPollScheduler(run, { intervalMs: 1000 });
    s.start('force');
    const done = vi.fn();
    s.refresh().then(done);
    s.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalled();
    await settle(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a failing round does not kill the loop', async () => {
    const run = vi.fn(async () => {
      throw new Error('boom');
    });
    const s = createPollScheduler(run, { intervalMs: 1000 });
    s.start('force');
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it('a synchronous throw from run() does not kill the loop either', async () => {
    const run = vi.fn(() => {
      throw new Error('boom');
    });
    const s = createPollScheduler(run, { intervalMs: 1000 });
    expect(() => s.start('force')).not.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it('setIntervalMs() re-arms a pending poll to the new cadence, counted from the last round', async () => {
    const run = vi.fn(async () => {});
    const s = createPollScheduler(run, { intervalMs: 30_000 });
    s.start('force');
    await vi.advanceTimersByTimeAsync(10_000);
    s.setIntervalMs(45_000);
    await vi.advanceTimersByTimeAsync(20_000); // 30 s since the round: the old cadence would fire here
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000); // 45 s since the round
    expect(run).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    s.stop();
  });

  it('setIntervalMs() to a cadence already past due fires at once', async () => {
    const run = vi.fn(async () => {});
    const s = createPollScheduler(run, { intervalMs: 30_000 });
    s.start('force');
    await vi.advanceTimersByTimeAsync(20_000);
    s.setIntervalMs(10_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    s.stop();
  });

  it('setIntervalMs() while stopped arms nothing', async () => {
    const run = vi.fn(async () => {});
    const s = createPollScheduler(run, { intervalMs: 1000 });
    s.setIntervalMs(2000);
    expect(vi.getTimerCount()).toBe(0);
    s.start('force');
    await vi.advanceTimersByTimeAsync(1999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    s.stop();
  });
});
