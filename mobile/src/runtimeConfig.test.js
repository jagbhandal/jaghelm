import { describe, it, expect } from 'vitest';
import {
  normalizeBaseUrl,
  validateFirstRun,
  BASE_URL_KEY,
  TOKEN_KEY,
  URL_PRESENT_KEY,
  THEME_KEY,
  LAST_TAB_KEY,
  PUSH_TOKEN_KEY,
  PUSH_PERM_KEY,
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
  it('treats a host literally named api correctly (no scheme collapse)', () => {
    expect(normalizeBaseUrl('http://api')).toBe('http://api/api');
  });
  it('preserves a sub-path deployment and does not double /api', () => {
    expect(normalizeBaseUrl('https://host/base/api')).toBe('https://host/base/api');
    expect(normalizeBaseUrl('https://host/base')).toBe('https://host/base/api');
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
  it('exposes theme + last-tab keys', () => {
    expect(THEME_KEY).toBe('jaghelm-theme');
    expect(LAST_TAB_KEY).toBe('jaghelm-last-tab');
  });
});

describe('push Preferences keys', () => {
  it('exports stable, namespaced, distinct non-secret push keys', () => {
    expect(PUSH_TOKEN_KEY).toBe('jaghelm-push-token');
    expect(PUSH_PERM_KEY).toBe('jaghelm-push-perm');
    const all = [PUSH_TOKEN_KEY, PUSH_PERM_KEY];
    expect(new Set(all).size).toBe(2);
    for (const k of all) expect(k.startsWith('jaghelm-')).toBe(true);
  });
});
