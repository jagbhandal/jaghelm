import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GROUP_NONE, LayoutEditor } from '@ui/layout-editor';
import { indexAtY } from '@ui/lib/reorder';
import { UiRoot } from '@ui/root';

// LayoutEditor (#330) on its own: what each control calls, and where focus
// goes. The Overview it arranges is src/shell/OverviewEditor.test.jsx's.

const SECTIONS = [
  {
    id: 'attention',
    label: 'Needs attention',
    hint: 'Always on',
    shown: true,
    locked: true,
    movable: false,
  },
  { id: 'services', label: 'Services', shown: true },
  { id: 'infrastructure', label: 'Infrastructure', shown: true },
  { id: 'jobs', label: 'Jobs', shown: false },
];
const GROUPS = [
  { value: GROUP_NONE, label: 'No group' },
  { value: 'net', label: 'Network' },
];
const PINNED = [
  { id: 'a:one', name: 'One', where: 'A', group: GROUP_NONE },
  { id: 'a:two', name: 'Two', where: 'A', group: 'net' },
];
const SERVICES = [{ id: 'b:three', name: 'Three', where: 'B', group: GROUP_NONE }];

const draw = (props) =>
  render(
    <UiRoot>
      <LayoutEditor
        sections={SECTIONS}
        pinned={PINNED}
        services={SERVICES}
        groups={GROUPS}
        {...props}
      />
    </UiRoot>
  );

describe('indexAtY', () => {
  const rects = [
    { id: 'a', top: 0, bottom: 10 },
    { id: 'b', top: 10, bottom: 20 },
    { id: 'c', top: 20, bottom: 30 },
  ];
  it('finds the row under a pointer, the nearest end outside the list, -1 with no rows', () => {
    expect(indexAtY(rects, 5)).toBe(0);
    expect(indexAtY(rects, 10)).toBe(1);
    expect(indexAtY(rects, 29)).toBe(2);
    expect(indexAtY(rects, -50)).toBe(0);
    expect(indexAtY(rects, 400)).toBe(2);
    expect(indexAtY([], 4)).toBe(-1);
  });
});

describe('LayoutEditor', () => {
  it('is a region named Edit layout, with the sections, the pinned and the rest as lists', () => {
    draw();
    expect(screen.getByRole('region', { name: 'Edit layout' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Sections' })).getAllByRole('listitem')
    ).toHaveLength(4);
    expect(
      within(screen.getByRole('list', { name: 'Pinned' })).getAllByRole('listitem')
    ).toHaveLength(2);
    expect(
      within(screen.getByRole('list', { name: 'Services to pin' })).getAllByRole('listitem')
    ).toHaveLength(1);
  });

  it('puts keyboard focus in the panel when it opens', () => {
    draw();
    expect(
      screen.getByRole('region', { name: 'Edit layout' }).contains(document.activeElement)
    ).toBe(true);
  });

  it('a section row has Move up and Move down (disabled at the ends) and a Show switch; a fixed one only its hint and switch', () => {
    draw();
    expect(screen.getByRole('button', { name: 'Move Services up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Jobs down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Infrastructure up' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Move Needs attention/ })).toBeNull();
    expect(screen.getByText('Always on')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Show Needs attention' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('switch', { name: 'Show Jobs' })).not.toBeChecked();
  });

  it('each control calls its handler with the row it names', async () => {
    const user = userEvent.setup();
    const h = {
      onSectionMove: vi.fn(),
      onSectionShown: vi.fn(),
      onPinnedMove: vi.fn(),
      onPin: vi.fn(),
      onUnpin: vi.fn(),
      onReset: vi.fn(),
      onDone: vi.fn(),
      onAddGroup: vi.fn(),
      onGroupName: vi.fn(),
      onQuery: vi.fn(),
    };
    draw({ ...h, groupName: 'x' });
    await user.click(screen.getByRole('button', { name: 'Move Infrastructure up' }));
    expect(h.onSectionMove).toHaveBeenCalledWith('infrastructure', -1);
    await user.click(screen.getByRole('button', { name: 'Move Services down' }));
    expect(h.onSectionMove).toHaveBeenCalledWith('services', 1);
    await user.click(screen.getByRole('switch', { name: 'Show Jobs' }));
    expect(h.onSectionShown).toHaveBeenCalledWith('jobs', true);
    await user.click(screen.getByRole('button', { name: 'Move Two up' }));
    expect(h.onPinnedMove).toHaveBeenCalledWith('a:two', -1);
    await user.click(screen.getByRole('button', { name: 'Unpin One' }));
    expect(h.onUnpin).toHaveBeenCalledWith('a:one');
    await user.click(screen.getByRole('button', { name: 'Pin Three' }));
    expect(h.onPin).toHaveBeenCalledWith('b:three');
    await user.click(screen.getByRole('button', { name: 'Reset order and pins' }));
    expect(h.onReset).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Add group' }));
    expect(h.onAddGroup).toHaveBeenCalledOnce();
    await user.type(screen.getByRole('searchbox', { name: 'Find a service' }), 'q');
    expect(h.onQuery).toHaveBeenCalledWith('q');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(h.onDone).toHaveBeenCalledOnce();
  });

  it('Add group is off for a blank name; Reset is off when asked', () => {
    draw({ groupName: '  ', resetDisabled: true });
    expect(screen.getByRole('button', { name: 'Add group' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset order and pins' })).toBeDisabled();
  });

  it('the group menu names its service, shows its group, and reports a choice', async () => {
    const user = userEvent.setup();
    const onGroup = vi.fn();
    draw({ onGroup });
    expect(screen.getByRole('combobox', { name: 'Group for Two' })).toHaveTextContent('Network');
    expect(screen.getByRole('combobox', { name: 'Group for One' })).toHaveTextContent('No group');
    await user.click(screen.getByRole('combobox', { name: 'Group for Three' }));
    await user.click(await screen.findByRole('option', { name: 'Network' }));
    expect(onGroup).toHaveBeenCalledWith('b:three', 'net');
  });

  it('a group held only by a name, or no group to choose, leaves the menu off', () => {
    draw({
      services: [{ ...SERVICES[0], groupDisabled: true }],
      pinned: [],
    });
    expect(screen.getByRole('combobox', { name: 'Group for Three' })).toBeDisabled();
    draw({
      groups: [GROUPS[0]],
      pinned: [],
      services: [{ id: 'z', name: 'Zed', group: GROUP_NONE }],
    });
    expect(screen.getByRole('combobox', { name: 'Group for Zed' })).toBeDisabled();
  });

  it('says there is nothing pinned, and what an empty list means', () => {
    draw({ pinned: [], services: [], servicesEmpty: 'No service matches.' });
    expect(screen.getByText('Nothing pinned: pin a service below.')).toBeInTheDocument();
    expect(screen.getByText('No service matches.')).toBeInTheDocument();
  });

  it('announces a message from one polite live region', () => {
    draw({ message: 'Services moved to 2 of 4' });
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('Services moved to 2 of 4');
  });

  it('Escape anywhere in the panel leaves; Escape in a menu’s list does not', () => {
    const onDone = vi.fn();
    draw({ onDone });
    fireEvent.keyDown(screen.getByRole('switch', { name: 'Show Jobs' }), { key: 'Escape' });
    expect(onDone).toHaveBeenCalledOnce();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onDone).toHaveBeenCalledOnce();
  });

  // After a move the button that moved a row stays under the keyboard's focus.
  it('keeps focus on the moved row’s button, the other one at an end, Unpin after a pin and Pin after an unpin', async () => {
    const user = userEvent.setup();
    function Stateful() {
      const [order, setOrder] = useState(['services', 'infrastructure', 'jobs']);
      const [pinned, setPinned] = useState([]);
      const rows = order.map((id) => ({ id, label: id, shown: true }));
      const all = [{ id: 'b:three', name: 'Three', group: GROUP_NONE }];
      return (
        <UiRoot>
          <LayoutEditor
            sections={rows}
            pinned={pinned}
            services={pinned.length ? [] : all}
            groups={GROUPS}
            onSectionMove={(id, d) => {
              const next = order.filter((x) => x !== id);
              next.splice(order.indexOf(id) + d, 0, id);
              setOrder(next);
            }}
            onPin={() => setPinned(all)}
            onUnpin={() => setPinned([])}
          />
        </UiRoot>
      );
    }
    render(<Stateful />);
    const down = () => screen.getByRole('button', { name: 'Move services down' });
    await user.click(down());
    expect(document.activeElement).toBe(down());
    await user.click(down());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move services up' }));
    await user.click(screen.getByRole('button', { name: 'Pin Three' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Unpin Three' }));
    await user.click(screen.getByRole('button', { name: 'Unpin Three' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pin Three' }));
  });

  it('a grip is decorative: hidden from assistive technology, no tab stop, a drag handle only for the pointer', () => {
    draw();
    const grips = document.querySelectorAll('[data-slot="edit-grip"]');
    expect(grips.length).toBe(3 + 2);
    for (const g of grips) {
      expect(g).toHaveAttribute('aria-hidden', 'true');
      expect(g).not.toHaveAttribute('tabindex');
    }
  });
});
