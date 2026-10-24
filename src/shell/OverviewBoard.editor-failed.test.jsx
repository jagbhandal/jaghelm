import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfigProvider } from '../context/ConfigContext.jsx';
import { defaultConfig } from '../defaultConfig.js';
import { twoPis } from '../testing/statusFixtures.js';
import OverviewBoard from './OverviewBoard.jsx';

// An Edit layout chunk that won't load (an old tab after a deploy) is said
// inline, with Reload, and turns the mode off: never a pressed toggle with
// nothing under it (#660's dead control).
vi.mock('../lazyViews.js', () => ({
  loadOverviewEditor: () =>
    Promise.reject(new Error('Failed to fetch dynamically imported module')),
  loadOverviewJobs: () => Promise.resolve({ default: () => null }),
  loadHostActions: () => Promise.resolve({ default: () => null }),
  loadExpiry: () => Promise.resolve({ default: () => null }),
}));
vi.mock('./useDashboardData.js', () => ({
  useDashboardData: () => ({
    serviceData: twoPis().services,
    integrationData: {},
    history: {},
    servicesLoaded: true,
    sources: {
      services: { error: null, staleNote: null },
      integrations: { error: null, staleNote: null },
    },
    retry: () => {},
  }),
}));

describe('Edit layout when its chunk fails to load', () => {
  it('says so with Reload and Dismiss, and tells the shell to turn the mode off', async () => {
    const onDoneEditing = vi.fn();
    const status = twoPis().status;
    const updated = { get: () => Date.now(), subscribe: () => () => {}, staleAfter: 72_000 };
    const ui = (editing) => (
      <ConfigProvider config={defaultConfig()} setConfig={vi.fn()}>
        <OverviewBoard
          tick={0}
          active
          editing={editing}
          onDoneEditing={onDoneEditing}
          status={status}
          reach="ok"
          updated={updated}
        />
      </ConfigProvider>
    );
    const { rerender } = render(ui(true));
    expect(await screen.findByText("Edit layout couldn't load")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    await waitFor(() => expect(onDoneEditing).toHaveBeenCalled());
    // The shell turned the mode off; the failure stays until dismissed.
    rerender(ui(false));
    expect(screen.getByText("Edit layout couldn't load")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText("Edit layout couldn't load")).toBeNull();
  });
});
