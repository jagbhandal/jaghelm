import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// vi.hoisted() for every factory-referenced mock fn (repo convention; avoids the
// TDZ trap of a plain const referenced inside the hoisted vi.mock factory).
const { getPushStatus, getPushPrefs, setPushPrefs } = vi.hoisted(() => ({
  getPushStatus: vi.fn(), getPushPrefs: vi.fn(), setPushPrefs: vi.fn(),
}));
vi.mock('../push/pushPrefsApi.js', () => ({ getPushStatus, getPushPrefs, setPushPrefs }));

const { getPref } = vi.hoisted(() => ({ getPref: vi.fn() }));
vi.mock('../storage/prefsAdapter.js', () => ({ getPref, setPref: vi.fn() }));

import NotificationSettings from './NotificationSettings.jsx';

const PREFS = {
  categories: { service: true, host: false, ups: true, cron: true },
  notifyRecoveries: false,
  enabled: true,
};
const nav = { pop: vi.fn(), push: vi.fn() };

beforeEach(() => {
  getPushStatus.mockReset().mockResolvedValue({ enabled: true });
  getPushPrefs.mockReset().mockResolvedValue(PREFS);
  setPushPrefs.mockReset().mockResolvedValue(PREFS);
  getPref.mockReset().mockResolvedValue('fcmtok');
});

describe('NotificationSettings (read path)', () => {
  it('loads prefs and reflects them in the four category + recovery + master controls', async () => {
    render(<NotificationSettings nav={nav} data={{}} params={{}} />);
    await waitFor(() => expect(getPushPrefs).toHaveBeenCalledWith('fcmtok'));
    expect(screen.getByRole('switch', { name: /services/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /hosts/i })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: /ups/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /cron/i })).toBeChecked();
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
