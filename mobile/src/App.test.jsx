import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { logout, forgetDevice } from './auth/authState.js';

const { setAuthExpiredHandler, setAuthToken } = vi.hoisted(() => ({
  setAuthExpiredHandler: vi.fn(),
  setAuthToken: vi.fn(),
}));
vi.mock('@shared/api/client.js', () => ({ setAuthExpiredHandler, setAuthToken }));

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

beforeEach(() => {
  vi.clearAllMocks();
  getItem.mockResolvedValue('http://vm-101:3099/api');
  removeItem.mockResolvedValue(undefined);
  setPref.mockResolvedValue(undefined);
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

  it('forgetDevice drops an authed app to first-run and clears URL + token', async () => {
    render(<App initial={{ hasUrl: true, hasToken: true }} />);
    await act(async () => {
      await forgetDevice();
    });
    expect(await screen.findByText('LOGIN askUrl=true')).toBeInTheDocument();
    expect(removeItem).toHaveBeenCalledWith('jaghelm-token');
    expect(removeItem).toHaveBeenCalledWith('jaghelm-base-url');
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
});
