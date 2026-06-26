import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

import { getPref, setPref } from './prefsAdapter.js';
import { Preferences } from '@capacitor/preferences';

const get = vi.mocked(Preferences.get);
const set = vi.mocked(Preferences.set);

beforeEach(() => {
  get.mockReset();
  set.mockReset();
});

describe('prefsAdapter', () => {
  it('getPref returns the stored value', async () => {
    get.mockResolvedValue({ value: 'dracula' });
    await expect(getPref('jaghelm-theme')).resolves.toBe('dracula');
    expect(get).toHaveBeenCalledWith({ key: 'jaghelm-theme' });
  });

  it('getPref returns null when unset', async () => {
    get.mockResolvedValue({ value: null });
    await expect(getPref('jaghelm-theme')).resolves.toBeNull();
  });

  it('setPref writes a string value', async () => {
    set.mockResolvedValue();
    await setPref('jaghelm-last-tab', 'infra');
    expect(set).toHaveBeenCalledWith({ key: 'jaghelm-last-tab', value: 'infra' });
  });
});
