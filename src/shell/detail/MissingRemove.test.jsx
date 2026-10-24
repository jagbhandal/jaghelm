import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MissingRemove } from './MissingRemove.jsx';
import { OverlayProvider } from '../../context/OverlayContext.jsx';
import { onRefreshNow } from '../../refreshNow.js';

// A missing container's Remove (#688): ask first, forget, read the board again, close; or say why not.

const forget = vi.fn();
let readOnly = false;
vi.mock('../../hooks/useData.js', () => ({ forgetContainer: (...args) => forget(...args) }));
vi.mock('../../api/client.js', () => ({ isReadOnlyServer: () => readOnly }));

const TARGET = {
  reporting: true,
  id: 'services/vm103:wikijs',
  node: 'vm103',
  container: 'wikijs',
  name: 'Wikijs',
  mapped: 'Quartz Notes',
  kuma: 'Quartz Notes',
};

const show = (props = {}) =>
  render(
    <OverlayProvider>
      <MissingRemove target={TARGET} {...props} />
    </OverlayProvider>
  );

beforeEach(() => {
  forget.mockReset();
  readOnly = false;
});

describe('MissingRemove', () => {
  it('Remove… asks first, naming what it does and what stays; Cancel sends nothing', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Remove…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this missing container?' });
    expect(within(dialog).getByText('Wikijs')).toBeInTheDocument();
    expect(within(dialog).getByText('On vm103')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Forget Wikijs on vm103. It comes back if the container returns.');
    expect(dialog).toHaveTextContent('services.yaml still maps it to Kuma monitor "Quartz Notes"; that stays until you edit it.');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(forget).not.toHaveBeenCalled();
  });

  it('confirming forgets it by node and container, reads the board again, toasts and closes', async () => {
    forget.mockResolvedValue({ forgotten: {}, refreshed: true });
    const refreshed = vi.fn();
    const stop = onRefreshNow(refreshed);
    const onRemoved = vi.fn();
    const user = userEvent.setup();
    show({ onRemoved });
    await user.click(screen.getByRole('button', { name: 'Remove…' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(forget).toHaveBeenCalledWith('vm103', 'wikijs');
    expect(refreshed).toHaveBeenCalledTimes(1);
    expect(onRemoved).toHaveBeenCalledWith({ id: TARGET.id, focus: null });
    expect(await screen.findByText('Removed Wikijs on vm103. It comes back if the container returns.')).toBeInTheDocument();
    stop();
  });

  it('a refusal says why over the button, removes nothing, and does not close', async () => {
    forget.mockRejectedValue(new Error('HTTP 409'));
    const refreshed = vi.fn();
    const stop = onRefreshNow(refreshed);
    const onRemoved = vi.fn();
    const user = userEvent.setup();
    show({ onRemoved });
    await user.click(screen.getByRole('button', { name: 'Remove…' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    const banner = await waitFor(() => {
      const el = document.querySelector('[data-slot="detail-remove-error"]');
      expect(el).not.toBeNull();
      return el;
    });
    expect(banner).toHaveTextContent("Couldn't remove Wikijs");
    expect(banner).toHaveTextContent('It is running now, or its node is not reporting. Nothing was removed.');
    expect(onRemoved).not.toHaveBeenCalled();
    expect(refreshed).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove…' })).toBeEnabled();
    stop();
  });

  it('a node that is not reporting gets the reason in place of the button', () => {
    show({ target: { ...TARGET, reporting: false } });
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.getByText('Remove is not offered yet')).toBeInTheDocument();
    expect(screen.getByText(/Remove is offered once the node is reporting/)).toBeInTheDocument();
  });

  it('a board that was not rebuilt in time says it leaves on the next refresh', async () => {
    forget.mockResolvedValue({ forgotten: {}, refreshed: false });
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Remove…' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Removed Wikijs on vm103. It leaves the board on the next refresh.')).toBeInTheDocument();
  });

  it('draws nothing on a read-only server (the public demo)', () => {
    readOnly = true;
    show();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });
});
