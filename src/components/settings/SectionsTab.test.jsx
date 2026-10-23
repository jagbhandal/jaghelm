/*
 * Settings → Sections, Custom Groups (#517): a group holds services by uid, so
 * grouping AdGuard Home on one Pi leaves the other Pi's alone; a Kuma monitor
 * with no container is listed and can be grouped; a group has no icon, colour
 * or hidden option any more; and a group saved before (bare container names,
 * an icon and a colour) loads and saves.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SectionsTab from './SectionsTab.jsx';
import { ConfigProvider } from '../../context/ConfigContext.jsx';
import { OverlayProvider } from '../../context/OverlayContext.jsx';
import { twoPis } from '../../testing/statusFixtures.js';

// The tab over a config it can change, as App holds it; `window.__config` is the latest.
function Harness({ config: initial }) {
  const [config, setConfig] = useState(initial);
  window.__config = config;
  return (
    <OverlayProvider>
      <ConfigProvider config={config} setConfig={setConfig}>
        <SectionsTab />
      </ConfigProvider>
    </OverlayProvider>
  );
}

/** The server: /api/status and /api/services from the two-Pi fixture; `hold` keeps them unanswered. */
function serve({ hold = false } = {}) {
  const { status, services } = twoPis();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      if (hold) return new Promise(() => {});
      if (String(url).endsWith('/api/status')) return Response.json(status);
      if (String(url).endsWith('/api/services')) return Response.json(services);
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

describe('Settings → Sections, the services a group can hold', () => {
  it('lists every service the model has, a Kuma-only monitor too, each by name and node', async () => {
    await openGroup([DNS]);
    expect(names(toAdd())).toEqual([
      'Home Assistant (Pi 1)',
      'AdGuard Home (Pi 1)',
      'AdGuard Home (Pi 2)',
    ]);
    expect(within(held('DNS')).getByText(/None yet/)).toBeInTheDocument();
  });

  it("grouping Pi 1's AdGuard Home saves its uid, and leaves Pi 2's to add", async () => {
    const user = await openGroup([DNS]);
    await user.click(within(toAdd()).getByRole('button', { name: 'AdGuard Home (Pi 1)' }));
    expect(groups()).toEqual([{ ...DNS, containers: ['pi-1:adguard-home'] }]);
    expect(names(held('DNS'))).toEqual(['AdGuard Home (Pi 1)']);
    expect(names(toAdd())).toEqual(['Home Assistant (Pi 1)', 'AdGuard Home (Pi 2)']);
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
    expect(names(toAdd())).toEqual(['Home Assistant (Pi 1)', 'AdGuard Home (Pi 1)']);
  });
});

describe('Settings → Sections, no icon, colour or hidden option for a group', () => {
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

describe('Settings → Sections, a group saved before #517', () => {
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
    expect(names(toAdd())).toEqual(['Home Assistant (Pi 1)']);
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
});
