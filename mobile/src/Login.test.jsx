import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { login } = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock('./login.js', () => ({ login }));

const { setItem, removeItem } = vi.hoisted(() => ({
  setItem: vi.fn().mockResolvedValue(undefined),
  removeItem: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@shared/storage/index.js', () => ({ secureStore: { setItem, removeItem } }));

const { setPref } = vi.hoisted(() => ({ setPref: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./storage/prefsAdapter.js', () => ({ setPref }));

import Login from './Login.jsx';

beforeEach(() => {
  login.mockReset();
  setItem.mockReset().mockResolvedValue(undefined);
  removeItem.mockReset().mockResolvedValue(undefined);
  setPref.mockReset().mockResolvedValue(undefined);
});

function fill({ url, username, password }) {
  if (url !== undefined) {
    fireEvent.change(screen.getByLabelText(/backend url/i), { target: { value: url } });
  }
  fireEvent.change(screen.getByLabelText(/username/i), { target: { value: username } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
}

describe('Login', () => {
  it('blocks submit and shows errors on empty credentials, never calling login', async () => {
    render(<Login askUrl onConnected={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText(/enter your username/i)).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('on success persists token+url+presence+remember and calls onConnected (first-run)', async () => {
    login.mockResolvedValue({ ok: true, token: 'abc' });
    const onConnected = vi.fn();
    render(<Login askUrl onConnected={onConnected} />);
    fill({ url: 'http://vm-101:3099', username: 'admin', password: 'pw' });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    expect(login).toHaveBeenCalledWith({ url: 'http://vm-101:3099', username: 'admin', password: 'pw' });
    expect(setItem).toHaveBeenCalledWith('jaghelm-token', 'abc');
    expect(setItem).toHaveBeenCalledWith('jaghelm-base-url', 'http://vm-101:3099/api');
    expect(setPref).toHaveBeenCalledWith('jaghelm-base-url-present', 'true');
    expect(setPref).toHaveBeenCalledWith('jaghelm-remember', 'true');
  });

  it('on failure shows the error and does NOT persist or proceed', async () => {
    login.mockResolvedValue({ ok: false, error: 'Invalid credentials' });
    const onConnected = vi.fn();
    render(<Login askUrl onConnected={onConnected} />);
    fill({ url: 'http://vm-101:3099', username: 'admin', password: 'bad' });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('credentials-only mode hides the URL field and reuses knownUrl', async () => {
    login.mockResolvedValue({ ok: true, token: 'xyz' });
    const onConnected = vi.fn();
    render(<Login askUrl={false} knownUrl="http://vm-101:3099" onConnected={onConnected} />);
    expect(screen.queryByLabelText(/backend url/i)).toBeNull();
    fill({ username: 'admin', password: 'pw' });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    expect(login).toHaveBeenCalledWith({ url: 'http://vm-101:3099', username: 'admin', password: 'pw' });
    expect(setItem).toHaveBeenCalledWith('jaghelm-base-url', 'http://vm-101:3099/api');
  });

  it('with "keep me signed in" unchecked stores remember=false and does NOT persist the token', async () => {
    login.mockResolvedValue({ ok: true, token: 'abc' });
    render(<Login askUrl onConnected={() => {}} />);
    fill({ url: 'http://vm-101:3099', username: 'admin', password: 'pw' });
    fireEvent.click(screen.getByLabelText(/keep me signed in/i)); // default checked → uncheck
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(setPref).toHaveBeenCalledWith('jaghelm-remember', 'false'));
    expect(setItem).not.toHaveBeenCalledWith('jaghelm-token', 'abc');
    expect(removeItem).toHaveBeenCalledWith('jaghelm-token');
  });
});
