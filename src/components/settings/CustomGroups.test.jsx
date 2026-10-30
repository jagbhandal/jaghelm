/*
 * Settings → Nodes & Services, Custom groups (#517; Sections' before #317): a group holds services by uid, so
 * grouping AdGuard Home on one Pi leaves the other Pi's alone; a Kuma monitor
 * with no container is listed and can be grouped; a group has no icon, colour
 * or hidden option any more; and a group saved before (bare container names,
 * an icon and a colour) loads and saves.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CustomGroups from './CustomGroups.jsx';
import { ConfigProvider } from '../../context/ConfigContext.jsx';
import { OverlayProvider } from '../../context/OverlayContext.jsx';
import { twoPis } from '../../testing/statusFixtures.js';

// The groups over a config they can change, as App holds it, with what the
// section read (`board`, serve()); `window.__config` is the latest.
function Harness({ config: initial }) {
  const [config, setConfig] = useState(initial);
  window.__config = config;
  return (
    <OverlayProvider>
      <ConfigProvider config={config} setConfig={setConfig}>
        <CustomGroups {...board} />
      </ConfigProvider>
    </OverlayProvider>
  );
}

// /api/services and services.yaml as the section read them (NodesServices.jsx
// hands them in).
let board = {};

/**
 * The two-Pi fixture (`pi2Unread`: pi-2's containers unread): the section's
 * reads in `board`, and /api/status, which the groups read themselves, from
 * the server; `hold` keeps it unanswered.
 */
function serve({ hold = false, pi2Unread = false } = {}) {
  const { status, services, serverConfig } = twoPis({ pi2Unread });
  board = { services, serverConfig };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (hold) return new Promise(() => {});
      if (String(url).endsWith('/api/status')) return Response.json(status);
      return Response.json({ error: 'not here' }, { status: 404 });
    })
  );
}

beforeEach(() => serve());
afterEach(() => vi.unstubAllGlobals());

const DNS = { id: 'custom-1', title: 'DNS', containers: [] };
const groups = () => window.__config.customGroups;
const card = (title) => screen.getByRole('region', { name: title });
const toAdd = () => screen.getByRole('group', { name: 'Services to add' });
const held = (title) => screen.getByRole('group', { name: `In ${title}` });
// Each button's text, without the ✕ a held one draws (hidden from its name).
const names = (el) =>
  within(el)
    .queryAllByRole('button')
    .map((b) => b.textContent.replace(/✕$/, ''));

/**
 * The tab with `customGroups`, the group named `open` open for editing, and
 * (unless `loaded` is false) the services listed.
 */
async function openGroup(customGroups, open = customGroups[0]?.title, { loaded = true } = {}) {
  const user = userEvent.setup();
  render(<Harness config={{ customGroups }} />);
  await user.click(within(card(open)).getByRole('button', { name: 'Edit' }));
  if (loaded) await within(card(open)).findByRole('group', { name: 'Services to add' });
  return user;
}

describe('Settings → Nodes & Services, custom groups: the services a group can hold', () => {
  it('lists every service the model has, a Kuma-only monitor too, each by name and node', async () => {
    await openGroup([DNS]);
    expect(names(toAdd())).toEqual([
      'Home Assistant (Pi 1)',
      'AdGuard Home (Pi 1)',
      'AdGuard Home (Pi 2)',
      'Unbound (Pi 2)',
    ]);
    expect(within(held('DNS')).getByText(/None yet/)).toBeInTheDocument();
  });

  it("grouping Pi 1's AdGuard Home saves its uid, and leaves Pi 2's to add", async () => {
    const user = await openGroup([DNS]);
    await user.click(within(toAdd()).getByRole('button', { name: 'AdGuard Home (Pi 1)' }));
    expect(groups()).toEqual([{ ...DNS, containers: ['pi-1:adguard-home'] }]);
    expect(names(held('DNS'))).toEqual(['AdGuard Home (Pi 1)']);
    expect(names(toAdd())).toEqual([
      'Home Assistant (Pi 1)',
      'AdGuard Home (Pi 2)',
      'Unbound (Pi 2)',
    ]);
    expect(within(card('DNS')).getByText('1 service')).toBeInTheDocument();

    // And taking it out again leaves Pi 2's where it was.
    await user.click(within(held('DNS')).getByRole('button', { name: 'AdGuard Home (Pi 1)' }));
    expect(groups()[0].containers).toEqual([]);
  });

  it('a Kuma monitor with no container can be grouped, by its uid', async () => {
    const user = await openGroup([DNS]);
    await user.click(within(toAdd()).getByRole('button', { name: 'Home Assistant (Pi 1)' }));
    expect(groups()[0].containers).toEqual(['pi-1:Home Assistant']);
  });

  it('a service in one group is not offered to another', async () => {
    const media = { id: 'custom-2', title: 'Media', containers: ['pi-2:adguard-home'] };
    await openGroup([DNS, media], 'DNS');
    expect(names(toAdd())).toEqual([
      'Home Assistant (Pi 1)',
      'AdGuard Home (Pi 1)',
      'Unbound (Pi 2)',
    ]);
  });
});

describe('Settings → Nodes & Services, custom groups: no icon, colour or hidden option for a group', () => {
  it('a group offers its title and its services, nothing else', async () => {
    await openGroup([DNS]);
    const group = card('DNS');
    expect(within(group).getByRole('textbox', { name: 'Group Title' })).toHaveValue('DNS');
    expect(within(group).queryByText('Icon')).toBeNull();
    expect(within(group).queryByText('Color')).toBeNull();
    expect(within(group).queryByTitle(/colou?r/i)).toBeNull();
    expect(within(group).queryAllByRole('checkbox')).toEqual([]);
    expect(within(group).queryByText(/hid/i)).toBeNull();
  });

  it('a new group is saved with an id, a title and no services: no icon or colour', async () => {
    const user = userEvent.setup();
    render(<Harness config={{}} />);
    await user.click(screen.getByRole('button', { name: '+ New Group' }));
    expect(groups()).toEqual([
      { id: expect.stringMatching(/^custom-/), title: 'New Group', containers: [] },
    ]);
  });
});

describe('Settings → Nodes & Services, custom groups: a group saved before #517', () => {
  const OLD = {
    id: 'custom-1',
    title: 'DNS',
    icon: '🛡️',
    borderColor: '#ff0000',
    hidden: true,
    containers: ['adguard-home', 'gone'],
  };

  it('loads: its bare name shows as every service of that name, a name with none says so', async () => {
    await openGroup([OLD]);
    expect(names(held('DNS'))).toEqual([
      'AdGuard Home (Pi 1)',
      'AdGuard Home (Pi 2)',
      'gone (not found)',
    ]);
    expect(within(card('DNS')).getByText('2 services')).toBeInTheDocument();
    expect(names(toAdd())).toEqual(['Home Assistant (Pi 1)', 'Unbound (Pi 2)']);
    // Its old icon and colour are drawn nowhere.
    expect(within(card('DNS')).queryByText('🛡️')).toBeNull();
    expect(card('DNS').outerHTML).not.toContain('#ff0000');
  });

  it('its next change saves it as uids, without the icon, colour or hidden, and the name that matched nothing', async () => {
    const user = await openGroup([OLD]);
    await user.click(within(held('DNS')).getByRole('button', { name: 'AdGuard Home (Pi 2)' }));
    expect(groups()).toEqual([{ id: 'custom-1', title: 'DNS', containers: ['pi-1:adguard-home'] }]);
  });

  it('a rename saves it as uids too', async () => {
    const user = await openGroup([OLD]);
    const title = within(card('DNS')).getByRole('textbox', { name: 'Group Title' });
    await user.type(title, '!');
    expect(groups()).toEqual([
      {
        id: 'custom-1',
        title: 'DNS!',
        containers: ['pi-1:adguard-home', 'pi-2:adguard-home'],
      },
    ]);
  });

  it('while the services are still loading, a change keeps its entries as they are', async () => {
    serve({ hold: true });
    const user = await openGroup([OLD], 'DNS', { loaded: false });
    expect(within(card('DNS')).getByText('Loading services…')).toBeInTheDocument();
    await user.type(within(card('DNS')).getByRole('textbox', { name: 'Group Title' }), '!');
    expect(groups()[0].containers).toEqual(['adguard-home', 'gone']);
  });

  // #517 review: pi-2's containers unread this cycle. A change in Settings
  // rewrites every group; it must lose neither pi-2's AdGuard Home (held by
  // the name) nor the pi-2-only Unbound.
  it("with pi-2 unread, a change keeps the names beside Pi 1's uid, and says why a service held by a name can't be taken out", async () => {
    serve({ pi2Unread: true });
    const group = { id: 'custom-1', title: 'DNS', containers: ['adguard-home', 'unbound'] };
    const user = await openGroup([group]);
    expect(within(card('DNS')).getByText(/couldn't all be read/)).toBeInTheDocument();
    expect(names(held('DNS'))).toEqual(['AdGuard Home (Pi 1)', 'unbound (not found)']);
    const pi1 = within(held('DNS')).getByRole('button', { name: 'AdGuard Home (Pi 1)' });
    expect(pi1).toBeDisabled();

    await user.type(within(card('DNS')).getByRole('textbox', { name: 'Group Title' }), '!');
    expect(groups()).toEqual([
      {
        id: 'custom-1',
        title: 'DNS!',
        containers: ['adguard-home', 'pi-1:adguard-home', 'unbound'],
      },
    ]);
    // The name still holds it, so it still can't be taken out; Unbound's name can.
    expect(
      within(held('DNS!')).getByRole('button', { name: 'AdGuard Home (Pi 1)' })
    ).toBeDisabled();
    await user.click(within(held('DNS!')).getByRole('button', { name: 'unbound (not found)' }));
    expect(groups()[0].containers).toEqual(['adguard-home', 'pi-1:adguard-home']);
  });
});

// #640: deleting a group asks in the Confirm, by the group's title.
describe('Settings → Nodes & Services, custom groups: deleting a group', () => {
  it('asks by the group title, and Cancel keeps it', async () => {
    const user = userEvent.setup();
    render(<Harness config={{ customGroups: [DNS] }} />);
    await user.click(screen.getByRole('button', { name: 'Delete DNS' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this group?' });
    expect(within(dialog).getByText('DNS')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(groups()).toEqual([DNS]);
  });

  it('removes the group once confirmed', async () => {
    const user = userEvent.setup();
    render(<Harness config={{ customGroups: [DNS] }} />);
    await user.click(screen.getByRole('button', { name: 'Delete DNS' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete group' }));
    expect(groups()).toEqual([]);
  });
});
