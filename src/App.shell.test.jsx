import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent, act, cleanup } from '@testing-library/react';
import App from './App.jsx';
import { SIDEBAR_PREF } from './shell/ShellChrome.jsx';
import { FIRST_RUN, INCIDENT, HEALTHY } from './testing/statusFixtures.js';
import { RAIL_WIDTH } from '@ui/app-shell';

// The app shell (#296): the header, the grouped sidebar and the phone's tabs
// around every page, the URL as the page, and every old view still reachable.
// jsdom applies no media queries, so the sidebar (from 768px) and the tabs
// (below it) are both in the page here; each test looks in the one it means.

let server;

function respond(body, status = 200, headers = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

const GRAFANA = {
  id: 'grafana',
  label: 'Grafana',
  type: 'iframe',
  url: 'https://grafana.example/',
};
const KUMA = { id: 'kuma', label: 'Uptime Kuma', type: 'iframe', url: 'https://kuma.example/' };

// `serverConfig` is the display config the server holds (none by default);
// each config the app saves to it lands in `server.saves`. `answers` are
// bodies by path, such as /api/weather's.
function stubServer({
  tabs = [GRAFANA, KUMA],
  status = INCIDENT,
  serverTabs,
  config = {},
  serverConfig,
  answers = {},
} = {}) {
  server = { requests: [], saves: [], status, statusDown: false, statusPending: false };
  localStorage.setItem('jaghelm-config', JSON.stringify({ tabs, ...config }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url, init) => {
      const path = String(url).split('?')[0];
      server.requests.push(path);
      if (path === '/api/auth/check') return respond({ authRequired: true, authenticated: true });
      if (path === '/api/status') {
        if (server.statusDown) return Promise.reject(new TypeError('Failed to fetch'));
        if (server.statusPending) return new Promise(() => {});
        return respond(server.status);
      }
      if (path === '/api/display-config' && init?.method === 'POST') {
        server.saves.push(JSON.parse(init.body));
        return respond({ ok: true });
      }
      // With its version (#547): a copy without one is never shown.
      if (path === '/api/display-config')
        return respond(serverConfig ?? (serverTabs ? { tabs: serverTabs } : {}), 200, {
          ETag: '"v1"',
        });
      if (Object.hasOwn(answers, path)) return respond(answers[path]);
      if (['/api/todos', '/api/gitea/activity', '/api/cron/status'].includes(path))
        return respond([]);
      return respond({});
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('jaghelm-token', 'tok');
  stubServer();
});

const sidebar = () => screen.getByRole('navigation', { name: 'Main' });
const tabsBar = () => screen.getByRole('navigation', { name: 'Tabs' });
const banner = () => screen.getByRole('banner');
const entry = (name) => within(sidebar()).getByRole('link', { name: new RegExp(`^${name}`) });
const frame = (url) => document.querySelector(`iframe[src="${url}"]`);

async function renderApp(path = '/') {
  window.history.replaceState(null, '', path);
  render(<App />);
  await screen.findByRole('navigation', { name: 'Main' });
}

const current = (name) =>
  waitFor(() => expect(entry(name)).toHaveAttribute('aria-current', 'page'));

describe('the header', () => {
  it("shows the model's incident sentence, a link to Alerts", async () => {
    await renderApp();
    const status = await within(banner()).findByRole('link', { name: /^Critical/ });
    expect(status).toHaveTextContent(INCIDENT.overall.sentence);
    fireEvent.click(status);
    await current('Alerts');
    expect(window.location.pathname).toBe('/alerts');
  });

  // #480: the last status stays, as last known, never in its colour.
  it('turns steel "No signal" when the backend stops answering, saying what it last knew', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await renderApp();
      await within(banner()).findByRole('link', { name: /^Critical/ });
      server.statusDown = true;
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      const link = within(banner()).getByRole('link', {
        name: /^No signal: last known 30 s ago: Critical · 2 critical, 1 warning, 1 no signal$/,
      });
      expect(link).toHaveAttribute('data-state', 'unknown');
    } finally {
      vi.useRealTimers();
    }
  });

  it('has the instance name, search, Settings and Log out; the motto is gone', async () => {
    localStorage.setItem(
      'jaghelm-config',
      JSON.stringify({ title: 'Homelab', welcomeMessage: { enabled: true, text: 'Ahoy' } })
    );
    await renderApp();
    expect(within(banner()).getByRole('link', { name: 'Homelab' })).toHaveAttribute('href', '/');
    // The wide button (from 1024px) and the icon (narrower).
    expect(within(banner()).getAllByRole('button', { name: /^Search or jump to/ })).toHaveLength(2);
    expect(within(banner()).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings'
    );
    expect(within(banner()).getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    expect(screen.queryByText('Ahoy')).toBeNull();
  });

  it('the search button opens the command palette, which opens an app', async () => {
    await renderApp();
    fireEvent.click(within(banner()).getAllByRole('button', { name: /^Search or jump to/ })[0]);
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'grafana' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await current('Grafana');
    await waitFor(() => expect(frame(GRAFANA.url)).not.toBeNull());
  });

  it('Log out returns to the login screen, on the Overview', async () => {
    await renderApp('/alerts');
    fireEvent.click(within(banner()).getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(screen.queryByRole('banner')).toBeNull());
    expect(window.location.pathname).toBe('/');
  });
});

describe('the sidebar', () => {
  it('groups Monitor, Apps and Tools, each entry a link', async () => {
    await renderApp();
    const groups = within(sidebar()).getAllByRole('group');
    expect(groups.map((g) => g.textContent.match(/^(Monitor|Apps|Tools)/)?.[1])).toEqual([
      'Monitor',
      'Apps',
      'Tools',
    ]);
    // The mock's Monitor: Overview, Services, Infrastructure (#313), Alerts.
    expect(
      within(groups[0])
        .getAllByRole('link')
        .map((l) => l.getAttribute('href'))
    ).toEqual(['/', '/services', '/infrastructure', '/alerts']);
    expect(
      within(groups[1])
        .getAllByRole('link')
        .map((l) => l.getAttribute('href'))
    ).toEqual(['/apps/grafana', '/apps/kuma', '/settings/apps']);
    // Launch joins Tools before Settings (#301).
    expect(
      within(groups[2])
        .getAllByRole('link')
        .map((l) => l.getAttribute('href'))
    ).toEqual(['/launch', '/settings']);
    expect(within(groups[2]).getByRole('link', { name: 'Launch' })).toBeInTheDocument();
  });

  it('every entry navigates, and marks itself current', async () => {
    await renderApp();
    await current('Overview');
    fireEvent.click(entry('Alerts'));
    await current('Alerts');
    expect(await screen.findByRole('heading', { level: 1, name: 'Alerts' })).toBeInTheDocument();

    fireEvent.click(entry('Grafana'));
    await current('Grafana');
    await waitFor(() => expect(frame(GRAFANA.url)).not.toBeNull());

    fireEvent.click(entry('Launch'));
    await current('Launch');
    expect(await screen.findByRole('heading', { level: 1, name: 'Launch' })).toBeInTheDocument();

    fireEvent.click(entry('Settings'));
    await current('Settings');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();

    fireEvent.click(entry('Add app'));
    expect(await screen.findByRole('heading', { name: 'Embedded apps' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/settings/apps');

    fireEvent.click(entry('Overview'));
    await current('Overview');
  });

  it('badges Alerts with the issue count', async () => {
    await renderApp();
    await waitFor(() =>
      expect(entry('Alerts')).toHaveAccessibleName(`Alerts, ${INCIDENT.issues.length} issues`)
    );
  });

  it('collapses to icons, remembered in this browser', async () => {
    await renderApp();
    fireEvent.click(within(sidebar()).getByRole('button', { name: 'Collapse sidebar' }));
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true');
    expect(localStorage.getItem(SIDEBAR_PREF)).toBe('collapsed');
    // Each entry keeps its name.
    expect(entry('Overview')).toBeInTheDocument();
  });

  it('starts collapsed when this browser said so, and works with storage blocked', async () => {
    localStorage.setItem(SIDEBAR_PREF, 'collapsed');
    await renderApp();
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true');
    const get = vi.spyOn(Storage.prototype, 'getItem');
    const set = vi.spyOn(Storage.prototype, 'setItem');
    get.mockImplementation((key) => {
      if (key === SIDEBAR_PREF) throw new DOMException('blocked', 'SecurityError');
      return get.wrappedImplementation?.(key) ?? null;
    });
    set.mockImplementation((key) => {
      if (key === SIDEBAR_PREF) throw new DOMException('blocked', 'SecurityError');
    });
    fireEvent.click(within(sidebar()).getByRole('button', { name: 'Expand sidebar' }));
    expect(sidebar()).not.toHaveAttribute('data-collapsed');
    get.mockRestore();
    set.mockRestore();
  });

  it('dots a loaded app, and Unload unloads it', async () => {
    await renderApp();
    fireEvent.click(entry('Grafana'));
    await waitFor(() => expect(frame(GRAFANA.url)).not.toBeNull());
    fireEvent.click(entry('Overview'));
    await waitFor(() => expect(entry('Grafana')).toHaveAccessibleName('Grafana, still loaded'));
    fireEvent.click(within(sidebar()).getByRole('button', { name: 'Unload Grafana' }));
    expect(frame(GRAFANA.url)).toBeNull();
    expect(entry('Grafana')).toHaveAccessibleName('Grafana');
    expect(entry('Grafana')).toHaveFocus();
  });
});

describe('the app bar', () => {
  it("shows over the open app, and Reload reloads that app's frame alone", async () => {
    await renderApp();
    fireEvent.click(entry('Uptime Kuma'));
    await waitFor(() => expect(frame(KUMA.url)).not.toBeNull());
    fireEvent.click(entry('Grafana'));
    await waitFor(() => expect(frame(GRAFANA.url)).not.toBeNull());
    const grafana = frame(GRAFANA.url);
    const kuma = frame(KUMA.url);

    const region = screen.getByRole('region', { name: 'Grafana, open inside JagHelm' });
    const bar = region.querySelector('[data-slot="app-bar"]');
    expect(bar).toHaveTextContent(GRAFANA.url);
    const open = within(bar).getByRole('link', { name: 'Open in new tab' });
    expect(open).toHaveAttribute('href', GRAFANA.url);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');

    fireEvent.click(within(bar).getByRole('button', { name: 'Reload Grafana' }));
    await waitFor(() => expect(grafana.isConnected).toBe(false));
    expect(frame(GRAFANA.url)).not.toBeNull();
    expect(frame(GRAFANA.url)).not.toBe(grafana);
    // The other loaded app keeps its frame, and no frame moved.
    expect(frame(KUMA.url)).toBe(kuma);
    expect([...document.querySelectorAll('iframe')].map((f) => f.getAttribute('src'))).toEqual([
      KUMA.url,
      GRAFANA.url,
    ]);
  });

  it('is not there when no app is open', async () => {
    await renderApp();
    fireEvent.click(entry('Grafana'));
    await waitFor(() => expect(frame(GRAFANA.url)).not.toBeNull());
    fireEvent.click(entry('Overview'));
    await current('Overview');
    expect(document.querySelector('[data-slot="app-bar"]')).toBeNull();
  });
});

describe("the phone's tabs", () => {
  it('Overview, Services, Infrastructure, Alerts and More; More holds the apps, Launch and Settings', async () => {
    await renderApp();
    const tabs = within(tabsBar());
    // The spec's five (§7, #303); Infrastructure drawn "Infra", as the Phone board's.
    expect(tabs.getAllByRole('link').map((l) => l.getAttribute('aria-label'))).toEqual([
      'Overview',
      'Services',
      'Infrastructure',
      expect.stringMatching(/^Alerts/),
    ]);
    expect(tabs.getByRole('link', { name: 'Infrastructure' })).toHaveTextContent(/^Infra$/);
    expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(tabs.getByRole('link', { name: /^Alerts/ }));
    await waitFor(() =>
      expect(tabs.getByRole('link', { name: /^Alerts/ })).toHaveAttribute('aria-current', 'page')
    );

    fireEvent.click(tabs.getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog', { name: 'More' });
    fireEvent.click(within(sheet).getByRole('link', { name: 'Uptime Kuma' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull());
    await waitFor(() => expect(frame(KUMA.url)).not.toBeNull());
    expect(window.location.pathname).toBe('/apps/kuma');
    expect(tabs.getByRole('button', { name: 'More' })).toHaveAttribute('data-current', 'true');

    fireEvent.click(tabs.getByRole('button', { name: 'More' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'More' })).getByRole('link', {
        name: 'Launch',
      })
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Launch' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/launch');
    expect(tabs.getByRole('button', { name: 'More' })).toHaveAttribute('data-current', 'true');

    fireEvent.click(tabs.getByRole('button', { name: 'More' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'More' })).getByRole('link', {
        name: 'Settings',
      })
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });
});

describe('the URL is the page', () => {
  it('a deep link (a reload, a chunk reload after a deploy) opens its page', async () => {
    await renderApp('/settings/apps');
    expect(await screen.findByRole('heading', { name: 'Embedded apps' })).toBeInTheDocument();
    await current('Settings');
  });

  // #317: Settings' 13 tabs became sections; a bookmark of one still lands.
  it("an old Settings tab's address opens the section it moved to, under that section's address", async () => {
    await renderApp('/settings/tabs');
    expect(await screen.findByRole('heading', { name: 'Embedded apps' })).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/settings/apps'));
    await current('Settings');
    cleanup();
    await renderApp('/settings/sections');
    expect(await screen.findByRole('heading', { name: 'Custom groups' })).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/settings/nodes'));
    cleanup();
    await renderApp('/settings/nope');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await waitFor(() => expect(window.location.pathname).toBe('/settings'));
  });

  // #318: Settings → Sources reads the header's poll, so it moves with the board.
  it('Settings → Sources draws each source from the header’s poll: no second /api/status', async () => {
    await renderApp('/settings/sources');
    const prometheus = await screen.findByRole('heading', { name: 'Prometheus' });
    await waitFor(() =>
      expect(document.getElementById('prometheus')).toHaveTextContent('Answering')
    );
    expect(prometheus).toBeInTheDocument();
    expect(document.getElementById('gitea')).toHaveTextContent('Not set up');
    expect(server.requests.filter((r) => r === '/api/status')).toHaveLength(1);
    await current('Settings');
  });

  it('opens an app at its URL', async () => {
    await renderApp('/apps/grafana');
    await current('Grafana');
    await waitFor(() => expect(frame(GRAFANA.url)).not.toBeNull());
  });

  it('opens an app only the server has, once its config is in', async () => {
    stubServer({ tabs: [], serverTabs: [GRAFANA] });
    await renderApp('/apps/grafana');
    await waitFor(() => expect(frame(GRAFANA.url)).not.toBeNull());
    expect(window.location.pathname).toBe('/apps/grafana');
  });

  it('an app the config no longer has lands on the Overview', async () => {
    await renderApp('/apps/deleted');
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    await current('Overview');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('no page at all lands on the Overview', async () => {
    for (const path of ['/nope', '/services/old']) {
      await renderApp(path);
      await waitFor(() => expect(window.location.pathname, path).toBe('/'));
      await current('Overview');
      cleanup();
    }
  });

  it('Back and Forward move between pages', async () => {
    await renderApp();
    fireEvent.click(entry('Alerts'));
    await current('Alerts');
    fireEvent.click(entry('Settings'));
    await current('Settings');
    act(() => {
      window.history.replaceState(null, '', '/alerts');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await current('Alerts');
  });

  it('the Settings section follows the URL', async () => {
    await renderApp('/settings');
    fireEvent.click(await screen.findByRole('link', { name: 'Apps & links' }));
    await waitFor(() => expect(window.location.pathname).toBe('/settings/apps'));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Apps & links' })
    ).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    fireEvent.click(within(nav).getByRole('link', { name: 'System' }));
    await waitFor(() => expect(window.location.pathname).toBe('/settings/system'));
    // A section opened is a page of its own: Back returns to the one before.
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe('/settings/apps'));
  });

  it('names the browser tab after the page', async () => {
    await renderApp('/alerts');
    await waitFor(() => expect(document.title).toBe('Alerts — JagHelm'));
  });

  it('/launch opens the Launch page, no longer the Overview (#301)', async () => {
    await renderApp('/launch');
    expect(await screen.findByRole('heading', { level: 1, name: 'Launch' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/launch');
    await current('Launch');
    await waitFor(() => expect(document.title).toBe('Launch — JagHelm'));
  });
});

// The top of the Overview (#297): the status model, as the Alerts page draws
// it, over the Overview's sections, from the header's own poll.
describe('the Overview', () => {
  const overviewStatus = () => document.querySelector('[data-slot="overview-status"]');

  it("leads with the model's incident: the counts, its sentence, the ranked issues", async () => {
    await renderApp();
    const panel = await screen.findByRole('region', { name: 'Needs attention' });
    expect(overviewStatus()).toContainElement(panel);
    // Under the page's own h1, Overview.
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Critical · 2 critical, 1 warning, 1 no signal'
    );
    expect(within(panel).getByText(INCIDENT.overall.sentence)).toBeInTheDocument();
    const rows = within(panel).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Immich'),
      expect.stringContaining('Back-UPS'),
      expect.stringContaining('vm103'),
      expect.stringContaining('pi'),
    ]);
    // Each row links to its entity's URL, over this page (#309), whatever the
    // board below draws.
    expect(rows.map((r) => within(r).getByRole('link').getAttribute('href'))).toEqual([
      '/?entity=services/vm103:immich',
      '/?entity=power/ups',
      '/?entity=nodes/vm103',
      '/?entity=nodes/pi',
    ]);
    // All alerts, as the mock has it, in accent-text, opens the Alerts page.
    const all = within(panel).getByRole('link', { name: 'All alerts' });
    expect(all).toHaveAttribute('href', '/alerts');
    expect(all).toHaveClass('text-accent-text');
    expect(all).not.toHaveClass('text-text-2');
    fireEvent.click(all);
    await current('Alerts');
  });

  it('reads the header’s poll: no second /api/status', async () => {
    await renderApp();
    await screen.findByRole('region', { name: 'Needs attention' });
    expect(server.requests.filter((r) => r === '/api/status')).toHaveLength(1);
  });

  it("is the quiet line when all is well, with the model's sentence", async () => {
    stubServer({ status: HEALTHY });
    await renderApp();
    const line = await screen.findByRole('region', { name: 'Status' });
    expect(overviewStatus()).toContainElement(line);
    expect(line).toHaveTextContent(`All systems normal${HEALTHY.overall.sentence}`);
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull();
  });

  // #449: nothing is set up, so there is no state to give a lamp.
  it('on an empty board: the quiet line, "Nothing monitored yet", with no lamp', async () => {
    stubServer({ status: FIRST_RUN });
    await renderApp();
    const line = await screen.findByRole('region', { name: 'Status' });
    expect(overviewStatus()).toContainElement(line);
    expect(line).toHaveTextContent(/^Nothing monitored yet$/);
    expect(line.querySelector('[data-slot="status-lamp"]')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull();
  });

  // #298: the subsystem strip under the status, from the same poll.
  it('has the subsystem strip under the status: a tile per subsystem with anything in it', async () => {
    stubServer({ status: HEALTHY });
    await renderApp();
    const strip = await screen.findByRole('region', { name: 'Subsystems' });
    expect(overviewStatus()).toContainElement(strip);
    const configured = HEALTHY.subsystems.filter((s) => s.counts.total > 0);
    // This board has no job, backup or integration: their tiles are left out.
    expect(configured.map((s) => s.id)).toEqual(['services', 'nodes', 'power']);
    const labels = within(strip)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(labels).toHaveLength(configured.length);
    configured.forEach((s, n) => {
      expect(labels[n].startsWith(`${s.name}, `)).toBe(true);
      expect(labels[n].endsWith(`, ${s.value}`)).toBe(true);
    });
    expect(server.requests.filter((r) => r === '/api/status')).toHaveLength(1);
  });

  // #298: a filter the status doesn't show leaves the URL, but only once the
  // status has said so.
  it('keeps the filter in the URL before the first status, and drops one the status doesn’t show', async () => {
    stubServer({ status: HEALTHY });
    server.statusPending = true;
    await renderApp('/?subsystem=jobs');
    expect(window.location.search).toBe('?subsystem=jobs');
    cleanup();

    // This board has no jobs: the URL drops the filter, replacing its entry.
    stubServer({ status: HEALTHY });
    window.history.replaceState(null, '', '/');
    const entries = window.history.length;
    await renderApp('/?subsystem=jobs');
    await screen.findByRole('region', { name: 'Subsystems' });
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(window.location.pathname).toBe('/');
    expect(window.history.length).toBe(entries);
    expect(screen.queryByText(/^Showing/)).toBeNull();
  });

  it('on an empty board: no strip', async () => {
    stubServer({ status: FIRST_RUN });
    await renderApp();
    await screen.findByRole('region', { name: 'Status' });
    expect(screen.queryByRole('region', { name: 'Subsystems' })).toBeNull();
  });

  it('is a placeholder before the first answer', async () => {
    stubServer();
    server.statusPending = true;
    await renderApp();
    const busy = overviewStatus().querySelector('[aria-busy="true"]');
    expect(busy).toHaveTextContent('Loading status');
    expect(within(overviewStatus()).queryByRole('region')).toBeNull();
  });

  // #480: without a signal the panel keeps what the server last said, in
  // steel, and says how long ago, as the header does.
  it('without a signal, says so and keeps what the server last said, as last known', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await renderApp();
      await screen.findByRole('region', { name: 'Needs attention' });
      server.statusDown = true;
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      // A blip doesn't blank the panel: its rows stay, each a steel ring.
      const panel = within(overviewStatus()).getByRole('region', { name: 'Needs attention' });
      expect(panel).toHaveAttribute('data-state', 'unknown');
      expect(panel).toHaveTextContent('Immich');
      expect(
        panel.querySelectorAll('[data-slot="status-lamp"][data-state="unknown"]')
      ).toHaveLength(panel.querySelectorAll('[data-slot="status-lamp"]').length);
      const heading = within(panel).getByRole('heading', { level: 2 });
      expect(heading).toHaveTextContent(
        'No signal · last known 30 s ago: Critical · 2 critical, 1 warning, 1 no signal'
      );
      expect(within(panel).getByText("Can't reach JagHelm")).toBeInTheDocument();
      // The panel says it all: no second "No signal" banner over it.
      expect(overviewStatus().querySelector('[data-slot="banner"]')).toBeNull();

      // The polls keep failing, so nothing new arrives: the age keeps its own
      // clock, and the header reads the same one. The clock jumps 19.5 min
      // without running the timers on the way (stepping them drew each of
      // its 1,200 seconds, past 5 s on a busy machine, #490), then one more
      // poll period runs, its poll failing too.
      vi.setSystemTime(Date.now() + 19.5 * 60_000);
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(heading).toHaveTextContent(/^No signal · last known 20 min ago: Critical/);
      expect(within(banner()).getByRole('link', { name: /^No signal/ })).toHaveAccessibleName(
        /^No signal: last known 20 min ago: Critical/
      );
      expect(within(banner()).getByText('Updated 20 min ago')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('with no status ever, a "No signal" banner says why, and no panel', async () => {
    stubServer();
    server.statusDown = true;
    await renderApp();
    const said = await waitFor(() => {
      const el = overviewStatus().querySelector('[data-slot="banner"]');
      expect(el).not.toBeNull();
      return el;
    });
    expect(said).toHaveAttribute('data-tone', 'unknown');
    expect(said).toHaveTextContent(/^No signal.*Can't reach JagHelm$/);
    expect(
      within(overviewStatus()).queryByRole('region', { name: /Needs attention|Status/ })
    ).toBeNull();
  });

  it('is on the Overview alone', async () => {
    await renderApp('/alerts');
    await screen.findByRole('region', { name: 'Needs attention' });
    expect(overviewStatus()).toBeNull();
  });
});

describe('the Alerts page', () => {
  it("lists the model's issues, worst first", async () => {
    await renderApp('/alerts');
    const panel = await screen.findByRole('region', { name: 'Needs attention' });
    expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Critical · 2 critical, 1 warning, 1 no signal'
    );
    const rows = within(panel).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Immich'),
      expect.stringContaining('Back-UPS'),
      expect.stringContaining('vm103'),
      expect.stringContaining('pi'),
    ]);
  });

  it('is the quiet line when all is well', async () => {
    stubServer({ status: HEALTHY });
    await renderApp('/alerts');
    expect(await screen.findByRole('region', { name: 'Status' })).toHaveTextContent(
      `All systems normal${HEALTHY.overall.sentence}`
    );
  });

  // #449: a first run has nothing set up, so nothing needs attention.
  it('on a first run, nothing monitored yet: the quiet line, no attention panel, no alarm', async () => {
    stubServer({ status: FIRST_RUN });
    await renderApp('/alerts');
    const line = await screen.findByRole('region', { name: 'Status' });
    expect(line).toHaveTextContent(/^Nothing monitored yet$/);
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull();
    // The header says the same, quietly, and Alerts has no badge.
    await waitFor(() =>
      expect(within(banner()).getByRole('status')).toHaveTextContent('Nothing monitored yet')
    );
    expect(within(banner()).queryByText('No signal')).toBeNull();
    expect(entry('Alerts')).toHaveAccessibleName('Alerts');
  });
});

// The utilities (#301): Quick Launch, Pipeline and the Checklist. jsdom
// applies no media query, so each test says whether the window is 1440px
// wide (RAIL_WIDTH), as matchMedia would.
describe('the utilities', () => {
  const LINKS = { links: { personal: [{ name: 'Nextcloud', url: 'https://cloud.example/' }] } };
  const rail = () => screen.queryByRole('region', { name: 'Utilities' });

  function wide(on) {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: on && query === RAIL_WIDTH,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }));
  }

  it('from 1440px, the Overview has its rail: Quick Launch and the Checklist', async () => {
    wide(true);
    stubServer({ config: LINKS });
    await renderApp();
    const region = await screen.findByRole('region', { name: 'Utilities' });
    expect(within(region).getByRole('region', { name: 'Quick Launch' })).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: 'Nextcloud' })).toHaveAttribute(
      'href',
      'https://cloud.example/'
    );
    expect(await within(region).findByRole('region', { name: 'Checklist' })).toBeInTheDocument();
    // Gitea answered a list: it is set up, so Pipeline shows.
    expect(await within(region).findByRole('region', { name: 'Pipeline' })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="overview-layout"]')).toHaveClass('overview-split');
  });

  it('narrower, no rail at all: not hidden, not there', async () => {
    wide(false);
    stubServer({ config: LINKS });
    await renderApp();
    await screen.findByRole('region', { name: 'Needs attention' });
    expect(rail()).toBeNull();
    expect(document.querySelector('[data-slot="overview-layout"]')).not.toHaveClass(
      'overview-split'
    );
  });

  it('the rail is the Overview’s alone: no rail on another page', async () => {
    wide(true);
    await renderApp('/alerts');
    await screen.findByRole('heading', { level: 1, name: 'Alerts' });
    expect(rail()).toBeNull();
  });

  it('the rail keeps the switches in Settings → Appearance; with all off, none', async () => {
    wide(true);
    const off = { visible: false };
    stubServer({ config: { ...LINKS, sections: { quicklaunch: off, todos: off } } });
    await renderApp();
    const region = await screen.findByRole('region', { name: 'Utilities' });
    expect(within(region).queryByRole('region', { name: 'Quick Launch' })).toBeNull();
    expect(within(region).queryByRole('region', { name: 'Checklist' })).toBeNull();
    expect(await within(region).findByRole('region', { name: 'Pipeline' })).toBeInTheDocument();
    cleanup();

    // The clock (#307) is on until switched off, so it goes too.
    stubServer({
      config: {
        ...LINKS,
        showClock: false,
        sections: { quicklaunch: off, todos: off, pipeline: off },
      },
    });
    await renderApp();
    await screen.findByRole('region', { name: 'Needs attention' });
    expect(rail()).toBeNull();
  });

  it('the Launch page holds all three at any width, whatever the Overview’s switches say', async () => {
    wide(false);
    const off = { visible: false };
    stubServer({
      config: { ...LINKS, sections: { quicklaunch: off, pipeline: off, todos: off } },
    });
    await renderApp('/launch');
    await screen.findByRole('heading', { level: 1, name: 'Launch' });
    expect(screen.getByRole('region', { name: 'Quick Launch' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Checklist' })).toBeInTheDocument();
    expect(rail()).toBeNull();
  });

  it('with no links, the Launch page says where to add them', async () => {
    await renderApp('/launch');
    const panel = await screen.findByRole('region', { name: 'Quick Launch' });
    expect(within(panel).getByText('No links yet')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('link', { name: 'Add links' }));
    await waitFor(() => expect(window.location.pathname).toBe('/settings/apps'));
  });

  it('the command palette goes to Launch', async () => {
    await renderApp();
    fireEvent.click(within(banner()).getAllByRole('button', { name: /^Search or jump to/ })[0]);
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'launch' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await current('Launch');
    expect(window.location.pathname).toBe('/launch');
  });
});

// #307: today's extras keep a home (weather and the clock in the rail and on
// the Launch page, the web search on the Launch page), and a show/hide switch
// per Overview section, in the display config the server holds.
describe("today's extras and the Overview's sections", () => {
  const TORONTO = {
    showWeather: true,
    weatherLat: '43.65',
    weatherLon: '-79.38',
    weatherCity: 'Toronto',
    tempUnit: 'C',
  };
  const WEATHER = { current: { temperature_2m: 48.2, weather_code: 3 } };
  const LINKS = { links: { personal: [{ name: 'Nextcloud', url: 'https://cloud.example/' }] } };
  const rail = () => screen.queryByRole('region', { name: 'Utilities' });
  const slot = (name) => document.querySelector(`[data-slot="${name}"]`);

  function wide(on) {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: on && query === RAIL_WIDTH,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }));
  }

  it('from 1440px, the rail has the weather and the clock at its top, when configured', async () => {
    wide(true);
    stubServer({ config: { ...LINKS, ...TORONTO }, answers: { '/api/weather': WEATHER } });
    await renderApp();
    const region = await screen.findByRole('region', { name: 'Utilities' });
    const panel = within(region).getByRole('region', { name: 'Weather and time' });
    expect(region.firstElementChild).toBe(panel);
    await within(panel).findByText('9°C · Overcast');
    expect(within(panel).getByText('Toronto')).toBeInTheDocument();
    expect(panel.querySelector('time')).toHaveAttribute('dateTime');
    expect(server.requests).toContain('/api/weather');
  });

  it('without them configured, neither, and no weather is asked for', async () => {
    wide(true);
    stubServer({ config: { ...LINKS, ...TORONTO, showWeather: false, showClock: false } });
    await renderApp();
    const region = await screen.findByRole('region', { name: 'Utilities' });
    await within(region).findByRole('region', { name: 'Checklist' });
    expect(slot('weather-clock')).toBeNull();
    expect(server.requests).not.toContain('/api/weather');
  });

  it('the clock on its own when no place is set, on until switched off', async () => {
    wide(true);
    stubServer({ config: LINKS });
    await renderApp();
    const region = await screen.findByRole('region', { name: 'Utilities' });
    const panel = within(region).getByRole('region', { name: 'Time' });
    expect(panel.querySelector('[data-slot="weather"]')).toBeNull();
    expect(panel.querySelector('time')).not.toBeNull();
    expect(server.requests).not.toContain('/api/weather');
  });

  it('narrower, the Launch page has them at its top, then the web search', async () => {
    wide(false);
    stubServer({ config: { ...LINKS, ...TORONTO }, answers: { '/api/weather': WEATHER } });
    await renderApp('/launch');
    await screen.findByRole('heading', { level: 1, name: 'Launch' });
    const main = screen.getByRole('main');
    const panel = within(main).getByRole('region', { name: 'Weather and time' });
    await within(panel).findByText('9°C · Overcast');
    const order = [...main.querySelectorAll('[data-slot]')]
      .map((el) => el.dataset.slot)
      .filter((s) => ['weather-clock', 'web-search', 'quick-launch'].includes(s));
    expect(order).toEqual(['weather-clock', 'web-search', 'quick-launch']);
    expect(rail()).toBeNull();
  });

  it('the web search opens the configured engine’s results in a new tab, without an opener', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    stubServer({ config: { searchEngine: 'duckduckgo' } });
    await renderApp('/launch');
    const search = await screen.findByRole('search', { name: 'Web search' });
    const field = within(search).getByRole('searchbox', {
      name: 'Search the web with DuckDuckGo',
    });
    fireEvent.change(field, { target: { value: ' zfs scrub ' } });
    fireEvent.click(within(search).getByRole('button', { name: 'Search' }));
    expect(open).toHaveBeenCalledExactlyOnceWith(
      'https://duckduckgo.com/?q=zfs%20scrub',
      '_blank',
      'noopener,noreferrer'
    );
    expect(field).toHaveValue('');
  });

  it('no web search when Settings → Apps & links switches it off', async () => {
    stubServer({ config: { showSearch: false } });
    await renderApp('/launch');
    await screen.findByRole('region', { name: 'Quick Launch' });
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('a section switched off is gone: the strip, Infrastructure, Services, the rail', async () => {
    wide(true);
    stubServer({ config: LINKS });
    await renderApp();
    await screen.findByRole('region', { name: 'Subsystems' });
    await waitFor(() => expect(slot('overview-infrastructure')).not.toBeNull());
    await waitFor(() => expect(slot('overview-services')).not.toBeNull());
    expect(rail()).not.toBeNull();
    cleanup();

    stubServer({
      config: {
        ...LINKS,
        overviewSections: { strip: false, infrastructure: false, services: false, rail: false },
      },
    });
    await renderApp();
    await screen.findByRole('region', { name: 'Needs attention' });
    // The sections are drawn under the status, so they would be by now.
    await waitFor(() => expect(document.querySelector('.dashboard-content')).not.toBeNull());
    expect(screen.queryByRole('region', { name: 'Subsystems' })).toBeNull();
    expect(slot('overview-infrastructure')).toBeNull();
    expect(slot('overview-services')).toBeNull();
    expect(rail()).toBeNull();
    // The Launch page keeps the rail's panels.
    fireEvent.click(within(sidebar()).getByRole('link', { name: 'Launch' }));
    expect(await screen.findByRole('region', { name: 'Quick Launch' })).toBeInTheDocument();
  });

  it('the attention panel can’t be hidden, whatever the config says', async () => {
    stubServer({ config: { overviewSections: { attention: false, strip: false } } });
    await renderApp();
    expect(await screen.findByRole('region', { name: 'Needs attention' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Subsystems' })).toBeNull();
  });

  it('the switches come from the server’s config, so another device’s choice applies here', async () => {
    stubServer({ serverConfig: { overviewSections: { strip: false } } });
    await renderApp();
    await screen.findByRole('region', { name: 'Needs attention' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Subsystems' })).toBeNull());
  });

  it('a saved showTodos (the old Widgets switch, never read) hides no Checklist; a load alone sends nothing', async () => {
    wide(true);
    stubServer({ config: LINKS, serverConfig: { ...LINKS, title: 'Lab', showTodos: false } });
    await renderApp();
    const region = await screen.findByRole('region', { name: 'Utilities' });
    expect(await within(region).findByRole('region', { name: 'Checklist' })).toBeInTheDocument();
    // Every copy is read without the dead key (#306: dropDeadKeys in the
    // persistence too), so dropping it is no edit: nothing is sent for it,
    // and the next save made for something else goes without it. (Another
    // test's debounced save may land here: only this config is titled Lab.)
    await new Promise((r) => setTimeout(r, 2500));
    expect(server.saves.filter((c) => c.title === 'Lab')).toEqual([]);
    const stored = JSON.parse(localStorage.getItem('jaghelm-config'));
    expect(stored).not.toHaveProperty('showTodos');
    expect(stored.sections?.todos).toBeUndefined();
    expect(within(region).getByRole('region', { name: 'Checklist' })).toBeInTheDocument();
  });

  it("drops it and the old board's layout and panels, keeping an explicit visible (#306)", async () => {
    stubServer({
      config: {
        showTodos: false,
        showCronJobs: false,
        sections: { todos: { visible: true, title: 'Tasks' }, ups: { visible: false } },
        gridLayout: { lg: [], md: [], sm: [] },
        gridColumns: 12,
      },
    });
    await renderApp();
    await screen.findByRole('region', { name: 'Needs attention' });
    const stored = () => JSON.parse(localStorage.getItem('jaghelm-config'));
    await waitFor(() => expect(stored()).not.toHaveProperty('showTodos'));
    for (const key of ['gridLayout', 'gridColumns', 'showCronJobs'])
      expect(stored()).not.toHaveProperty(key);
    expect(stored().sections).toEqual({ todos: { visible: true } });
  });
});
