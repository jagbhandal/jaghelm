import { describe, it, expect, afterEach } from 'vitest';
import { getApiBase, setApiBase, isRelativeBase } from './baseUrl.js';

// Restore the web default after each test so order can't leak an absolute base
// into a later test (and so the desktop-default assertion is meaningful).
afterEach(() => setApiBase('/api'));

describe('baseUrl — single source of truth for the API base', () => {
  it('defaults to /api (desktop byte-for-byte: web is unchanged)', () => {
    expect(getApiBase()).toBe('/api');
    expect(isRelativeBase()).toBe(true);
  });

  it('setApiBase stores an absolute base verbatim (mobile)', () => {
    setApiBase('http://vm-101:3099/api');
    expect(getApiBase()).toBe('http://vm-101:3099/api');
    expect(isRelativeBase()).toBe(false);
  });

  it('setApiBase strips trailing slashes so URL joins do not double up', () => {
    setApiBase('http://vm-101:3099/api/');
    expect(getApiBase()).toBe('http://vm-101:3099/api');
  });

  it('setApiBase falls back to /api on a falsy argument', () => {
    setApiBase('http://host/api');
    setApiBase('');
    expect(getApiBase()).toBe('/api');
    setApiBase(null);
    expect(getApiBase()).toBe('/api');
  });
});
