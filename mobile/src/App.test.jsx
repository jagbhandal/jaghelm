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

const { setPref, getPref } = vi.hoisted(() => ({
  setPref: vi.fn().mockResolvedValue(undefined),
  getPref: vi.fn(),
}));
vi.mock('./storage/prefsAdapter.js', () => ({ setPref, getPref }));

// The real push teardown (#531) over a mocked plugin, in a build with push.
const push = vi.hoisted(() => ({ removeAllListeners: vi.fn(), unregister: vi.fn() }));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: push }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }));
vi.mock('./push/pushConfig.js', () => ({ isPushConfigured: () => true }));

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

// What the server and the stores saw, in order. Every request answers 204
// unless a test stubs fetch again.
let order;
const SIGN_OUT = 'POST /api/auth/logout x-auth-token=phone-tok';
const UNREGISTER = 'DELETE /api/push/register x-auth-token=phone-tok';

beforeEach(() => {
  vi.clearAllMocks();
  order = [];
  actualClient.setAuthToken('phone-tok'); // signed in: the token apiFetch holds
  getItem.mockResolvedValue('http://vm-101:3099/api');
  removeItem.mockImplementation(async (k) => {
    order.push(`remove ${k}`);
  });
  setPref.mockResolvedValue(undefined);
  getPref.mockImplementation(async (k) => (k === 'jaghelm-push-token' ? 'fcm-tok' : null));
  push.removeAllListeners.mockResolvedValue(undefined);
  push.unregister.mockResolvedValue(undefined);
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

  // A server that answers the push unregister and the sign-out only when the
  // test says so.
  function gatedServer() {
    const releases = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url, opts) => {
        order.push(`${opts.method} ${url} x-auth-token=${opts.headers['x-auth-token']}`);
        return new Promise((resolve) => {
          releases.push(() => {
            order.push('answered');
            resolve(new Response(null, { status: 204 }));
          });
        });
      })
    );
    return { release: () => releases.forEach((r) => r()) };
  }

  it('logout sends the revoke request, then forgets the token without waiting for the answer', async () => {
    const server = gatedServer();
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    let done = false;
    let pending;
    await act(async () => {
      pending = logout().then(() => (done = true));
    });
    await signedOut();
    expect(order).toEqual([UNREGISTER, SIGN_OUT, 'remove jaghelm-token']);
    expect(done).toBe(false);
    await act(async () => {
      server.release();
      await pending;
    });
    expect(order).toEqual([UNREGISTER, SIGN_OUT, 'remove jaghelm-token', 'answered', 'answered']);
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
    expect(fetch).toHaveBeenCalledTimes(2); // the push unregister (#531) and the revoke
    await signedOut();
  });

  it('logout forgets the token at once when the server never answers, and settles after 5 s', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
      render(<App initial={{ hasUrl: true, hasToken: true }} />);
      let done = false;
      await act(async () => {
        logout().then(() => (done = true));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(screen.getByText('LOGIN askUrl=false')).toBeInTheDocument();
      expect(removeItem).toHaveBeenCalledWith('jaghelm-token');
      expect(done).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(actualClient.SIGN_OUT_TIMEOUT_MS);
      });
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Forget this device sends the revoke request, then forgets the server without waiting', async () => {
    const server = gatedServer();
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    let pending;
    await act(async () => {
      pending = forgetDevice();
    });
    expect(await screen.findByText('LOGIN askUrl=true')).toBeInTheDocument();
    expect(order).toEqual([UNREGISTER, SIGN_OUT, 'remove jaghelm-token', 'remove jaghelm-base-url']);
    await act(async () => {
      server.release();
      await pending;
    });
    expect(order.at(-1)).toBe('answered');
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

describe('signing out unregisters push first (#531)', () => {
  // The plugin's teardown joins the server's and the stores' order.
  beforeEach(() => {
    push.removeAllListeners.mockImplementation(async () => order.push('removeAllListeners'));
    push.unregister.mockImplementation(async () => order.push('unregister'));
  });

  // The requests the server saw, in the order they were sent.
  const requests = () => order.filter((e) => /^(DELETE|POST) /.test(e));
  const deleteBody = () =>
    JSON.parse(fetch.mock.calls.find(([, o]) => o.method === 'DELETE')[1].body);

  // The DELETE answers with `answer`; the revoke answers 204.
  function unregisterAnswers(answer) {
    vi.stubGlobal(
      'fetch',
      vi.fn((url, opts) => {
        order.push(`${opts.method} ${url} x-auth-token=${opts.headers['x-auth-token']}`);
        return opts.method === 'DELETE' ? answer() : Promise.resolve(new Response(null, { status: 204 }));
      })
    );
  }

  it('Log out sends DELETE /api/push/register with the live session before the revoke, and tears push down', async () => {
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    await act(async () => {
      await logout();
    });
    expect(screen.getByText('LOGIN askUrl=false')).toBeInTheDocument();
    expect(requests()).toEqual([UNREGISTER, SIGN_OUT]);
    expect(deleteBody()).toEqual({ token: 'fcm-tok' });
    expect(order).toEqual(expect.arrayContaining(['removeAllListeners', 'unregister', 'remove jaghelm-token']));
    expect(setPref).toHaveBeenCalledWith('jaghelm-push-token', '');
  });

  it.each([
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a 500', async () => new Response('{}', { status: 500 })],
  ])('Log out still signs out and revokes when the unregister meets %s', async (_what, answer) => {
    unregisterAnswers(answer);
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    await act(async () => {
      await expect(logout()).resolves.toBeUndefined();
    });
    expect(screen.getByText('LOGIN askUrl=false')).toBeInTheDocument();
    expect(order).toEqual(expect.arrayContaining([UNREGISTER, SIGN_OUT, 'remove jaghelm-token', 'unregister']));
  });

  it('Log out clears at once when the unregister hangs, and settles after 5 s', async () => {
    vi.useFakeTimers();
    try {
      unregisterAnswers(() => new Promise(() => {}));
      render(<App initial={{ hasUrl: true, hasToken: true }} />);
      let done = false;
      await act(async () => {
        logout().then(() => (done = true));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText('LOGIN askUrl=false')).toBeInTheDocument();
      expect(order).toEqual(expect.arrayContaining([SIGN_OUT, 'remove jaghelm-token', 'removeAllListeners', 'unregister']));
      expect(done).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(actualClient.SIGN_OUT_TIMEOUT_MS);
      });
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Log out with no push token registered sends only the revoke', async () => {
    getPref.mockResolvedValue(null);
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    await act(async () => {
      await logout();
    });
    expect(requests()).toEqual([SIGN_OUT]);
    expect(push.removeAllListeners).toHaveBeenCalled();
  });

  it('Forget this device sends the unregister before the revoke and tears push down', async () => {
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    await act(async () => {
      await forgetDevice();
    });
    expect(screen.getByText('LOGIN askUrl=true')).toBeInTheDocument();
    expect(requests()).toEqual([UNREGISTER, SIGN_OUT]);
    expect(deleteBody()).toEqual({ token: 'fcm-tok' });
    expect(order).toEqual(
      expect.arrayContaining(['removeAllListeners', 'unregister', 'remove jaghelm-token', 'remove jaghelm-base-url'])
    );
  });

  it('Forget this device forgets at once when the unregister hangs', async () => {
    vi.useFakeTimers();
    try {
      unregisterAnswers(() => new Promise(() => {}));
      render(<App initial={{ hasUrl: true, hasToken: true }} />);
      let done = false;
      await act(async () => {
        forgetDevice().then(() => (done = true));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText('LOGIN askUrl=true')).toBeInTheDocument();
      expect(order).toEqual(expect.arrayContaining([SIGN_OUT, 'remove jaghelm-base-url']));
      expect(done).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(actualClient.SIGN_OUT_TIMEOUT_MS);
      });
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a 401 drops to re-auth without unregistering push: that session is already dead', async () => {
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    await act(async () => {
      await capturedExpiryHandler()('phone-tok');
    });
    expect(await screen.findByText('LOGIN askUrl=false')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(getPref).not.toHaveBeenCalledWith('jaghelm-push-token');
    expect(push.removeAllListeners).not.toHaveBeenCalled();
    expect(push.unregister).not.toHaveBeenCalled();
  });
});
