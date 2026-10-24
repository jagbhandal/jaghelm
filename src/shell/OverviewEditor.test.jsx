import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigProvider } from '../context/ConfigContext.jsx';
import { defaultConfig } from '../defaultConfig.js';
import { twoPis } from '../testing/statusFixtures.js';
import OverviewBoard from './OverviewBoard.jsx';
import { useDashboardData } from './useDashboardData.js';
import { OVERVIEW_SECTIONS, sectionShown } from './overviewSections.js';

// Edit layout (#330) on the real Overview: a config held in state, so each
// control is judged by what the Overview behind it then draws.
vi.mock('./useDashboardData.js', () => ({ useDashboardData: vi.fn() }));

const { status, services } = twoPis();
const UPDATED = { get: () => Date.now(), subscribe: () => () => {}, staleAfter: 72_000 };
let latest;

function Harness({ initial, onDone = () => {}, board = { status } }) {
  const [config, setConfig] = useState(initial);
  latest = config;
  return (
    <ConfigProvider config={config} setConfig={setConfig}>
      <OverviewBoard
        tick={0}
        active
        editing
        onDoneEditing={onDone}
        status={board.status}
        reach="ok"
        updated={UPDATED}
      />
    </ConfigProvider>
  );
}

const slots = () =>
  [...document.querySelectorAll('[data-slot="overview-board"] > [data-slot^="overview-"]')]
    .map((el) => el.dataset.slot.replace('overview-', ''))
    .filter((s) => s !== 'editor');
const editor = () => document.querySelector('[data-slot="overview-editor"]');
const announced = () => document.querySelector('[data-slot="edit-announce"]').textContent;

async function open(initial = defaultConfig(), props) {
  const utils = render(<Harness initial={initial} {...props} />);
  await screen.findByRole('heading', { name: 'Edit layout' });
  return utils;
}

beforeEach(() => {
  useDashboardData.mockReturnValue({
    serviceData: services,
    integrationData: {},
    history: {},
    servicesLoaded: true,
    sources: {
      services: { error: null, staleNote: null },
      integrations: { error: null, staleNote: null },
    },
    retry: vi.fn(),
  });
});
afterEach(() => vi.restoreAllMocks());

describe('reordering the sections', () => {
  it('Move down / Move up change the order the Overview draws, with focus on the moved row and an announcement', async () => {
    const user = userEvent.setup();
    await open();
    expect(slots()).toEqual(['infrastructure', 'power', 'services']);
    const down = () => screen.getByRole('button', { name: 'Move Infrastructure down' });
    await user.click(down());
    expect(slots()[0]).not.toBe('infrastructure');
    expect(latest.overviewLayout.order.indexOf('infrastructure')).toBe(1);
    expect(announced()).toBe('Infrastructure moved to 2 of 6');
    // Focus is on the moved row's own button.
    expect(document.activeElement).toBe(down());
    // Down to the last place: that button is disabled, focus moves to Move up.
    await user.click(down());
    await user.click(down());
    await user.click(down());
    await user.click(down());
    expect(latest.overviewLayout.order.at(-1)).toBe('infrastructure');
    expect(slots().at(-1)).toBe('infrastructure');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Move Infrastructure up' })
    );
    await user.click(screen.getByRole('button', { name: 'Move Services up' }));
    expect(announced()).toMatch(/^Services moved to \d of 6$/);
  });

  it('the first Move up and the last Move down are disabled; the locked rows have none', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Move Infrastructure up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Config drift down' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Move Needs attention/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Move Subsystem strip/ })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Show Needs attention' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('puts Services first and back: the section really moves, and the lead one is flush', async () => {
    const user = userEvent.setup();
    await open();
    for (let i = 0; i < 3; i++)
      await user.click(screen.getByRole('button', { name: 'Move Services up' }));
    expect(slots()[0]).toBe('services');
    expect(latest.overviewLayout.order[0]).toBe('services');
    expect(document.querySelector('[data-slot="overview-infrastructure"]').style.marginTop).toBe(
      '24px'
    );
    await user.click(screen.getByRole('button', { name: 'Reset order and pins' }));
    expect(latest.overviewLayout).toBeUndefined();
    expect(slots()).toEqual(['infrastructure', 'power', 'services']);
    expect(document.querySelector('[data-slot="overview-infrastructure"]').style.marginTop).toBe(
      '0px'
    );
    expect(screen.getByRole('button', { name: 'Reset order and pins' })).toBeDisabled();
  });
});

describe('showing and hiding the sections', () => {
  it('flips the same overviewSections key Settings does, and the Overview follows', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('switch', { name: 'Show Services' }));
    expect(latest.overviewSections).toEqual({ services: false });
    expect(sectionShown(latest, 'services')).toBe(false);
    expect(slots()).toEqual(['infrastructure', 'power']);
    expect(announced()).toBe('Services hidden');
    await user.click(screen.getByRole('switch', { name: 'Show Services' }));
    expect(latest.overviewSections.services).toBe(true);
    expect(slots()).toEqual(['infrastructure', 'power', 'services']);
  });

  it('shows a section Settings hid as off, and a hidden section keeps its place in the order', async () => {
    const user = userEvent.setup();
    await open({ ...defaultConfig(), overviewSections: { infrastructure: false } });
    expect(screen.getByRole('switch', { name: 'Show Infrastructure' })).not.toBeChecked();
    expect(slots()).toEqual(['power', 'services']);
    await user.click(screen.getByRole('button', { name: 'Move Infrastructure down' }));
    expect(slots()).toEqual(['power', 'services']);
    expect(latest.overviewLayout.order.indexOf('infrastructure')).toBe(1);
  });

  it('has a switch for every section Settings lists, on the same key', async () => {
    const user = userEvent.setup();
    await open();
    for (const { id, label, locked } of OVERVIEW_SECTIONS) {
      const sw = screen.getByRole('switch', { name: `Show ${label}` });
      if (locked) continue;
      await user.click(sw);
      expect(latest.overviewSections[id], id).toBe(false);
    }
  });
});

describe('pinning services', () => {
  it('Pin puts the service in a Pinned group first in Services; Unpin takes it back', async () => {
    const user = userEvent.setup();
    await open();
    const groups = () =>
      [...document.querySelectorAll('[data-slot="services-group"]')].map((g) => g.dataset.group);
    expect(groups()).not.toContain('pinned');
    await user.click(screen.getByRole('button', { name: 'Pin Unbound on Pi 2' }));
    expect(latest.overviewLayout.pinned).toEqual(['pi-2:unbound']);
    expect(groups()[0]).toBe('pinned');
    const pinned = document.querySelector('[data-group="pinned"]');
    expect(within(pinned).getByText('Unbound')).toBeInTheDocument();
    expect(announced()).toBe('Unbound pinned to the top of Services');
    // Focus lands on the new row's Unpin, since the Pin button is gone.
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Unpin Unbound on Pi 2' })
    );
    await user.click(screen.getByRole('button', { name: 'Unpin Unbound on Pi 2' }));
    expect(latest.overviewLayout).toBeUndefined();
    expect(groups()).not.toContain('pinned');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Pin Unbound on Pi 2' })
    );
  });

  it('reorders the pinned ones by keyboard, and the Pinned group follows', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Pin Unbound on Pi 2' }));
    await user.click(screen.getByRole('button', { name: 'Pin Home Assistant on Pi 1' }));
    const names = () =>
      within(document.querySelector('[data-group="pinned"]'))
        .getAllByRole('listitem')
        .map((li) => li.textContent);
    expect(latest.overviewLayout.pinned).toEqual(['pi-2:unbound', 'pi-1:Home Assistant']);
    expect(names()[0]).toMatch(/Unbound/);
    await user.click(screen.getByRole('button', { name: 'Move Home Assistant on Pi 1 up' }));
    expect(latest.overviewLayout.pinned).toEqual(['pi-1:Home Assistant', 'pi-2:unbound']);
    expect(names()[0]).toMatch(/Home Assistant/);
    expect(announced()).toBe('Home Assistant moved to 1 of 2 of the pinned');
  });

  it('prunes a pin whose service is really gone at the next change, never one that is only out of sight', async () => {
    const user = userEvent.setup();
    const initial = {
      ...defaultConfig(),
      // pi-1 answered in full and has no `removed`; pi-9 is no node we know.
      overviewLayout: { pinned: ['pi-1:removed', 'pi-9:elsewhere', 'pi-2:unbound'] },
    };
    await open(initial);
    // Nothing is pruned before an edit; the one with a row is drawn, and the one
    // out of sight is listed so it can be removed.
    expect(latest.overviewLayout.pinned).toEqual([
      'pi-1:removed',
      'pi-9:elsewhere',
      'pi-2:unbound',
    ]);
    const pinnedList = within(screen.getByRole('region', { name: 'Edit layout' })).getByRole(
      'list',
      {
        name: 'Pinned',
      }
    );
    expect(within(pinnedList).getByText(/elsewhere/)).toBeInTheDocument();
    expect(within(pinnedList).getAllByText(/not shown now/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Pin Home Assistant on Pi 1' }));
    expect(latest.overviewLayout.pinned).toEqual([
      'pi-9:elsewhere',
      'pi-2:unbound',
      'pi-1:Home Assistant',
    ]);
    // The pin that can't be seen is still removable.
    await user.click(screen.getByRole('button', { name: 'Unpin elsewhere on pi-9' }));
    expect(latest.overviewLayout.pinned).toEqual(['pi-2:unbound', 'pi-1:Home Assistant']);
  });

  it('a node that is down never costs its pins', async () => {
    const user = userEvent.setup();
    const down = twoPis({ pi2Unread: true });
    useDashboardData.mockReturnValue({
      serviceData: down.services,
      integrationData: {},
      history: {},
      servicesLoaded: true,
      sources: {
        services: { error: null, staleNote: null },
        integrations: { error: null, staleNote: null },
      },
      retry: vi.fn(),
    });
    await open(
      { ...defaultConfig(), overviewLayout: { pinned: ['pi-2:unbound'] } },
      { board: { status: down.status } }
    );
    await user.click(screen.getByRole('button', { name: 'Pin Home Assistant on Pi 1' }));
    expect(latest.overviewLayout.pinned).toContain('pi-2:unbound');
  });

  it('names every control with its node, so one service on two nodes is two names', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Pin AdGuard Home on Pi 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pin AdGuard Home on Pi 2' })).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Group for AdGuard Home on Pi 1' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Group for AdGuard Home on Pi 2' })
    ).toBeInTheDocument();
  });

  it('does not add a second group of the same name, and says so', async () => {
    const user = userEvent.setup();
    await open({
      ...defaultConfig(),
      customGroups: [{ id: 'a', title: 'Network', containers: [] }],
    });
    await user.type(screen.getByRole('textbox', { name: 'New group name' }), ' network ');
    await user.click(screen.getByRole('button', { name: 'Add group' }));
    expect(latest.customGroups).toHaveLength(1);
    expect(announced()).toBe('A group named network already exists.');
  });

  it('finds a service by name, and says when none matches', async () => {
    const user = userEvent.setup();
    await open();
    await user.type(screen.getByRole('searchbox', { name: 'Find a service' }), 'unbo');
    const list = screen.getByRole('list', { name: 'Services to pin' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    await user.clear(screen.getByRole('searchbox', { name: 'Find a service' }));
    await user.type(screen.getByRole('searchbox', { name: 'Find a service' }), 'zzzz');
    expect(within(list).getByText('No service matches.')).toBeInTheDocument();
  });
});

describe('groups are the custom groups', () => {
  it('Add group makes a custom group; putting a service in it groups the section by group', async () => {
    const user = userEvent.setup();
    await open();
    await user.type(screen.getByRole('textbox', { name: 'New group name' }), 'Network');
    await user.click(screen.getByRole('button', { name: 'Add group' }));
    expect(latest.customGroups).toHaveLength(1);
    expect(latest.customGroups[0]).toMatchObject({ title: 'Network', containers: [] });
    expect(announced()).toMatch(/^Group Network added/);
    const nodeGroups = [...document.querySelectorAll('[data-slot="services-group"]')].map(
      (g) => g.dataset.group
    );
    expect(nodeGroups.every((k) => k.startsWith('node:'))).toBe(true);

    await user.click(screen.getByRole('combobox', { name: 'Group for Unbound on Pi 2' }));
    await user.click(await screen.findByRole('option', { name: 'Network' }));
    expect(latest.customGroups[0].containers).toEqual(['pi-2:unbound']);
    await waitFor(() => {
      const keys = [...document.querySelectorAll('[data-slot="services-group"]')].map(
        (g) => g.dataset.group
      );
      expect(keys[0]).toBe(`group:${latest.customGroups[0].id}`);
      expect(keys).toContain('group:none');
    });
    const heading = document.querySelector(`[data-group="group:${latest.customGroups[0].id}"]`);
    expect(within(heading).getByText('Network')).toBeInTheDocument();
    expect(within(heading).getByText('Unbound')).toBeInTheDocument();
  });

  it('a blank name adds nothing; the group menu is off until a group exists', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Add group' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Group for Unbound on Pi 2' })).toBeDisabled();
  });

  it('takes a service out of its group, and leaves one held by a bare name to Settings', async () => {
    const user = userEvent.setup();
    const initial = {
      ...defaultConfig(),
      customGroups: [
        { id: 'a', title: 'Alpha', containers: ['pi-2:unbound'] },
        { id: 'b', title: 'Beta', containers: ['adguard-home'] },
      ],
    };
    await open(initial);
    await user.click(screen.getByRole('combobox', { name: 'Group for Unbound on Pi 2' }));
    await user.click(await screen.findByRole('option', { name: 'No group' }));
    expect(latest.customGroups[0].containers).toEqual([]);
    // adguard-home is held by its name in Beta: Edit layout can't take it out.
    expect(
      screen.getAllByRole('combobox', { name: /^Group for AdGuard Home on Pi/ })[0]
    ).toBeDisabled();
  });
});

describe('leaving the mode', () => {
  it('Done and Escape both call onDone', async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    await open(defaultConfig(), { onDone });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('switch', { name: 'Show Power' }), { key: 'Escape' });
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it('puts keyboard focus in the panel when it opens', async () => {
    await open();
    await waitFor(() => expect(editor().contains(document.activeElement)).toBe(true));
  });

  it('is not drawn when the mode is off, and the Overview then reads as it did', async () => {
    useDashboardData.mockReturnValue({
      serviceData: services,
      integrationData: {},
      history: {},
      servicesLoaded: true,
      sources: {
        services: { error: null, staleNote: null },
        integrations: { error: null, staleNote: null },
      },
      retry: vi.fn(),
    });
    render(
      <ConfigProvider config={defaultConfig()} setConfig={vi.fn()}>
        <OverviewBoard tick={0} active status={status} reach="ok" updated={UPDATED} />
      </ConfigProvider>
    );
    await act(async () => {});
    expect(editor()).toBeNull();
    expect(slots()).toEqual(['infrastructure', 'power', 'services']);
  });
});
