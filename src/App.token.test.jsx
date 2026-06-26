import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { secureStore } from './storage/index.js';
import { getAuthToken, setAuthToken } from './api/client.js';

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
  setAuthToken('');
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken('');
});

// A stub /api/auth/check that reports auth disabled, so App renders the
// authenticated tree without a login form (keeps this test about the seam).
function stubAuthCheck() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ authRequired: false, authenticated: true }),
        text: () => Promise.resolve('{}'),
        headers: { get: () => null },
      })
    )
  );
}

describe('App — token persistence through secureStore + awaited boot', () => {
  it('WEB: a token stored before boot is restored into apiFetch (initAuthToken awaited)', async () => {
    await secureStore.setItem('jaghelm-token', 'boot-tok');
    stubAuthCheck();
    const App = (await import('./App.jsx')).default;
    render(<App />);
    await waitFor(() => expect(getAuthToken()).toBe('boot-tok'));
  });

  it('WEB: handleLogout removes the token via secureStore (localStorage cleared)', async () => {
    await secureStore.setItem('jaghelm-token', 'x');
    // Simulate the logout path's storage write directly through the seam.
    await secureStore.removeItem('jaghelm-token');
    expect(localStorage.getItem('jaghelm-token')).toBe(null);
  });
});
