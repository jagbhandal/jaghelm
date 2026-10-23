import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CommandPalette from './CommandPalette.jsx';
import { ConfigProvider } from '../context/ConfigContext.jsx';

// The palette when its index's chunk cannot be fetched (#611): it says so,
// instead of an empty list that reads as no results.
vi.mock('../lazyViews.js', () => ({
  loadCommandPaletteIndex: () => Promise.reject(new Error('offline')),
}));

describe('CommandPalette when its index cannot load', () => {
  it('says so, not “Loading…” or “Nothing to show”', async () => {
    render(
      <ConfigProvider config={{ links: {} }} setConfig={vi.fn()}>
        <CommandPalette open onClose={vi.fn()} onNavigate={vi.fn()} />
      </ConfigProvider>
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Search couldn’t load');
    expect(screen.queryByText(/Nothing|Loading/)).toBeNull();
  });
});
