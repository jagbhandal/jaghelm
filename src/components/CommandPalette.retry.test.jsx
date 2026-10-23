import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConfigProvider } from '../context/ConfigContext.jsx';

// The palette's index failing to load, then loading on the next open (#611).
// Failure is a rejection (offline) or a module-less resolve (chunkReload.js
// cancels the first preload error in a build, so import() gives undefined).
const load = vi.hoisted(() => vi.fn());
vi.mock('../lazyViews.js', () => ({ loadCommandPaletteIndex: load }));

const { default: CommandPalette } = await import('./CommandPalette.jsx');

const palette = () => (
  <ConfigProvider config={{ links: {} }} setConfig={vi.fn()}>
    <CommandPalette
      open
      onClose={vi.fn()}
      pages={[{ id: 'alerts', label: 'Alerts', href: '/alerts' }]}
      onNavigate={vi.fn()}
    />
  </ConfigProvider>
);

describe('CommandPalette retries its index on the next open', () => {
  it('shows the error when the first load rejects, then lists when the next open loads', async () => {
    load.mockRejectedValueOnce(new Error('offline'));
    const first = render(palette());
    expect(await screen.findByRole('status')).toHaveTextContent('Search couldn’t load');
    first.unmount();

    load.mockResolvedValueOnce(await import('./CommandPaletteIndex.js'));
    render(palette());
    expect(await screen.findByRole('option', { name: /Alerts/ })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
