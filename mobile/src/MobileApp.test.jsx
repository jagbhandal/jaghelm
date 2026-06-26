import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// vi.hoisted ensures mock fn declarations are initialized before vi.mock factories
// are hoisted and executed (Vitest 4.x requirement; avoids ReferenceError on const).
const { getPref, setPref } = vi.hoisted(() => ({ getPref: vi.fn(), setPref: vi.fn() }));
vi.mock('./storage/prefsAdapter.js', () => ({ getPref, setPref }));

const { addListener, exitApp } = vi.hoisted(() => ({ addListener: vi.fn(), exitApp: vi.fn() }));
vi.mock('@capacitor/app', () => ({ App: { addListener, exitApp } }));

import MobileApp from './MobileApp.jsx';

beforeEach(() => {
  getPref.mockReset().mockResolvedValue(null);
  setPref.mockReset().mockResolvedValue(undefined);
  addListener.mockClear();
  exitApp.mockClear();
  addListener.mockReturnValue({ remove: vi.fn() });
});

describe('MobileApp shell', () => {
  it('renders all four tabs and defaults to Overview', async () => {
    render(<MobileApp />);
    for (const label of ['Overview', 'Services', 'Infra', 'Alerts']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('switches tab on tap and persists it to Preferences', async () => {
    render(<MobileApp />);
    fireEvent.click(screen.getByRole('tab', { name: 'Infra' }));
    expect(screen.getByRole('tab', { name: 'Infra' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await waitFor(() =>
      expect(setPref).toHaveBeenCalledWith('jaghelm-last-tab', 'infra')
    );
  });

  it('restores the last tab from Preferences on mount', async () => {
    getPref.mockResolvedValue('alerts');
    render(<MobileApp />);
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Alerts' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    );
  });

  it('registers a hardware-back listener', () => {
    render(<MobileApp />);
    expect(addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
  });
});
