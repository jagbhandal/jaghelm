import React, { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { bootMobile } = vi.hoisted(() => ({ bootMobile: vi.fn() }));
vi.mock('./boot.js', () => ({ bootMobile }));

const { setAuthExpiredHandler, setAuthToken } = vi.hoisted(() => ({
  setAuthExpiredHandler: vi.fn(),
  setAuthToken: vi.fn(),
}));
vi.mock('@shared/api/client.js', () => ({ setAuthExpiredHandler, setAuthToken }));

const { getItem, removeItem } = vi.hoisted(() => ({
  getItem: vi.fn(),
  removeItem: vi.fn(),
}));
vi.mock('@shared/storage/index.js', () => ({ secureStore: { getItem, removeItem } }));

const { setPref } = vi.hoisted(() => ({ setPref: vi.fn() }));
vi.mock('./storage/prefsAdapter.js', () => ({ setPref }));

// The real App routes; only its leaves are stubbed (same pattern as App.test.jsx).
const appMode = vi.hoisted(() => ({ crash: false }));
vi.mock('./MobileApp.jsx', () => ({
  default: () => {
    if (appMode.crash) throw new Error('render crash');
    return <div>THE_APP</div>;
  },
}));
vi.mock('./Login.jsx', () => ({
  default: ({ askUrl }) => <span>{`LOGIN askUrl=${String(!!askUrl)}`}</span>,
}));

import Root from './Root.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

const BASE = 'http://vm-101:3099/api';
const REACHABLE = { hasUrl: true, hasToken: true, baseUrl: BASE };
const UNREACHABLE = { hasUrl: true, hasToken: true, baseUrl: BASE, unreachable: true };
const TAILSCALE_LINE = "If you're away from home, check that Tailscale is connected on this phone.";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  appMode.crash = false;
  getItem.mockResolvedValue(BASE);
  removeItem.mockResolvedValue(undefined);
  setPref.mockResolvedValue(undefined);
});

describe('Root', () => {
  it('renders the connecting screen before boot resolves', () => {
    bootMobile.mockReturnValue(new Promise(() => {}));
    render(<Root />);
    expect(screen.getByText('Connecting to JagHelm…')).toBeInTheDocument();
    expect(screen.queryByText('THE_APP')).not.toBeInTheDocument();
  });

  it('renders the app when boot resolves reachable', async () => {
    bootMobile.mockResolvedValue(REACHABLE);
    render(<Root />);
    expect(await screen.findByText('THE_APP')).toBeInTheDocument();
  });

  it('an unreachable boot shows the connection screen with the address and the Tailscale line', async () => {
    bootMobile.mockResolvedValue(UNREACHABLE);
    render(<Root />);
    expect(await screen.findByText("Can't reach JagHelm")).toBeInTheDocument();
    expect(screen.getByText(BASE)).toBeInTheDocument();
    expect(screen.getByText(TAILSCALE_LINE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change server' })).toBeInTheDocument();
    expect(screen.queryByText('THE_APP')).not.toBeInTheDocument();
  });

  it('Retry re-runs boot, shows connecting, and a reachable result enters the app', async () => {
    const second = deferred();
    bootMobile.mockResolvedValueOnce(UNREACHABLE).mockReturnValueOnce(second.promise);
    render(<Root />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(screen.getByText('Connecting to JagHelm…')).toBeInTheDocument();
    expect(bootMobile).toHaveBeenCalledTimes(2);
    await act(async () => {
      second.resolve(REACHABLE);
    });
    expect(screen.getByText('THE_APP')).toBeInTheDocument();
    expect(removeItem).not.toHaveBeenCalled(); // Retry keeps the saved session
  });

  it('Change server clears URL + token like forget-device and ends on first-run login', async () => {
    bootMobile
      .mockResolvedValueOnce(UNREACHABLE)
      .mockResolvedValueOnce({ hasUrl: false, hasToken: false, baseUrl: '' });
    render(<Root />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change server' }));
    expect(await screen.findByText('LOGIN askUrl=true')).toBeInTheDocument();

    expect(removeItem).toHaveBeenCalledWith('jaghelm-token');
    expect(removeItem).toHaveBeenCalledWith('jaghelm-base-url');
    expect(setPref).toHaveBeenCalledWith('jaghelm-remember', 'false');
    expect(setPref).toHaveBeenCalledWith('jaghelm-base-url-present', 'false');
    expect(setAuthToken).toHaveBeenCalledWith('');
    // The clearing finishes before the re-boot reads storage.
    const lastClear = Math.max(
      ...removeItem.mock.invocationCallOrder,
      ...setPref.mock.invocationCallOrder,
    );
    expect(bootMobile.mock.invocationCallOrder[1]).toBeGreaterThan(lastClear);
  });

  it('a boot that throws shows "Something went wrong", and Retry recovers', async () => {
    bootMobile.mockRejectedValueOnce(new Error('keystore failure')).mockResolvedValueOnce(REACHABLE);
    render(<Root />);
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('THE_APP')).toBeInTheDocument();
    expect(bootMobile).toHaveBeenCalledTimes(2);
  });

  it('a render crash in the app shows "Something went wrong" instead of a blank screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    appMode.crash = true;
    bootMobile.mockResolvedValue(REACHABLE);
    render(<Root />);
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('a superseded attempt resolving late does not replace the app (StrictMode double mount)', async () => {
    const first = deferred();
    bootMobile.mockReturnValueOnce(first.promise).mockResolvedValueOnce(REACHABLE);
    render(
      <StrictMode>
        <Root />
      </StrictMode>,
    );
    expect(await screen.findByText('THE_APP')).toBeInTheDocument();
    expect(bootMobile).toHaveBeenCalledTimes(2);

    await act(async () => {
      first.resolve(UNREACHABLE);
    });
    expect(screen.getByText('THE_APP')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach JagHelm")).not.toBeInTheDocument();
  });

  it('unmounting while an attempt is pending, then resolving it, updates nothing and logs nothing', async () => {
    const errorSpy = vi.spyOn(console, 'error');
    const pending = deferred();
    bootMobile.mockReturnValue(pending.promise);
    const { unmount } = render(<Root />);
    unmount();
    await act(async () => {
      pending.resolve(UNREACHABLE);
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('ErrorBoundary', () => {
  function Thrower() {
    throw new Error('boom');
  }

  it('a child that throws renders "Something went wrong" with Retry', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onRetry = vi.fn();
    render(
      <ErrorBoundary onRetry={onRetry}>
        <Thrower />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <span>fine</span>
      </ErrorBoundary>,
    );
    expect(screen.getByText('fine')).toBeInTheDocument();
  });
});
