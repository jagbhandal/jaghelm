import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ConfigProvider } from '../context/ConfigContext.jsx';

// The palette before its index has loaded (#611): ⌘K on a page that has not
// preloaded it yet. The index's chunk is held back here, as a slow network
// holds it; CommandPalette.test.jsx has it in already.
const gate = vi.hoisted(() => {
  const g = {};
  g.promise = new Promise((resolve, reject) => {
    g.resolve = resolve;
    g.reject = reject;
  });
  return g;
});
vi.mock('../lazyViews.js', () => ({ loadCommandPaletteIndex: () => gate.promise }));

const { default: CommandPalette } = await import('./CommandPalette.jsx');

const renderPalette = () =>
  render(
    <ConfigProvider config={{ links: {} }} setConfig={vi.fn()}>
      <CommandPalette
        open
        onClose={vi.fn()}
        pages={[{ id: 'alerts', label: 'Alerts', href: '/alerts' }]}
        onNavigate={vi.fn()}
      />
    </ConfigProvider>
  );

describe('CommandPalette before its index has loaded', () => {
  it('opens with the field and “Loading…”, never “Nothing to show”, keeps the words typed, and lists once it arrives', async () => {
    const user = userEvent.setup();
    renderPalette();
    expect(screen.getByRole('dialog', { name: 'Search or jump to' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByText(/Nothing/)).toBeNull();
    expect(screen.queryAllByRole('option')).toHaveLength(0);

    await user.type(screen.getByRole('combobox', { name: 'Search' }), 'aler');
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByText(/Nothing/)).toBeNull();

    await act(async () => gate.resolve(await import('./CommandPaletteIndex.js')));
    expect(screen.getByRole('combobox', { name: 'Search' })).toHaveValue('aler');
    expect(screen.getByRole('option', { name: /Alerts/ })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
