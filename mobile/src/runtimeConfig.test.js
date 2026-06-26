import { describe, it, expect } from 'vitest';
import {
  normalizeBaseUrl,
  validateFirstRun,
  BASE_URL_KEY,
  TOKEN_KEY,
  URL_PRESENT_KEY,
} from './runtimeConfig.js';

describe('normalizeBaseUrl', () => {
  it('appends /api to a bare host', () => {
    expect(normalizeBaseUrl('http://vm-101:3099')).toBe('http://vm-101:3099/api');
  });
  it('is idempotent when /api already present', () => {
    expect(normalizeBaseUrl('http://vm-101:3099/api')).toBe('http://vm-101:3099/api');
  });
  it('strips trailing slashes and trailing /api/', () => {
    expect(normalizeBaseUrl('https://h/api/')).toBe('https://h/api');
    expect(normalizeBaseUrl('https://h/')).toBe('https://h/api');
  });
  it('trims surrounding whitespace', () => {
    expect(normalizeBaseUrl('  http://h  ')).toBe('http://h/api');
  });
  it('throws on empty or non-http input', () => {
    expect(() => normalizeBaseUrl('')).toThrow('invalid url');
    expect(() => normalizeBaseUrl('vm-101:3099')).toThrow('invalid url');
  });
});

describe('validateFirstRun', () => {
  it('accepts a good url + token', () => {
    expect(validateFirstRun({ url: 'http://h:3099', token: 'abc' })).toEqual({
      ok: true,
      errors: {},
    });
  });
  it('rejects a bad url', () => {
    const r = validateFirstRun({ url: 'nope', token: 'abc' });
    expect(r.ok).toBe(false);
    expect(r.errors.url).toBeTruthy();
  });
  it('rejects an empty token', () => {
    const r = validateFirstRun({ url: 'http://h', token: '   ' });
    expect(r.ok).toBe(false);
    expect(r.errors.token).toBeTruthy();
  });
});

describe('storage keys', () => {
  it('token key matches the data-layer initAuthToken key', () => {
    expect(TOKEN_KEY).toBe('jaghelm-token');
  });
  it('exposes base url + presence keys', () => {
    expect(BASE_URL_KEY).toBe('jaghelm-base-url');
    expect(URL_PRESENT_KEY).toBe('jaghelm-base-url-present');
  });
});
