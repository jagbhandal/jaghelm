import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { initAuthToken, getAuthToken, setAuthToken } from './client.js';
import { secureStore } from '../storage/index.js';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
  setAuthToken('');
});

afterEach(() => setAuthToken(''));

describe('initAuthToken — async boot seed of the in-memory token', () => {
  it('WEB: restores the session from stored token (replaces module-load seed)', async () => {
    await secureStore.setItem('jaghelm-token', 'restored-tok');
    await initAuthToken();
    expect(getAuthToken()).toBe('restored-tok');
  });

  it('leaves the token empty when nothing is stored', async () => {
    await initAuthToken();
    expect(getAuthToken()).toBe('');
  });
});
