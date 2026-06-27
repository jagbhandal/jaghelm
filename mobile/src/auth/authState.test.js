import { describe, it, expect, vi } from 'vitest';
import { setAuthHandlers, logout, forgetDevice } from './authState.js';

describe('authState', () => {
  it('default handlers are safe no-ops before registration', () => {
    expect(() => logout()).not.toThrow();
    expect(() => forgetDevice()).not.toThrow();
  });

  it('dispatches to the registered handlers', () => {
    const lo = vi.fn();
    const fo = vi.fn();
    setAuthHandlers({ logout: lo, forgetDevice: fo });
    logout();
    forgetDevice();
    expect(lo).toHaveBeenCalledTimes(1);
    expect(fo).toHaveBeenCalledTimes(1);
  });

  it('a later registration replaces the prior handlers', () => {
    const first = vi.fn();
    const second = vi.fn();
    setAuthHandlers({ logout: first });
    setAuthHandlers({ logout: second });
    logout();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
