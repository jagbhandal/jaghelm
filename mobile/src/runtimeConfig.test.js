import { describe, it, expect } from 'vitest';
import {
  normalizeBaseUrl,
  validateLogin,
  BASE_URL_KEY,
  TOKEN_KEY,
  URL_PRESENT_KEY,
  THEME_KEY,
  LAST_TAB_KEY,
  REMEMBER_KEY,
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

describe('validateLogin', () => {
  it('accepts a good url + username + password when asking for the url', () => {
    expect(validateLogin({ url: 'http://h:3099', username: 'admin', password: 'pw', askUrl: true })).toEqual({
      ok: true,
      errors: {},
    });
  });
  it('rejects a bad url only when askUrl is true', () => {
    expect(validateLogin({ url: 'nope', username: 'a', password: 'b', askUrl: true }).errors.url).toBeTruthy();
    expect(validateLogin({ url: 'nope', username: 'a', password: 'b', askUrl: false }).errors.url).toBeFalsy();
  });
  it('requires a non-empty username and password', () => {
    const r = validateLogin({ url: 'http://h', username: '  ', password: '', askUrl: false });
    expect(r.ok).toBe(false);
    expect(r.errors.username).toBeTruthy();
    expect(r.errors.password).toBeTruthy();
  });
  it('passes credentials-only mode with the url omitted', () => {
    expect(validateLogin({ username: 'admin', password: 'pw', askUrl: false })).toEqual({ ok: true, errors: {} });
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
  it('exposes the remember-me preference key', () => {
    expect(REMEMBER_KEY).toBe('jaghelm-remember');
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
