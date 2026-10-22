import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { logout, forgetDevice } from './auth/authState.js';

// The real client, so sign-out sends its real request (#507), with the two
// calls the tests watch replaced by spies. `actualClient` sets the real token.
const { setAuthExpiredHandler, setAuthToken, actualClient } = vi.hoisted(() => ({
  setAuthExpiredHandler: vi.fn(),
  setAuthToken: vi.fn(),
  actualClient: {},
}));
vi.mock('@shared/api/client.js', async (importOriginal) => {
  Object.assign(actualClient, await importOriginal());
  return { ...actualClient, setAuthExpiredHandler, setAuthToken };
});

const { getItem, removeItem } = vi.hoisted(() => ({
  getItem: vi.fn().mockResolvedValue('http://vm-101:3099/api'),
  removeItem: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@shared/storage/index.js', () => ({ secureStore: { getItem, removeItem } }));

const { setPref } = vi.hoisted(() => ({ setPref: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./storage/prefsAdapter.js', () => ({ setPref }));

vi.mock('./MobileApp.jsx', () => ({ default: () => <div>THE_APP</div> }));
vi.mock('./Login.jsx', () => ({
  default: ({ askUrl, onConnected }) => (
    <div>
      <span>{`LOGIN askUrl=${String(!!askUrl)}`}</span>
      <button onClick={onConnected}>connect</button>
    </div>
  ),
}));

import App from './App.jsx';

// What the server and the stores saw, in order. The sign-out request answers 204
// unless a test stubs fetch again.
let order;
const SIGN_OUT = 'POST /api/auth/logout x-auth-token=phone-tok';

beforeEach(() => {
  vi.clearAllMocks();
  order = [];
  actualClient.setAuthToken('phone-tok'); // signed in: the token apiFetch holds
  getItem.mockResolvedValue('http://vm-101:3099/api');
  removeItem.mockImplementation(async (k) => {
    order.push(`remove ${k}`);
  });
  setPref.mockResolvedValue(undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, opts = {}) => {
      order.push(`${opts.method} ${url} x-auth-token=${opts.headers?.['x-auth-token']}`);
      return new Response(null, { status: 204 });
    })
  );
});

const capturedExpiryHandler = () =>
  setAuthExpiredHandler.mock.calls.map((c) => c[0]).find((fn) => typeof fn === 'function');

describe('App routing', () => {
  it('renders first-run login when there is no URL', () => {
    render(<App initial={{ hasUrl: false, hasToken: false }} />);
    expect(screen.getByText('LOGIN askUrl=true')).toBeInTheDocument();
  });

  it('renders credentials-only re-auth when URL known but no token', () => {
    render(<App initial={{ hasUrl: true, hasToken: false }} />);
    expect(screen.getByText('LOGIN askUrl=false')).toBeInTheDocument();
  });

  it('renders the app when URL + token are present', () => {
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    expect(screen.getByText('THE_APP')).toBeInTheDocument();
  });

  it('login onConnected transitions to the app', async () => {
    render(<App initial={{ hasUrl: false, hasToken: false }} />);
    fireEvent.click(screen.getByText('connect'));
    expect(await screen.findByText('THE_APP')).toBeInTheDocument();
  });

  it('logout drops an authed app to credentials-only re-auth and clears the token', async () => {
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    expect(screen.getByText('THE_APP')).toBeInTheDocument();
    await act(async () => {
      await logout();
    });
    expect(await screen.findByText('LOGIN askUrl=false')).toBeInTheDocument();
    expect(removeItem).toHaveBeenCalledWith('jaghelm-token');
    expect(setAuthToken).toHaveBeenCalledWith('');
  });

  // A throw stops the sequence before the UI drops to re-auth, so the caller
  // sees the error instead of a sign-out that did not finish.
  it('logout whose keep-signed-in write fails rejects and stays in the app', async () => {
    setPref.mockRejectedValue(new Error('preferences write failed'));
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    await act(async () => {
      await expect(logout()).rejects.toThrow('preferences write failed');
    });
    expect(screen.getByText('THE_APP')).toBeInTheDocument();
    expect(setAuthToken).not.toHaveBeenCalled();
  });

  it('forgetDevice drops an authed app to first-run and clears URL + token', async () => {
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    await act(async () => {
      await forgetDevice();
    });
    expect(await screen.findByText('LOGIN askUrl=true')).toBeInTheDocument();
    expect(removeItem).toHaveBeenCalledWith('jaghelm-token');
    expect(removeItem).toHaveBeenCalledWith('jaghelm-base-url');
    expect(setPref).toHaveBeenCalledWith('jaghelm-remember', 'false');
    expect(setPref).toHaveBeenCalledWith('jaghelm-base-url-present', 'false');
    expect(setAuthToken).toHaveBeenCalledWith('');
  });

  it('forgetDevice that fails removing the URL still leaves the app signed out', async () => {
    removeItem.mockImplementation(async (k) => {
      if (k === 'jaghelm-base-url') throw new Error('delete failed');
    });
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    await act(async () => {
      await expect(forgetDevice()).rejects.toThrow('delete failed');
    });
    expect(screen.getByText('LOGIN askUrl=false')).toBeInTheDocument();
    expect(setPref).toHaveBeenCalledWith('jaghelm-remember', 'false');
    expect(setPref).not.toHaveBeenCalledWith('jaghelm-base-url-present', 'false');
  });

  it('a 401 auth-expired event drops an authed app to re-auth', async () => {
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    const handler = capturedExpiryHandler();
    expect(typeof handler).toBe('function');
    await act(async () => {
      await handler();
    });
    expect(await screen.findByText('LOGIN askUrl=false')).toBeInTheDocument();
  });

  it('a 401 whose keep-signed-in write fails rejects and stays in the app', async () => {
    setPref.mockRejectedValue(new Error('preferences write failed'));
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    const handler = capturedExpiryHandler();
    await act(async () => {
      await expect(handler()).rejects.toThrow('preferences write failed');
    });
    expect(screen.getByText('THE_APP')).toBeInTheDocument();
    expect(setAuthToken).not.toHaveBeenCalled();
  });
});

describe('signing out revokes the session on the server (#507)', () => {
  const signedOut = async () => {
    expect(await screen.findByText('LOGIN askUrl=false')).toBeInTheDocument();
    expect(removeItem).toHaveBeenCalledWith('jaghelm-token');
    expect(setAuthToken).toHaveBeenCalledWith('');
  };

  it('logout asks the server to revoke the session before the phone forgets it', async () => {
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    await act(async () => {
      await logout();
    });
    await signedOut();
    expect(order).toEqual([SIGN_OUT, 'remove jaghelm-token']);
  });

  it.each([
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a 500', async () => new Response('{}', { status: 500 })],
  ])('logout still signs out when the request meets %s', async (_what, answer) => {
    vi.stubGlobal('fetch', vi.fn(answer));
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    await act(async () => {
      await expect(logout()).resolves.toBeUndefined();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await signedOut();
  });

  it('logout signs out after 5 s when the server never answers', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
      render(<App initial={{ hasUrl: true, hasToken: true }} />);
      let done = false;
      await act(async () => {
        logout().then(() => (done = true));
        await vi.advanceTimersByTimeAsync(actualClient.SIGN_OUT_TIMEOUT_MS - 1);
      });
      expect(done).toBe(false);
      expect(screen.getByText('THE_APP')).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(done).toBe(true);
      expect(screen.getByText('LOGIN askUrl=false')).toBeInTheDocument();
      expect(removeItem).toHaveBeenCalledWith('jaghelm-token');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Forget this device revokes the session before forgetting the server', async () => {
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    await act(async () => {
      await forgetDevice();
    });
    expect(await screen.findByText('LOGIN askUrl=true')).toBeInTheDocument();
    expect(order).toEqual([SIGN_OUT, 'remove jaghelm-token', 'remove jaghelm-base-url']);
  });

  it('Forget this device still forgets when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    await act(async () => {
      await forgetDevice();
    });
    expect(await screen.findByText('LOGIN askUrl=true')).toBeInTheDocument();
    expect(order).toEqual(['remove jaghelm-token', 'remove jaghelm-base-url']);
  });

  it('a 401 drops to re-auth without asking the server: that session is already dead', async () => {
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    await act(async () => {
      await capturedExpiryHandler()('phone-tok');
    });
    await signedOut();
    expect(fetch).not.toHaveBeenCalled();
  });
});
