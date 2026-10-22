import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// vi.hoisted() for every factory-referenced mock fn (repo convention; avoids the
// TDZ trap of a plain const referenced inside the hoisted vi.mock factory).
const { getPushStatus, getPushPrefs, setPushPrefs } = vi.hoisted(() => ({
  getPushStatus: vi.fn(), getPushPrefs: vi.fn(), setPushPrefs: vi.fn(),
}));
vi.mock('../push/pushPrefsApi.js', () => ({ getPushStatus, getPushPrefs, setPushPrefs }));

const { getPref } = vi.hoisted(() => ({ getPref: vi.fn() }));
vi.mock('../storage/prefsAdapter.js', () => ({ getPref, setPref: vi.fn() }));

const { disablePush, enablePush, pushWanted } = vi.hoisted(() => ({
  disablePush: vi.fn(), enablePush: vi.fn(), pushWanted: vi.fn(),
}));
vi.mock('../push/registerPush.js', () => ({ disablePush, enablePush, pushWanted }));

const { logout, forgetDevice } = vi.hoisted(() => ({ logout: vi.fn(), forgetDevice: vi.fn() }));
vi.mock('../auth/authState.js', () => ({ logout, forgetDevice }));

import NotificationSettings from './NotificationSettings.jsx';

const PREFS = {
  categories: { service: true, host: false, ups: true, cron: true, watchtower: true },
  notifyRecoveries: false,
  enabled: true,
};
const nav = { pop: vi.fn(), push: vi.fn() };

beforeEach(() => {
  getPushStatus.mockReset().mockResolvedValue({ enabled: true });
  getPushPrefs.mockReset().mockResolvedValue(PREFS);
  setPushPrefs.mockReset().mockResolvedValue(PREFS);
  getPref.mockReset().mockResolvedValue('fcmtok');
  disablePush.mockReset().mockResolvedValue(undefined);
  enablePush.mockReset().mockResolvedValue({ enabled: true, permission: 'granted', token: 'fcmtok2' });
  pushWanted.mockReset().mockResolvedValue(true);
  logout.mockReset();
  forgetDevice.mockReset();
});

describe('NotificationSettings (session controls)', () => {
  it('logs out when "Log out" is tapped', async () => {
    render(<NotificationSettings nav={nav} />);
    fireEvent.click(await screen.findByRole('button', { name: /log out/i }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('requires a confirmation step before forgetting the device', async () => {
    render(<NotificationSettings nav={nav} />);
    fireEvent.click(await screen.findByRole('button', { name: /forget this device/i }));
    expect(forgetDevice).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^forget$/i }));
    expect(forgetDevice).toHaveBeenCalledTimes(1);
  });

  it('can cancel the forget-device confirmation', async () => {
    render(<NotificationSettings nav={nav} />);
    fireEvent.click(await screen.findByRole('button', { name: /forget this device/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(forgetDevice).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /forget this device/i })).toBeInTheDocument();
  });
});

describe('NotificationSettings (read path)', () => {
  it('loads prefs and reflects them in the five category + recovery + master controls', async () => {
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushPrefs).toHaveBeenCalledWith('fcmtok'));
    expect(screen.getByRole('switch', { name: /services/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /hosts/i })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /ups/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /cron/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /^updates$/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /notify on recovery/i })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /enable push|push notifications/i })).toBeChecked();
  });

  it('grays out (unavailable) when status.enabled is false — no false "push on"', async () => {
    getPushStatus.mockResolvedValue({ enabled: false });
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushStatus).toHaveBeenCalled());
    expect(screen.getByText(/unavailable|not configured/i)).toBeInTheDocument();
    expect(getPushPrefs).not.toHaveBeenCalled();
  });

  it('shows the unavailable state when no device token is registered', async () => {
    getPref.mockResolvedValue(null);
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(screen.getByText(/not registered|unavailable/i)).toBeInTheDocument());
    expect(getPushPrefs).not.toHaveBeenCalled();
  });

  it('labels the watchtower category "Updates" and keeps its pref key', async () => {
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushPrefs).toHaveBeenCalled());
    expect(screen.queryByRole('switch', { name: /watchtower/i })).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: /^updates$/i }));
    await waitFor(() => expect(setPushPrefs).toHaveBeenCalledTimes(1));
    const [, sent] = setPushPrefs.mock.calls[0];
    expect(sent.categories).toEqual({ service: true, host: false, ups: true, cron: true, watchtower: false });
  });

  it('every control sits in a .notif-row (CSS-class smoke check for the >=44px row; jsdom has no layout)', async () => {
    // NOTE: jsdom does not compute layout, so this CANNOT assert real pixels.
    // It is a class-PRESENCE smoke check: the >=44px min-height lives in
    // .notif-row (Task 9 CSS); a real tap-target measurement would need a
    // browser/e2e runner (out of unit scope). Named honestly per the review.
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushPrefs).toHaveBeenCalled());
    for (const sw of screen.getAllByRole('switch')) {
      expect(sw.closest('.notif-row')).not.toBeNull();
    }
  });
});

describe('NotificationSettings (write path)', () => {
  it('toggling Hosts ON sends the FULL prefs object with host:true (no extra keys)', async () => {
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushPrefs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('switch', { name: /hosts/i }));
    await waitFor(() => expect(setPushPrefs).toHaveBeenCalledTimes(1));
    const [tok, sent] = setPushPrefs.mock.calls[0];
    expect(tok).toBe('fcmtok');
    expect(sent).toEqual({
      categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
      notifyRecoveries: false,
      enabled: true,
    });
    expect(Object.keys(sent).sort()).toEqual(['categories', 'enabled', 'notifyRecoveries']);
    expect(Object.keys(sent.categories).sort()).toEqual(['cron', 'host', 'service', 'ups', 'watchtower']);
  });

  it('master OFF sends enabled:false via PUT (token KEPT — no DELETE here)', async () => {
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushPrefs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('switch', { name: /enable push|push notifications/i }));
    await waitFor(() => expect(setPushPrefs).toHaveBeenCalled());
    const [, sent] = setPushPrefs.mock.calls[0];
    expect(sent.enabled).toBe(false);
  });

  it('reverts the optimistic toggle when the PUT fails', async () => {
    setPushPrefs.mockRejectedValueOnce(new Error('400'));
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushPrefs).toHaveBeenCalled());
    const recovery = screen.getByRole('switch', { name: /notify on recovery/i });
    expect(recovery).not.toBeChecked();
    fireEvent.click(recovery);
    await waitFor(() => expect(setPushPrefs).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('switch', { name: /notify on recovery/i })).not.toBeChecked());
  });
});

describe('NotificationSettings — reskin (carbon tokens + indigo switches)', () => {
  it('every toggle input carries the notif-switch class (accent-color: var(--accent) is applied via this class)', async () => {
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushPrefs).toHaveBeenCalled());
    for (const sw of screen.getAllByRole('switch')) {
      expect(sw).toHaveClass('notif-switch');
    }
  });
});

describe('NotificationSettings — turn off push (DELETE teardown)', () => {
  it('fires disablePush(token) and drops to the unavailable state', async () => {
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushPrefs).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /turn off push on this device/i }));
    await waitFor(() => expect(disablePush).toHaveBeenCalledWith('fcmtok'));
    // After teardown the screen no longer shows the live toggles.
    await waitFor(() =>
      expect(screen.queryByRole('switch', { name: /enable push|push notifications/i })).toBeNull(),
    );
    expect(screen.getByText(/not registered|unavailable|turned off/i)).toBeInTheDocument();
  });
});

describe('NotificationSettings — the push choice sticks (#539)', () => {
  it('turned off on this device: says so, loads no prefs, offers Turn on', async () => {
    pushWanted.mockResolvedValue(false);
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    expect(await screen.findByText('Push is turned off on this device.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /turn on push on this device/i })).toBeInTheDocument();
    expect(getPushPrefs).not.toHaveBeenCalled();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('Turn on registers push again, then loads the new token\'s prefs', async () => {
    pushWanted.mockResolvedValueOnce(false);
    getPref.mockResolvedValue('fcmtok2');
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    fireEvent.click(await screen.findByRole('button', { name: /turn on push on this device/i }));
    await waitFor(() => expect(enablePush).toHaveBeenCalledWith({ nav }));
    await waitFor(() => expect(getPushPrefs).toHaveBeenCalledWith('fcmtok2'));
    expect(await screen.findByRole('switch', { name: 'Enable push notifications' })).toBeInTheDocument();
  });

  it('Turn on with no token (permission off in Android) says it is not registered', async () => {
    pushWanted.mockResolvedValueOnce(false);
    enablePush.mockResolvedValue({ enabled: false, permission: 'denied' });
    getPref.mockResolvedValue(null);
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    fireEvent.click(await screen.findByRole('button', { name: /turn on push on this device/i }));
    expect(await screen.findByText(/push not registered on this device/i)).toBeInTheDocument();
  });

  it('Turn off then shows the Turn on button', async () => {
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    fireEvent.click(await screen.findByRole('button', { name: /turn off push on this device/i }));
    expect(await screen.findByRole('button', { name: /turn on push on this device/i })).toBeInTheDocument();
  });
});
