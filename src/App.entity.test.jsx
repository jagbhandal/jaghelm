import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { PHONE_WIDTH } from '@ui/app-shell';
import { runScenario } from '../server/testing/statusScenarios.js';
import { forgetAnswers } from './hooks/useData.js';
import { forgetOldHistoryServers } from './shell/detail/useHistory.js';
import { demoResponse } from '../server/demo.js';

// Entity URLs (#309, spec §7, §8): every entity the status model has opens at
// its URL, `?entity=<id>` over the page it is opened from. From 768px the URL
// draws the detail drawer, below it the phone's detail sheet; a reload draws
// it again, Back and Escape close it, focus goes back to the row that opened
// it, and an id the model has nothing by says so. Issue rows and entity rows
// open their entity's URL. e2e/entity.spec.mjs checks the same in a real
// browser, a sign-in on the way included.

const RUN = runScenario('every-state', { now: Date.now() });
const STATUS = JSON.parse(JSON.stringify(RUN.status));
const SERVICES = JSON.parse(JSON.stringify(RUN.cycle.caches.getCached('services')));

/** One entity of each kind: its id, its name, the drawer's overline, what the phone's sheet says. */
const KINDS = [
  ['service', 'services/apps:grafana', 'Grafana', 'Service', 'Pending'],
  ['container', 'services/apps:redis-cache', 'Redis Cache', 'Container', 'Missing'],
  ['node', 'nodes/edge', 'Network Edge', 'Node', 'Unreachable'],
  ['UPS', 'power/ups', 'Example UPS 1500VA', 'UPS', 'On battery'],
  ['job', 'jobs/apps:db-dump', 'db-dump', 'Job', 'Failed'],
  ['job that ran', 'jobs/storage:scrub-check', 'scrub-check', 'Job', 'OK'],
  ['backup', 'backups/storage:nightly-backup', 'nightly-backup', 'Backup', 'Overdue'],
  ['integration', 'integrations/jellyfin', 'jellyfin', 'Integration', 'Failing'],
  ['Arcane agent', 'integrations/arcane:apps', 'Arcane agent apps', 'Arcane agent', 'Offline'],
];

function respond(body, status = 200, headers = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

/** The window as a phone's (below 768px) or a desktop's. */
function windowOf({ phone }) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    media: query,
    matches: phone && query === PHONE_WIDTH,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  // The {} the other tests answer /api/history with is an older server's (#602).
  forgetOldHistoryServers();
  localStorage.clear();
  localStorage.setItem('jaghelm-token', 'tok');
  localStorage.setItem('jaghelm-config', JSON.stringify({ tabs: [] }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const path = String(url).split('?')[0];
      if (path === '/api/auth/check') return respond({ authRequired: true, authenticated: true });
      if (path === '/api/status') return respond(STATUS);
      if (path === '/api/services') return respond(SERVICES);
      if (path === '/api/display-config') return respond({}, 200, { ETag: '"v1"' });
      if (['/api/todos', '/api/gitea/activity', '/api/cron/status'].includes(path))
        return respond([]);
      return respond({});
    })
  );
});

const url = () => window.location.pathname + window.location.search;

// The header, drawn (inert, so hidden, under an open drawer or sheet).
const shell = () => screen.findByRole('banner', { hidden: true });

async function renderAt(path) {
  window.history.replaceState(null, '', path);
  render(<App />);
  await shell();
}

/** A reload: the app drawn again from the URL and the entry as they are. */
async function reload() {
  cleanup();
  render(<App />);
  await shell();
}

/**
 * Escape on a phone's sheet: the browser's modal <dialog> answers it with a
 * `cancel` event, which jsdom doesn't send (e2e/entity.spec.mjs presses it).
 */
const escapeSheet = (sheet) =>
  act(() => {
    fireEvent(sheet, new Event('cancel', { cancelable: true }));
  });

const drawer = (name) => screen.findByRole('dialog', { name });

describe('from 768px, the URL opens the detail drawer over the page (#309)', () => {
  beforeEach(() => windowOf({ phone: false }));

  for (const [kind, id, name, eyebrow, word] of KINDS) {
    it(`${kind}: opens from its URL, again on a reload; Back closes it, and Escape`, async () => {
      await renderAt(`/?entity=${id}`);
      let panel = await drawer(name);
      expect(panel).toHaveAttribute('data-slot', 'drawer');
      expect(within(panel).getByText(eyebrow)).toBeInTheDocument();
      const box = panel.querySelector('[data-slot="detail-status"]');
      expect(box).toHaveTextContent(word);
      // Over the Overview, which stays drawn under it.
      expect(document.querySelector('[data-slot="overview-status"]')).not.toBeNull();
      expect(document.title).toBe(`${name} — JagHelm`);

      await reload();
      panel = await drawer(name);

      // Escape: the URL is the page's again (it was opened from its URL).
      await userEvent.setup().keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(url()).toBe('/');

      // Back to it, and Back again closes it.
      window.history.pushState(null, '', `/?entity=${id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
      await drawer(name);
      window.history.back();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
  }

  it('an id the model has nothing by: "No longer monitored", over the page it was opened on', async () => {
    await renderAt('/alerts?entity=services/apps:gone');
    const panel = await drawer('No longer monitored');
    expect(panel).toHaveTextContent(/removed or renamed, or the link is old/);
    expect(panel).toHaveTextContent('services/apps:gone');
    expect(screen.getByRole('heading', { level: 1, name: 'Alerts', hidden: true })).toBeTruthy();
  });

  it('a crafted link’s words are never a heading: the titles are fixed, the id only as code, cut short', async () => {
    const words = 'Your session expired. Call 0800 123 456 to sign in again';
    const id = `services/${words} ${'x'.repeat(80)}`;
    await renderAt(`/?entity=${encodeURIComponent(id)}`);
    const panel = await drawer('No longer monitored');
    for (const heading of within(panel).getAllByRole('heading')) {
      expect(heading.textContent).not.toMatch(/session|0800/);
    }
    const code = panel.querySelector('code');
    expect(code.textContent).toMatch(/^services\/Your session expired/);
    expect(code.textContent).toHaveLength(64);
    expect(code.textContent.endsWith('…')).toBe(true);
    expect(panel.textContent.replace(code.textContent, '')).not.toMatch(/session|0800/);
    expect(document.title).toBe('Overview — JagHelm');
  });

  it('with no status to read: "No signal" and why, never the link’s words', async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      const path = String(url).split('?')[0];
      if (path === '/api/auth/check') return respond({ authRequired: true, authenticated: true });
      if (path === '/api/status') return Promise.reject(new TypeError('Failed to fetch'));
      return respond({});
    });
    await renderAt('/?entity=services/Call 0800 123 456');
    const panel = await drawer('No signal');
    expect(panel).toHaveTextContent("Can't reach JagHelm");
    expect(panel.textContent).not.toMatch(/0800/);
  });

  it('an attention-panel row opens its entity; Back closes it and focus is back on the row', async () => {
    await renderAt('/');
    const panel = await screen.findByRole('region', { name: 'Needs attention' });
    const user = userEvent.setup();
    const row = within(panel).getByRole('link', { name: /^Network Edge, Unreachable/ });
    expect(row).toHaveAttribute('href', '/?entity=nodes/edge');
    await user.click(row);
    expect(url()).toBe('/?entity=nodes/edge');
    await drawer('Network Edge');
    window.history.back();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(url()).toBe('/');
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('an Alerts row opens its entity over Alerts; Escape goes back, focus on the row', async () => {
    await renderAt('/alerts');
    const panel = await screen.findByRole('region', { name: 'Needs attention' });
    const user = userEvent.setup();
    const row = within(panel).getByRole('link', { name: /^nightly-backup, Overdue/ });
    await user.click(row);
    expect(url()).toBe('/alerts?entity=backups/storage:nightly-backup');
    await drawer('nightly-backup');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Opened here: Escape went back, so Forward opens it again.
    expect(url()).toBe('/alerts');
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('a Services row, a node’s card and its row in the table each open their entity', async () => {
    await renderAt('/');
    const user = userEvent.setup();
    const services = await screen.findByRole('region', { name: 'Services' });
    const gitea = await within(services).findByRole('link', { name: 'Gitea, Up' });
    await user.click(gitea);
    expect(url()).toBe('/?entity=services/apps:gitea');
    await drawer('Gitea');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(gitea).toHaveFocus());

    const infra = screen.getByRole('region', { name: 'Infrastructure' });
    const card = within(infra).getByRole('article', { name: 'Storage' });
    await user.click(within(card).getByRole('link', { name: 'Storage' }));
    expect(url()).toBe('/?entity=nodes/storage');
    await drawer('Storage');
    window.history.back();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(within(infra).getByRole('radio', { name: 'Table' }));
    const table = within(infra).getByRole('table', { name: 'Nodes' });
    await user.click(within(table).getByRole('link', { name: /^App Server/ }));
    expect(url()).toBe('/?entity=nodes/apps');
    await drawer('App Server');
  });
});

describe('below 768px, the URL opens the phone’s detail sheet (#309)', () => {
  beforeEach(() => windowOf({ phone: true }));

  for (const [kind, id, name, , word] of KINDS) {
    it(`${kind}: opens from its URL, again on a reload; Back closes it, and Escape`, async () => {
      await renderAt(`/?entity=${id}`);
      let sheet = await screen.findByRole('dialog', { name });
      expect(sheet).toHaveAttribute('data-slot', 'phone-sheet');
      expect(sheet.querySelector('[data-slot="detail-status"]')).toHaveTextContent(word);

      await reload();
      sheet = await screen.findByRole('dialog', { name });
      await escapeSheet(sheet);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(url()).toBe('/');

      window.history.pushState(null, '', `/?entity=${id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
      await screen.findByRole('dialog', { name });
      window.history.back();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
  }

  it('an id the model has nothing by: "No longer monitored"', async () => {
    await renderAt('/?entity=jobs/apps:gone');
    const sheet = await screen.findByRole('dialog', { name: 'No longer monitored' });
    expect(sheet).toHaveTextContent(/removed or renamed, or the link is old/);
  });

  it('the Overview’s issue rows, the Services and Infrastructure tabs’ rows and the Alerts rows open their entity’s URL', async () => {
    const user = userEvent.setup();
    const opens = async (row, want, name) => {
      await user.click(row);
      expect(url()).toBe(want);
      await screen.findByRole('dialog', { name });
      window.history.back();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(row).toHaveFocus());
    };
    await renderAt('/');
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    await opens(
      within(attention).getByRole('button', { name: /^Example UPS 1500VA, On battery/ }),
      '/?entity=power/ups',
      'Example UPS 1500VA'
    );
    const tabs = within(screen.getByRole('navigation', { name: 'Tabs' }));

    await user.click(tabs.getByRole('link', { name: 'Services' }));
    await opens(
      await screen.findByRole('button', { name: /^Gitea, / }),
      '/services?entity=services/apps:gitea',
      'Gitea'
    );

    await user.click(tabs.getByRole('link', { name: 'Infrastructure' }));
    const storage = await screen.findByRole('article', { name: 'Storage' });
    await opens(
      within(storage).getByRole('button', { name: 'Storage' }),
      '/infrastructure?entity=nodes/storage',
      'Storage'
    );

    await user.click(tabs.getByRole('link', { name: /^Alerts/ }));
    await opens(
      await screen.findByRole('button', { name: /^jellyfin, Failing/ }),
      '/alerts?entity=integrations/jellyfin',
      'jellyfin'
    );
  });

  it('a resize keeps the open entity: the sheet becomes the drawer, at the same URL', async () => {
    await renderAt('/?entity=nodes/storage');
    await screen.findByRole('dialog', { name: 'Storage' });
    cleanup();
    windowOf({ phone: false });
    render(<App />);
    const panel = await drawer('Storage');
    expect(panel).toHaveAttribute('data-slot', 'drawer');
    expect(url()).toBe('/?entity=nodes/storage');
  });
});

describe('what a detail shows, from the reads it makes while open (#310)', () => {
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
      {
        name: 'win11',
        vmid: 110,
        status: 'stopped',
        maxcpu: 4,
        memUsedGB: null,
        memTotalGB: '16.0',
      },
    ],
    _storagePools: [
      { name: 'local-lvm', type: 'lvmthin', usedGB: '851.2', totalGB: '900.0', percent: 94.6 },
    ],
    _lastBackup: { time: Date.now() - 3 * 3_600_000, ok: true, status: 'OK', vmCount: 2 },
  };
  const UPS = {
    status: 2,
    charge: 64,
    runtime: 1290,
    load: 31,
    ok: true,
    configured: true,
    model: 'Example UPS 1500VA',
  };
  const asked = (path) =>
    vi.mocked(fetch).mock.calls.filter(([u]) => String(u).split('?')[0] === path).length;

  beforeEach(() => {
    forgetAnswers();
    const answer = vi.mocked(fetch).getMockImplementation();
    vi.mocked(fetch).mockImplementation((u, init) => {
      const path = String(u).split('?')[0];
      if (path === '/api/integrations') return respond({ proxmox: PROXMOX });
      if (path === '/api/ups') return respond(UPS);
      return answer(u, init);
    });
  });

  it('from 768px: nothing is read for the drawer while it is closed; a Proxmox node’s lists it its own', async () => {
    windowOf({ phone: false });
    await renderAt('/alerts');
    await screen.findByRole('region', { name: 'Needs attention' });
    expect(asked('/api/integrations')).toBe(0);
    expect(asked('/api/ups')).toBe(0);

    window.history.pushState(null, '', '/alerts?entity=nodes/apps');
    window.dispatchEvent(new PopStateEvent('popstate'));
    const panel = await drawer('App Server');
    const vms = await within(panel).findByRole('region', { name: 'Virtual machines' });
    expect(vms).toHaveTextContent('1 / 2 running');
    expect(
      within(vms)
        .getAllByRole('listitem')
        .map((li) => li.firstChild.textContent)
    ).toEqual(['docker-brain8 vCPU · 21.4 / 32.0 GB · ID 103', 'win114 vCPU · ID 110']);
    const pools = within(panel).getByRole('region', { name: 'Storage pools' });
    expect(within(pools).getByRole('meter', { name: 'local-lvm' })).toHaveAttribute(
      'data-state',
      'warn'
    );
    expect(within(panel).getByRole('region', { name: 'Last backup' })).toHaveTextContent('3 h ago');
    expect(asked('/api/integrations')).toBe(1);
    expect(asked('/api/ups')).toBe(0);
  });

  it('from 768px, over the Overview: the drawer takes what the board just read, asking nothing more', async () => {
    windowOf({ phone: false });
    await renderAt('/');
    await waitFor(() => expect(asked('/api/integrations')).toBeGreaterThan(0));
    const before = { integrations: asked('/api/integrations'), services: asked('/api/services') };
    window.history.pushState(null, '', '/?entity=nodes/apps');
    window.dispatchEvent(new PopStateEvent('popstate'));
    const panel = await drawer('App Server');
    await within(panel).findByRole('region', { name: 'Virtual machines' });
    expect(asked('/api/integrations')).toBe(before.integrations);
    expect(asked('/api/services')).toBe(before.services);
  });

  it('from 768px: a node’s drawer draws its history, its four series in one read (#311)', async () => {
    windowOf({ phone: false });
    const answer = vi.mocked(fetch).getMockImplementation();
    vi.mocked(fetch).mockImplementation((u, init) => {
      const url = new URL(String(u), 'http://localhost');
      if (url.pathname !== '/api/history') return answer(u, init);
      const out = demoResponse({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
      return respond(out.body, out.status);
    });
    await renderAt('/alerts?entity=nodes/storage');
    const panel = await drawer('Storage');
    const history = await within(panel).findByRole('region', { name: 'History' });
    await within(history).findByRole('img', { name: 'Usage, last hour' });
    expect(
      within(history).getByRole('img', { name: 'Temperature, last hour' })
    ).toBeInTheDocument();
    expect(within(history).getByRole('radiogroup', { name: 'Range' })).toBeInTheDocument();
    expect(asked('/api/history')).toBe(1);
  });

  // The model carries the UPS's load and model (#586): /api/ups, answering
  // another load here, is never asked.
  it('from 768px: the UPS’s drawer has its charge, runtime, load and model, from the status alone', async () => {
    windowOf({ phone: false });
    await renderAt('/alerts?entity=power/ups');
    const panel = await drawer('Example UPS 1500VA');
    await within(panel).findByText('18 %');
    expect(within(panel).getByText('22 min left')).toBeInTheDocument();
    expect(within(panel).getByText('64 %')).toBeInTheDocument();
    expect(within(panel).getByText('Example UPS 1500VA', { selector: 'dd' })).toBeInTheDocument();
    expect(within(panel).queryByText('31 %')).toBeNull();
    expect(asked('/api/ups')).toBe(0);
  });

  it('below 768px: the node’s sheet has its machines and pools, the UPS’s its load and model', async () => {
    windowOf({ phone: true });
    await renderAt('/?entity=nodes/apps');
    let sheet = await screen.findByRole('dialog', { name: 'App Server' });
    const vms = await within(sheet).findByRole('region', { name: 'Virtual machines' });
    expect(vms).toHaveTextContent('docker-brain');
    expect(within(sheet).getByRole('region', { name: 'Storage pools' })).toBeInTheDocument();
    // The phone screens have /api/services already: the sheet reads only the integrations.
    expect(asked('/api/integrations')).toBe(1);

    window.history.back();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    window.history.pushState(null, '', '/?entity=power/ups');
    window.dispatchEvent(new PopStateEvent('popstate'));
    sheet = await screen.findByRole('dialog', { name: 'Example UPS 1500VA' });
    await within(sheet).findByText('18 %');
    expect(within(sheet).getByText('Example UPS 1500VA', { selector: 'dd' })).toBeInTheDocument();
    expect(within(sheet).getByText('22 min left')).toBeInTheDocument();
    expect(asked('/api/ups')).toBe(0);
  });
});
