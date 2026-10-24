import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import NodesTab from './NodesTab';

vi.mock('../../api/client.js', () => ({ apiFetch: vi.fn(), isReadOnlyServer: vi.fn(() => false) }));

// Node order (#667): every control changes something, and each is tested.
const CFG = {
  nodes: {
    pve: { display_name: 'Proxmox', visible: true },
    nas: { display_name: 'NAS', visible: true },
    pi1: { display_name: 'Pi 1', visible: true },
  },
  services: {},
};
const rows = () =>
  [...document.querySelectorAll('[data-node-row]')].map((el) => el.getAttribute('data-node-row'));
const mount = (props = {}) => {
  const onOrder = vi.fn();
  render(
    <NodesTab serverConfig={CFG} onSave={vi.fn()} saving={false} onOrder={onOrder} {...props} />
  );
  return onOrder;
};

describe('NodesTab order', () => {
  it('has a Move up and a Move down button per row, each named for its node', () => {
    mount();
    for (const name of ['Proxmox', 'NAS', 'Pi 1']) {
      expect(screen.getByRole('button', { name: `Move ${name} up` })).toBeTruthy();
      expect(screen.getByRole('button', { name: `Move ${name} down` })).toBeTruthy();
    }
  });

  it('the first row cannot move up and the last cannot move down; the rest can', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Move Proxmox up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Proxmox down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move NAS up' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move NAS down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move Pi 1 down' })).toBeDisabled();
  });

  it('Move up hands the whole new order over and says where the node went', () => {
    const onOrder = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Move NAS up' }));
    expect(onOrder).toHaveBeenCalledWith(['nas', 'pve', 'pi1']);
    const live = screen.getByText('NAS moved to position 1 of 3');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.getAttribute('role')).toBe('status');
  });

  it('Move down does the same the other way', () => {
    const onOrder = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Move Proxmox down' }));
    expect(onOrder).toHaveBeenCalledWith(['nas', 'pve', 'pi1']);
    expect(screen.getByText('Proxmox moved to position 2 of 3')).toBeTruthy();
  });

  it('with the new order given back, the rows follow and the buttons follow the rows', () => {
    const { rerender } = render(
      <NodesTab serverConfig={CFG} onSave={vi.fn()} saving={false} onOrder={vi.fn()} />
    );
    expect(rows()).toEqual(['pve', 'nas', 'pi1']);
    rerender(
      <NodesTab
        serverConfig={CFG}
        onSave={vi.fn()}
        saving={false}
        onOrder={vi.fn()}
        order={['pi1', 'pve']}
      />
    );
    expect(rows()).toEqual(['pi1', 'pve', 'nas']);
    expect(screen.getByRole('button', { name: 'Move Pi 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move NAS down' })).toBeDisabled();
  });

  it('a row that reaches an end hands focus to its other button', () => {
    const props = { serverConfig: CFG, onSave: vi.fn(), saving: false, onOrder: vi.fn() };
    const { rerender } = render(<NodesTab {...props} order={['nas', 'pi1', 'pve']} />);
    const up = screen.getByRole('button', { name: 'Move Pi 1 up' });
    up.focus();
    fireEvent.click(up);
    rerender(<NodesTab {...props} order={['pi1', 'nas', 'pve']} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Pi 1 down' }));
  });

  it.each([[{ 0: 'nas' }], [['nas', 3]], ['nas']])('a bad order (%j) is the old order', (order) => {
    mount({ order });
    expect(rows()).toEqual(['pve', 'nas', 'pi1']);
  });

  it('has no move buttons where nothing can save an order (the guided first run)', () => {
    render(<NodesTab serverConfig={CFG} onSave={vi.fn()} saving={false} />);
    expect(screen.queryByRole('button', { name: /Move .* (up|down)/ })).toBeNull();
    expect(rows()).toEqual(['pve', 'nas', 'pi1']);
  });
});
