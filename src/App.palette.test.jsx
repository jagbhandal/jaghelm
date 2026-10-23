import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { runScenario } from '../server/testing/statusScenarios.js';

// The command palette finds things (#315): each kind of result, opened from
// the palette in the app, goes where it should. An entity or an issue opens
// its detail over the page, at the URL its rows open (#309); a page, an app
// and a Settings section open their address; a Quick Launch link is the link
// the Quick Launch panel draws.

const RUN = runScenario('every-state', { now: Date.now() });
const STATUS = JSON.parse(JSON.stringify(RUN.status));
const SERVICES = JSON.parse(JSON.stringify(RUN.cycle.caches.getCached('services')));
const GRAFANA = {
  id: 'grafana',
  label: 'Grafana',
  type: 'iframe',
  url: 'https://grafana.example/',
};
const LINKS = { personal: [{ name: 'Nextcloud', url: 'https://cloud.example/' }] };

function respond(body, status = 200, headers = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

/** A desktop's window (from 768px): the phone's breakpoint never matches. */
function desktop() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    media: query,
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  desktop();
  localStorage.clear();
  localStorage.setItem('jaghelm-token', 'tok');
  localStorage.setItem('jaghelm-config', JSON.stringify({ tabs: [GRAFANA], links: LINKS }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const path = String(url).split('?')[0];
      if (path === '/api/auth/check') return respond({ authRequired: true, authenticated: true });
      if (path === '/api/status') return respond(STATUS);
      if (path === '/api/services') return respond(SERVICES);
      if (path === '/api/display-config')
        return respond({ tabs: [GRAFANA], links: LINKS }, 200, { ETag: '"v1"' });
      if (['/api/todos', '/api/gitea/activity', '/api/cron/status'].includes(path))
        return respond([]);
      return respond({});
    })
  );
});

const url = () => window.location.pathname + window.location.search;
const banner = () => screen.getByRole('banner', { hidden: true });
const drawer = (name) => screen.findByRole('dialog', { name });

async function renderAt(path) {
  window.history.replaceState(null, '', path);
  render(<App />);
  await screen.findByRole('banner', { hidden: true });
  // The model's status is in once the header says it.
  await within(banner()).findByRole('link', { name: /^Critical/ });
}

/** Opens the palette from the header's search button and types `query`. */
async function search(user, query) {
  await user.click(within(banner()).getAllByRole('button', { name: /^Search or jump to/ })[0]);
  const field = await screen.findByRole('combobox', { name: 'Search' });
  await waitFor(() => expect(field).toHaveFocus());
  if (query) await user.type(field, query);
  return field;
}

const result = (name) => screen.getByRole('option', { name });

// Each entity kind with an address: what to type, the row's name, its id, the drawer's title.
const ENTITIES = [
  ['a service', 'grafana', /^Grafana, Service, Pending, apps$/, 'services/apps:grafana', 'Grafana'],
  ['a node', 'network edge', /^Network Edge, Node,/, 'nodes/edge', 'Network Edge'],
  ['the UPS', 'ups', /^Example UPS 1500VA, UPS,/, 'power/ups', 'Example UPS 1500VA'],
  ['a job', 'db-dump', /^db-dump, Job,/, 'jobs/apps:db-dump', 'db-dump'],
  [
    'a backup',
    'nightly',
    /^nightly-backup, Backup,/,
    'backups/storage:nightly-backup',
    'nightly-backup',
  ],
  ['an integration', 'jellyfin', /^jellyfin, Integration,/, 'integrations/jellyfin', 'jellyfin'],
];

describe('the command palette opens what it finds (#315)', () => {
  for (const [kind, query, name, id, title] of ENTITIES) {
    it(`${kind}: its detail over the page, at its URL, as its rows open it`, async () => {
      const user = userEvent.setup();
      await renderAt('/');
      await search(user, query);
      const row = result(name);
      expect(row).toHaveAttribute('href', `/?entity=${id}`);
      await user.click(row);
      expect(url()).toBe(`/?entity=${id}`);
      await drawer(title);
      expect(screen.queryByRole('combobox')).toBeNull();
    });
  }

  it('an issue (current issues come first, worst first) opens its entity, over the page it was on', async () => {
    const user = userEvent.setup();
    await renderAt('/alerts');
    const field = await search(user, '');
    const first = screen.getAllByRole('option')[0];
    expect(field).toHaveAttribute('aria-activedescendant', first.id);
    expect(first).toHaveAccessibleName(
      "Network Edge, Issue, Unreachable, Node · edge, Unreachable: Prometheus can't scrape it"
    );
    await user.keyboard('{Enter}');
    expect(url()).toBe('/alerts?entity=nodes/edge');
    await drawer('Network Edge');
    // Closed as a row's opening closes: back to the page, focus where it was.
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(url()).toBe('/alerts');
    await waitFor(() =>
      expect(
        within(banner()).getAllByRole('button', { name: /^Search or jump to/ })[0]
      ).toHaveFocus()
    );
  });

  it('a Settings section opens at its address', async () => {
    const user = userEvent.setup();
    await renderAt('/');
    await search(user, 'bookmarks');
    await user.click(result(/^Links, Settings, Quick Launch bookmarks$/));
    expect(url()).toBe('/settings/links');
    expect(await screen.findByRole('navigation', { name: 'Settings sections' })).toBeTruthy();
  });

  it('a page opens at its address', async () => {
    const user = userEvent.setup();
    await renderAt('/');
    await search(user, 'alerts');
    await user.keyboard('{Enter}');
    expect(url()).toBe('/alerts');
  });

  it('an app opens inside JagHelm', async () => {
    const user = userEvent.setup();
    await renderAt('/');
    await search(user, 'open grafana');
    expect(screen.getAllByRole('option')[0]).toHaveAccessibleName(
      'Open Grafana, App, Opens inside JagHelm'
    );
    await user.keyboard('{Enter}');
    expect(url()).toBe('/apps/grafana');
  });

  it('a Quick Launch link opens as the panel opens it: its target, no opener', async () => {
    const user = userEvent.setup();
    await renderAt('/');
    // Its host finds it alone (the Nextcloud service would come first).
    await search(user, 'cloud.example');
    const link = result(/^Open Nextcloud, Link, Personal, cloud\.example$/);
    expect(link).toHaveAttribute('href', 'https://cloud.example/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // Enter clicks the link itself, and nothing stops the browser following it.
    const followed = [];
    const onClick = (e) => {
      if (e.target !== link) return;
      followed.push(!e.defaultPrevented);
      e.preventDefault(); // jsdom can't open a tab
    };
    document.addEventListener('click', onClick);
    try {
      await user.keyboard('{Enter}');
    } finally {
      document.removeEventListener('click', onClick);
    }
    expect(followed).toEqual([true]);
    expect(url()).toBe('/');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('a Quick Launch link follows Settings → Layout’s "Same Tab"', async () => {
    localStorage.setItem(
      'jaghelm-config',
      JSON.stringify({ tabs: [GRAFANA], links: LINKS, linkTarget: '_self' })
    );
    vi.mocked(fetch).mockImplementation((u) => {
      const path = String(u).split('?')[0];
      if (path === '/api/auth/check') return respond({ authRequired: true, authenticated: true });
      if (path === '/api/status') return respond(STATUS);
      if (path === '/api/display-config')
        return respond({ tabs: [GRAFANA], links: LINKS, linkTarget: '_self' }, 200, {
          ETag: '"v1"',
        });
      return respond([]);
    });
    const user = userEvent.setup();
    await renderAt('/');
    await search(user, 'nextcloud');
    expect(result(/^Open Nextcloud/)).toHaveAttribute('target', '_self');
  });

  it('themes are not in the palette', async () => {
    const user = userEvent.setup();
    await renderAt('/');
    const field = await search(user, '');
    const names = screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'));
    expect(names.some((n) => /^(Dark|Light|System)\b/.test(n))).toBe(false);
    for (const word of ['dark', 'light']) {
      await user.clear(field);
      await user.type(field, word);
      expect(screen.queryAllByRole('option')).toEqual([]);
    }
    await user.clear(field);
    await user.type(field, 'theme');
    // Only where themes are chosen: Settings → Appearance.
    expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual([
      'Appearance, Settings, Theme, Overview sections, background',
    ]);
  });
});
