import { describe, it, expect, beforeEach } from 'vitest';
import { installNativeHttp, isNativeHttp } from './nativeHttp.js';

beforeEach(() => {
  delete window.CapacitorHttp;
});

describe('nativeHttp', () => {
  it('isNativeHttp is false when Capacitor native HTTP is absent', () => {
    expect(isNativeHttp()).toBe(false);
  });
  it('isNativeHttp is true once the native bridge is present', () => {
    window.CapacitorHttp = {};
    expect(isNativeHttp()).toBe(true);
  });
  it('installNativeHttp is idempotent and does not throw', () => {
    expect(() => {
      installNativeHttp();
      installNativeHttp();
    }).not.toThrow();
  });
});
