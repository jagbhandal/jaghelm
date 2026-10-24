import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConfigProvider } from '../context/ConfigContext.jsx';

// A cancelled preload error makes import() resolve to undefined (chunkReload.js):
// that is a failed load, not “Loading…” until a reload that may never come (#611).
vi.mock('../lazyViews.js', () => ({ loadCommandPaletteIndex: () => Promise.resolve(undefined) }));

const { default: CommandPalette } = await import('./CommandPalette.jsx');

describe('CommandPalette when its index resolves to nothing', () => {
  it('shows the error state, not “Loading…”', async () => {
    render(
      <ConfigProvider config={{ links: {} }} setConfig={vi.fn()}>
        <CommandPalette open onClose={vi.fn()} onNavigate={vi.fn()} />
      </ConfigProvider>
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Search couldn’t load');
    expect(screen.queryByText(/Loading/)).toBeNull();
  });
});
