import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent, act, cleanup } from '@testing-library/react';
import App from './App.jsx';
import { SIDEBAR_PREF } from './shell/ShellChrome.jsx';
import { INCIDENT, HEALTHY } from './testing/statusFixtures.js';

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

const GRAFANA = { id: 'grafana', label: 'Grafana', type: 'iframe', url: 'https://grafana.example/' };
const KUMA = { id: 'kuma', label: 'Uptime Kuma', type: 'iframe', url: 'https://kuma.example/' };

function stubServer({ tabs = [GRAFANA, KUMA], status = INCIDENT, serverTabs } = {}) {
  server = { requests: [], status, statusDown: false };
  localStorage.setItem('jaghelm-config', JSON.stringify({ tabs }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const path = String(url).split('?')[0];
      server.requests.push(path);
      if (path === '/api/auth/check') return respond({ authRequired: true, authenticated: true });
      if (path === '/api/status') {
        if (server.statusDown) return Promise.reject(new TypeError('Failed to fetch'));
        return respond(server.status);
      }
      if (path === '/api/display-config')
        return respond(serverTabs ? { tabs: serverTabs } : {});
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

  it('turns steel "No signal" when the backend stops answering', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await renderApp();
      await within(banner()).findByRole('link', { name: /^Critical/ });
      server.statusDown = true;
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      expect(
        within(banner()).getByRole('link', { name: "No signal: Can't reach JagHelm" })
      ).toBeInTheDocument();
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
    expect(within(groups[0]).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual([
      '/',
      '/alerts',
    ]);
    expect(within(groups[1]).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual([
      '/apps/grafana',
      '/apps/kuma',
      '/settings/tabs',
    ]);
    expect(within(groups[2]).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual([
      '/settings',
    ]);
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
    expect(await screen.findByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();

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
    expect(await screen.findByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
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
});
