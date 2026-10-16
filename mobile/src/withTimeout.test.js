import { describe, it, expect, vi, afterEach } from 'vitest';
import { withTimeout } from './withTimeout.js';

afterEach(() => vi.useRealTimers());

describe('withTimeout', () => {
  it('resolves with the value when the promise settles in time', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('propagates the promise rejection', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });

  it("rejects with Error('timeout') when the promise never settles", async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 1000);
    const assertion = expect(p).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('clears its timer once the promise settles', async () => {
    vi.useFakeTimers();
    await withTimeout(Promise.resolve(1), 1000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
