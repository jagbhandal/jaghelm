import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { PHONE_WIDTH } from '@ui/app-shell';
import { forgetAnswers } from './hooks/useData.js';
import { nasDiskIncident } from './testing/statusFixtures.js';

// The Services and Infrastructure pages (#313, spec §8): from 768px, at
// /services and /infrastructure, every service and every node, as the
// Overview's sections draw them, with filters kept in the address (Back
// undoes one, a link opens the page filtered), and the window crossing 768px
// both ways keeps the path and the filters (the phone's tabs below it read
// the same search and node). e2e/pages.spec.mjs runs them in a browser.

const BOARD = nasDiskIncident();
const SERVICE_COUNT = BOARD.status.entities.filter((e) => e.subsystem === 'services').length;
// A Proxmox node's machines and pools, as /api/integrations answers them
// (scoped to the App Server, `apps`).
const PROXMOX = {
  _preset: 'proxmox',
  _target: 'apps:qemu-guest',
  _vms: [
    {
      name: 'docker-brain',
      vmid: 103,
      status: 'running',
      maxcpu: 8,
      memUsedGB: '21.4',
      memTotalGB: '32.0',
    },
    { name: 'win11', vmid: 110, status: 'stopped', maxcpu: 4, memUsedGB: null, memTotalGB: '16.0' },
  ],
  _storagePools: [
    { name: 'local-lvm', type: 'lvmthin', usedGB: '851.2', totalGB: '900.0', percent: 94.6 },
  ],
};

let requests;

function respond(body, status = 200, headers = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

// A window whose width can cross 768px: matchMedia answers PHONE_WIDTH as
// `media.phone` says, and tells its listeners when that changes.
const media = { phone: false, listeners: new Set() };
function resizableWindow() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    media: query,
    get matches() {
      return query === PHONE_WIDTH && media.phone;
    },
    addEventListener: (_, fn) => query === PHONE_WIDTH && media.listeners.add(fn),
    removeEventListener: (_, fn) => media.listeners.delete(fn),
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}
function resizeTo({ phone }) {
  act(() => {
    media.phone = phone;
    for (const fn of [...media.listeners]) fn();
  });
}

function stubServer({ status = BOARD.status, integrations = {}, config = {} } = {}) {
  requests = [];
  localStorage.setItem('jaghelm-config', JSON.stringify({ tabs: [], ...config }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const path = String(url).split('?')[0];
      requests.push(path);
      if (path === '/api/auth/check') return respond({ authRequired: true, authenticated: true });
      if (path === '/api/status') return respond(status);
      if (path === '/api/services') return respond(BOARD.services);
      if (path === '/api/integrations') return respond(integrations);
      if (path === '/api/display-config') return respond(config, 200, { ETag: '"v1"' });
      if (['/api/todos', '/api/gitea/activity', '/api/cron/status'].includes(path))
        return respond([]);
      return respond({});
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('jaghelm-token', 'tok');
  forgetAnswers();
  media.phone = false;
  media.listeners.clear();
  resizableWindow();
  stubServer();
});

const url = () => window.location.pathname + window.location.search;
const sidebar = () => screen.getByRole('navigation', { name: 'Main' });
const section = (name) => screen.findByRole('region', { name });
const filters = () => within(screen.getByRole('group', { name: 'Filters' }));
const rows = (region) =>
  [...region.querySelectorAll('[data-slot="entity-row"]')].map(
    (r) => r.querySelector('[data-slot="entity-name"]').textContent
  );
const cards = (region) =>
  within(region)
    .queryAllByRole('article')
    .map((a) => a.dataset.node);

async function renderAt(path) {
  window.history.replaceState(null, '', path);
  render(<App />);
  await screen.findByRole('navigation', { name: 'Main' });
}

/** The Services page, once its rows are in. */
async function servicesPage(path = '/services') {
  await renderAt(path);
  const region = await section('Services');
  await waitFor(() => expect(region.getAttribute('aria-busy')).toBeNull());
  return region;
}

/** The Infrastructure page, once its nodes are in. */
async function infrastructurePage(path = '/infrastructure') {
  await renderAt(path);
  const region = await section('Infrastructure');
  await waitFor(() => expect(region.getAttribute('aria-busy')).toBeNull());
  return region;
}

/** Picks `option` in the filter named `name`. */
async function choose(user, name, option) {
  await user.click(filters().getByRole('combobox', { name }));
  await user.click(await screen.findByRole('option', { name: option }));
}

describe('the sidebar and the palette (#313)', () => {
  it("Monitor lists Services and Infrastructure, in the mock's order; each marks itself current", async () => {
    await renderAt('/');
    const monitor = within(sidebar()).getAllByRole('group')[0];
    expect(
      within(monitor)
        .getAllByRole('link')
        .map((l) => l.textContent)
    ).toEqual(['Overview', 'Services', 'Infrastructure', expect.stringMatching(/^Alerts/)]);
    const user = userEvent.setup();
    await user.click(within(monitor).getByRole('link', { name: 'Services' }));
    expect(url()).toBe('/services');
    await waitFor(() =>
      expect(within(monitor).getByRole('link', { name: 'Services' })).toHaveAttribute(
        'aria-current',
        'page'
      )
    );
    expect(document.title).toMatch(/^Services — /);
    await user.click(within(monitor).getByRole('link', { name: 'Infrastructure' }));
    expect(url()).toBe('/infrastructure');
    expect(await section('Infrastructure')).toBeInTheDocument();
  });

  it('⌘K finds both pages, and opens each', async () => {
    await renderAt('/');
    const user = userEvent.setup();
    for (const [query, name, path] of [
      ['servi', 'Services', '/services'],
      ['infra', 'Infrastructure', '/infrastructure'],
    ]) {
      await user.keyboard('{Control>}k{/Control}');
      const field = await screen.findByRole('combobox', { name: 'Search' });
      await user.type(field, query);
      const page = screen.getByRole('option', { name: new RegExp(`^${name}, Page`) });
      expect(page).toHaveAttribute('href', path);
      await user.click(page);
      expect(url()).toBe(path);
      await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Search' })).toBeNull());
    }
  });
});

describe("the Overview's Services section (#313)", () => {
  it('ends with "Show all N services", which opens the Services page', async () => {
    await renderAt('/');
    const link = await screen.findByRole('link', { name: `Show all ${SERVICE_COUNT} services` });
    expect(link).toHaveAttribute('href', '/services');
    await userEvent.setup().click(link);
    expect(url()).toBe('/services');
    const region = await section('Services');
    await waitFor(() => expect(rows(region)).toHaveLength(SERVICE_COUNT));
    // The page lists them all already: no link to itself.
    expect(within(region).queryByRole('link', { name: /^Show all/ })).toBeNull();
  });
});

describe('the Services page (#313)', () => {
  it('a state it has no filter for is none: every service, All states, nothing to clear', async () => {
    const region = await servicesPage('/services?state=down');
    expect(rows(region)).toHaveLength(SERVICE_COUNT);
    expect(filters().getByRole('combobox', { name: 'State' })).toHaveTextContent('All states');
    expect(filters().queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(within(region).getByText(`${SERVICE_COUNT} monitored · 1 down`)).toBeInTheDocument();
  });

  it('every service, by node, each row opening its detail over the page; State and Node filters, and no Tag filter without tags', async () => {
    const region = await servicesPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Services' })).toBeInTheDocument();
    expect(rows(region)).toHaveLength(SERVICE_COUNT);
    expect(within(region).getByText(`${SERVICE_COUNT} monitored · 1 down`)).toBeInTheDocument();
    const jellyfin = region.querySelector('[data-entity="services/apps:jellyfin"]');
    expect(jellyfin).toHaveAttribute('href', '/services?entity=services/apps:jellyfin');
    expect(filters().getByRole('searchbox', { name: 'Search services' })).toHaveValue('');
    expect(filters().getByRole('combobox', { name: 'State' })).toHaveTextContent('All states');
    expect(filters().getByRole('combobox', { name: 'Node' })).toHaveTextContent('All nodes');
    // No service has tags until #519: no Tag filter, not a dead one.
    expect(filters().queryByRole('combobox', { name: 'Tag' })).toBeNull();
    expect(filters().queryByRole('button', { name: 'Clear filters' })).toBeNull();
    // The page reads the latencies and the metrics, as the Overview's section.
    for (const path of ['/api/services', '/api/integrations']) expect(requests).toContain(path);
  });

  it('the search filters as it is typed, by name, node, custom group or container, and goes in the address once typing stops', async () => {
    stubServer({
      config: { customGroups: [{ id: 'm', title: 'Media shelf', containers: ['apps:jellyfin'] }] },
    });
    const region = await servicesPage();
    const user = userEvent.setup();
    const box = filters().getByRole('searchbox', { name: 'Search services' });
    await user.type(box, 'jelly');
    expect(rows(region)).toEqual(['Jellyfin']);
    await waitFor(() => expect(url()).toBe('/services?q=jelly'));
    expect(
      within(region).getByText(`1 of ${SERVICE_COUNT} monitored · 1 down`)
    ).toBeInTheDocument();
    for (const [query, want] of [
      ['network edge', ['Adguard Home', 'Nginx Proxy Manager', 'Wireguard']],
      ['shelf', ['Jellyfin']],
      ['syncthing', ['Syncthing']],
    ]) {
      await user.clear(box);
      await user.type(box, query);
      expect(rows(region).sort(), query).toEqual(want);
    }
    await user.clear(box);
    await user.type(box, 'nothing-like-it');
    const empty = within(region).getByText('No services match these filters').closest('section');
    await user.click(within(empty).getByRole('button', { name: 'Clear filters' }));
    expect(rows(region)).toHaveLength(SERVICE_COUNT);
    await waitFor(() => expect(url()).toBe('/services'));
    expect(box).toHaveValue('');
  });

  it('the State and Node filters; each change an entry Back undoes', async () => {
    const region = await servicesPage();
    const user = userEvent.setup();
    await choose(user, 'State', 'Problems');
    expect(url()).toBe('/services?state=problems');
    expect(rows(region)).toEqual(['Jellyfin']);
    await choose(user, 'State', 'Up');
    expect(rows(region)).toHaveLength(SERVICE_COUNT - 1);
    await choose(user, 'Node', 'Storage');
    expect(url()).toBe('/services?state=ok&node=storage');
    expect(rows(region).sort()).toEqual(['Backrest', 'Photoprism', 'Syncthing']);
    window.history.back();
    await waitFor(() => expect(url()).toBe('/services?state=ok'));
    await waitFor(() => expect(rows(region)).toHaveLength(SERVICE_COUNT - 1));
    expect(filters().getByRole('combobox', { name: 'Node' })).toHaveTextContent('All nodes');
    window.history.back();
    await waitFor(() => expect(rows(region)).toEqual(['Jellyfin']));
    expect(filters().getByRole('combobox', { name: 'State' })).toHaveTextContent('Problems');
    await user.click(filters().getByRole('button', { name: 'Clear filters' }));
    expect(url()).toBe('/services');
    expect(rows(region)).toHaveLength(SERVICE_COUNT);
  });

  it('a link opens the page filtered; a row opened from it keeps the filters under it', async () => {
    const region = await servicesPage('/services?state=problems&node=apps');
    expect(rows(region)).toEqual(['Jellyfin']);
    expect(filters().getByRole('combobox', { name: 'State' })).toHaveTextContent('Problems');
    expect(filters().getByRole('combobox', { name: 'Node' })).toHaveTextContent('App Server');
    const row = region.querySelector('[data-entity="services/apps:jellyfin"]');
    expect(row).toHaveAttribute(
      'href',
      '/services?state=problems&node=apps&entity=services/apps:jellyfin'
    );
    await userEvent.setup().click(row);
    expect(await screen.findByRole('dialog', { name: 'Jellyfin' })).toBeInTheDocument();
    expect(rows(region)).toEqual(['Jellyfin']);
  });

  it('a Tag filter once services have tags (#519), and it filters', async () => {
    const tagged = {
      ...BOARD.status,
      entities: BOARD.status.entities.map((e) =>
        ['services/apps:jellyfin', 'services/storage:photoprism'].includes(e.id)
          ? { ...e, tags: ['media'] }
          : e
      ),
    };
    stubServer({ status: tagged });
    const region = await servicesPage();
    const user = userEvent.setup();
    expect(filters().getByRole('combobox', { name: 'Tag' })).toHaveTextContent('All tags');
    await choose(user, 'Tag', 'media');
    expect(url()).toBe('/services?tag=media');
    expect(rows(region).sort()).toEqual(['Jellyfin', 'Photoprism']);
  });

  it('a tag in the address is no filter while no service has one', async () => {
    const region = await servicesPage('/services?tag=media');
    expect(rows(region)).toHaveLength(SERVICE_COUNT);
    expect(filters().queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('list or table, kept in this browser; the grouping is the Overview’s choice too', async () => {
    const region = await servicesPage();
    const user = userEvent.setup();
    await user.click(
      within(within(region).getByRole('radiogroup', { name: 'Service view' })).getByRole('radio', {
        name: 'Table',
      })
    );
    const table = within(region).getByRole('table', { name: 'Services' });
    expect(within(table).getAllByRole('rowheader')).toHaveLength(SERVICE_COUNT);
    expect(localStorage.getItem('jaghelm-services-view')).toBe('table');
    await choose(user, 'State', 'Problems');
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((h) => h.textContent)
    ).toEqual(['Jellyfin']);
  });
});

describe('the Infrastructure page (#313)', () => {
  it('every node, as cards; State and Role filters, a link opening it filtered, Back undoing a change', async () => {
    const region = await infrastructurePage();
    expect(screen.getByRole('heading', { level: 1, name: 'Infrastructure' })).toBeInTheDocument();
    expect(cards(region)).toEqual(['nodes/edge', 'nodes/apps', 'nodes/storage']);
    expect(within(region).getByText('3 nodes · 1 warning')).toBeInTheDocument();
    const user = userEvent.setup();
    await choose(user, 'State', 'Problems');
    expect(url()).toBe('/infrastructure?state=problems');
    expect(cards(region)).toEqual(['nodes/storage']);
    expect(within(region).getByText('1 of 3 nodes · 1 warning')).toBeInTheDocument();
    await choose(user, 'State', 'All states');
    await choose(user, 'Role', 'Raspberry Pi 4');
    expect(url()).toBe('/infrastructure?role=Raspberry+Pi+4');
    expect(cards(region)).toEqual(['nodes/edge']);
    window.history.back();
    await waitFor(() => expect(cards(region)).toHaveLength(3));
    // The node opens its detail over the page, the filters kept under it.
    const name = within(region).getByRole('link', { name: 'Storage' });
    expect(name).toHaveAttribute('href', '/infrastructure?entity=nodes/storage');
  });

  it('the search: a name, a key or a role; in the address once typing stops; a link opens it filtered', async () => {
    const region = await infrastructurePage('/infrastructure?q=nas');
    expect(cards(region)).toEqual(['nodes/storage']);
    expect(filters().getByRole('searchbox', { name: 'Search nodes' })).toHaveValue('nas');
    const user = userEvent.setup();
    const box = filters().getByRole('searchbox', { name: 'Search nodes' });
    await user.clear(box);
    await user.type(box, 'edge');
    expect(cards(region)).toEqual(['nodes/edge']);
    await waitFor(() => expect(url()).toBe('/infrastructure?q=edge'));
    await user.clear(box);
    await user.type(box, 'proxmox');
    expect(cards(region)).toEqual(['nodes/apps']);
  });

  it("each Proxmox node's machines and pools under the nodes, as its detail lists them", async () => {
    stubServer({ integrations: { proxmox: PROXMOX } });
    await infrastructurePage();
    const lists = await screen.findByRole('region', { name: 'Virtual machines and storage' });
    const vms = within(lists).getByRole('region', { name: 'App Server · Virtual machines' });
    expect(within(vms).getByText('docker-brain')).toBeInTheDocument();
    expect(within(vms).getByText('1 / 2 running')).toBeInTheDocument();
    const pools = within(lists).getByRole('region', { name: 'App Server · Storage pools' });
    expect(within(pools).getByRole('meter', { name: /local-lvm/ })).toBeInTheDocument();
    // Filtered out with its node.
    await choose(userEvent.setup(), 'State', 'Problems');
    expect(screen.queryByRole('region', { name: 'Virtual machines and storage' })).toBeNull();
  });

  it('maintenance, which no node can be in, is no filter: every node, All states, nothing to clear', async () => {
    const region = await infrastructurePage('/infrastructure?state=maintenance');
    expect(cards(region)).toEqual(['nodes/edge', 'nodes/apps', 'nodes/storage']);
    expect(filters().getByRole('combobox', { name: 'State' })).toHaveTextContent('All states');
    expect(filters().queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(within(region).getByText('3 nodes · 1 warning')).toBeInTheDocument();
  });

  it('no Proxmox, no list', async () => {
    await infrastructurePage();
    expect(screen.queryByRole('region', { name: 'Virtual machines and storage' })).toBeNull();
  });
});

describe('the 768px crossing (#313, #567 review)', () => {
  it('/services keeps its path and filters both ways; the phone tab shows the search and the node', async () => {
    const region = await servicesPage('/services?state=problems&node=apps&q=jelly');
    expect(rows(region)).toEqual(['Jellyfin']);
    resizeTo({ phone: true });
    await waitFor(() => expect(document.querySelector('[data-slot="phone-view"]')).not.toBeNull());
    expect(url()).toBe('/services?state=problems&node=apps&q=jelly');
    expect(await screen.findByRole('heading', { level: 1, name: 'Services' })).toBeInTheDocument();
    const phone = within(document.querySelector('[data-slot="phone-view"]'));
    expect(phone.getByRole('searchbox', { name: 'Search services' })).toHaveValue('jelly');
    expect(
      await phone.findByRole('button', { name: /^App Server/, pressed: true })
    ).toBeInTheDocument();
    expect(phone.getAllByRole('button', { name: /^Jellyfin, / })).toHaveLength(1);

    // The phone's own search reaches the address, and the wide page reads it.
    const user = userEvent.setup();
    const box = phone.getByRole('searchbox', { name: 'Search services' });
    await user.clear(box);
    await user.type(box, 'graf');
    await waitFor(() => expect(url()).toBe('/services?q=graf&state=problems&node=apps'));

    resizeTo({ phone: false });
    const wide = await section('Services');
    expect(url()).toBe('/services?q=graf&state=problems&node=apps');
    expect(filters().getByRole('searchbox', { name: 'Search services' })).toHaveValue('graf');
    expect(filters().getByRole('combobox', { name: 'State' })).toHaveTextContent('Problems');
    // Grafana is up: Problems leaves nothing.
    expect(within(wide).getByText('No services match these filters')).toBeInTheDocument();
  });

  it("a node chip pressed on the phone is the wide page's Node; the wide page's state goes with it", async () => {
    window.history.replaceState(null, '', '/services?state=problems');
    media.phone = true;
    render(<App />);
    const view = await waitFor(() => {
      const el = document.querySelector('[data-slot="phone-view"]');
      expect(el).not.toBeNull();
      return within(el);
    });
    await userEvent.setup().click(await view.findByRole('button', { name: /^Storage/ }));
    expect(url()).toBe('/services?node=storage');
    resizeTo({ phone: false });
    const region = await section('Services');
    await waitFor(() =>
      expect(rows(region).sort()).toEqual(['Backrest', 'Photoprism', 'Syncthing'])
    );
  });

  it('the same search lists the same services at 1440 and at 767', async () => {
    const region = await servicesPage('/services?q=storage');
    const wide = rows(region).sort();
    expect(wide).toEqual(['Backrest', 'Photoprism', 'Syncthing']);
    resizeTo({ phone: true });
    const view = await waitFor(() => {
      const el = document.querySelector('[data-slot="phone-view"]');
      expect(el).not.toBeNull();
      return within(el);
    });
    const names = () =>
      view
        .queryAllByRole('button', { name: /, / })
        .map((b) => b.getAttribute('aria-label') ?? b.textContent)
        .map((n) => n.split(',')[0].trim());
    await waitFor(() => expect(names().sort()).toEqual(wide));
    // A space typed after it changes nothing.
    const box = view.getByRole('searchbox', { name: 'Search services' });
    await userEvent.setup().type(box, ' ');
    expect(names().sort()).toEqual(wide);
  });

  it('a node the phone list has no chip for is All', async () => {
    window.history.replaceState(null, '', '/services?node=nowhere');
    media.phone = true;
    render(<App />);
    const view = await waitFor(() => {
      const el = document.querySelector('[data-slot="phone-view"]');
      expect(el).not.toBeNull();
      return within(el);
    });
    expect(
      await view.findByRole('button', { name: `All ${SERVICE_COUNT}`, pressed: true })
    ).toBeInTheDocument();
    expect(view.getAllByRole('button', { name: /^Jellyfin, / })).toHaveLength(1);
  });

  it('/infrastructure keeps its path and filters both ways', async () => {
    const region = await infrastructurePage('/infrastructure?state=problems&q=nas');
    expect(cards(region)).toEqual(['nodes/storage']);
    resizeTo({ phone: true });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Infrastructure' })
    ).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[data-slot="phone-view"]')).not.toBeNull());
    expect(url()).toBe('/infrastructure?state=problems&q=nas');
    resizeTo({ phone: false });
    const again = await section('Infrastructure');
    await waitFor(() => expect(cards(again)).toEqual(['nodes/storage']));
    expect(url()).toBe('/infrastructure?state=problems&q=nas');
  });
});
