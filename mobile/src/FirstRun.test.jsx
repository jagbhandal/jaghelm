import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { testConnection } = vi.hoisted(() => ({ testConnection: vi.fn() }));
vi.mock('./connect.js', () => ({ testConnection }));

const { setItem } = vi.hoisted(() => ({ setItem: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@shared/storage/index.js', () => ({ secureStore: { setItem } }));

const { setPref } = vi.hoisted(() => ({ setPref: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./storage/prefsAdapter.js', () => ({ setPref }));

import FirstRun from './FirstRun.jsx';

beforeEach(() => {
  testConnection.mockReset();
  setItem.mockReset().mockResolvedValue(undefined);
  setPref.mockReset().mockResolvedValue(undefined);
});

describe('FirstRun', () => {
  it('shows validation errors and does not test on bad input', async () => {
    render(<FirstRun onConnected={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /test & connect/i }));
    expect(await screen.findByText(/valid http/i)).toBeInTheDocument();
    expect(testConnection).not.toHaveBeenCalled();
  });

  it('on success writes token+URL to Keystore, URL-presence to Prefs, calls onConnected', async () => {
    testConnection.mockResolvedValue({ ok: true, status: 200 });
    const onConnected = vi.fn();
    render(<FirstRun onConnected={onConnected} />);
    fireEvent.change(screen.getByLabelText(/backend url/i), {
      target: { value: 'http://vm-101:3099' },
    });
    fireEvent.change(screen.getByLabelText(/access token/i), {
      target: { value: 'tok123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /test & connect/i }));

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    expect(setItem).toHaveBeenCalledWith('jaghelm-token', 'tok123');
    expect(setItem).toHaveBeenCalledWith('jaghelm-base-url', 'http://vm-101:3099/api');
    expect(setPref).toHaveBeenCalledWith('jaghelm-base-url-present', 'true');
  });

  it('on failure shows an error and does NOT persist or proceed', async () => {
    testConnection.mockResolvedValue({ ok: false, status: 401, error: 'HTTP 401' });
    const onConnected = vi.fn();
    render(<FirstRun onConnected={onConnected} />);
    fireEvent.change(screen.getByLabelText(/backend url/i), {
      target: { value: 'http://vm-101:3099' },
    });
    fireEvent.change(screen.getByLabelText(/access token/i), {
      target: { value: 'bad' },
    });
    fireEvent.click(screen.getByRole('button', { name: /test & connect/i }));

    expect(await screen.findByText(/HTTP 401/)).toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();
  });
});
