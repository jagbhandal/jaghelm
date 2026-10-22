import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent, act, cleanup } from '@testing-library/react';
import App from './App.jsx';
import { SIDEBAR_PREF } from './shell/ShellChrome.jsx';
import { FIRST_RUN, INCIDENT, HEALTHY } from './testing/statusFixtures.js';

// The app shell (#296): the header, the grouped sidebar and the phone's tabs
// around every page, the URL as the page, and every old view still reachable.
// jsdom applies no media queries, so the sidebar (from 768px) and the tabs
// (below it) are both in the page here; each test looks in the one it means.

let server;

function respond(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
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

function stubServer({ tabs = [GRAFANA, KUMA], status = INCIDENT, serverTabs } = {}) {
  server = { requests: [], status, statusDown: false, statusPending: false };
  localStorage.setItem('jaghelm-config', JSON.stringify({ tabs }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const path = String(url).split('?')[0];
      server.requests.push(path);
      if (path === '/api/auth/check') return respond({ authRequired: true, authenticated: true });
      if (path === '/api/status') {
        if (server.statusDown) return Promise.reject(new TypeError('Failed to fetch'));
        if (server.statusPending) return new Promise(() => {});
        return respond(server.status);
      }
      if (path === '/api/display-config') return respond(serverTabs ? { tabs: serverTabs } : {});
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
    expect(
      within(groups[0])
        .getAllByRole('link')
        .map((l) => l.getAttribute('href'))
    ).toEqual(['/', '/alerts']);
    expect(
      within(groups[1])
        .getAllByRole('link')
        .map((l) => l.getAttribute('href'))
    ).toEqual(['/apps/grafana', '/apps/kuma', '/settings/tabs']);
    expect(
      within(groups[2])
        .getAllByRole('link')
        .map((l) => l.getAttribute('href'))
    ).toEqual(['/settings']);
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

    fireEvent.click(entry('Settings'));
    await current('Settings');
    expect(
      await screen.findByRole('navigation', { name: 'Settings sections' })
    ).toBeInTheDocument();

    fireEvent.click(entry('Add app'));
    expect(await screen.findByRole('heading', { name: /Tabs/ })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/settings/tabs');

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
  it('Overview, Alerts and More; More holds the apps and Settings', async () => {
    await renderApp();
    const tabs = within(tabsBar());
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
        name: 'Settings',
      })
    );
    expect(
      await screen.findByRole('navigation', { name: 'Settings sections' })
    ).toBeInTheDocument();
  });
});

describe('the URL is the page', () => {
  it('a deep link (a reload, a chunk reload after a deploy) opens its page', async () => {
    await renderApp('/settings/tabs');
    expect(await screen.findByRole('heading', { name: /Tabs/ })).toBeInTheDocument();
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

  it('a page not built yet, or no page at all, lands on the Overview', async () => {
    for (const path of ['/launch', '/services', '/infrastructure', '/nope']) {
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
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    fireEvent.click(within(nav).getByText('Tabs'));
    await waitFor(() => expect(window.location.pathname).toBe('/settings/tabs'));
  });

  it('names the browser tab after the page', async () => {
    await renderApp('/alerts');
    await waitFor(() => expect(document.title).toBe('Alerts — JagHelm'));
  });
});

// The top of the Overview (#297): the status model, as the Alerts page draws
// it, over today's board, from the header's own poll.
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
    // A row links to its entity's place on the board (#309 brings URLs). This
    // board's /api/services lists nothing, so it draws no service card and no
    // UPS panel; the Infrastructure section (#299) draws every node the model
    // has, so the nodes' rows lead to their cards, and Immich's to its node's.
    expect(rows.map((r) => r.querySelector('[data-slot="issue-row"]').tagName)).toEqual([
      'A',
      'DIV',
      'A',
      'A',
    ]);
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '#entity-nodes/vm103');
    expect(within(rows[3]).getByRole('link')).toHaveAttribute('href', '#entity-nodes/pi');
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
      expect(labels[n].endsWith(`, ${s.detail}`)).toBe(true);
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
