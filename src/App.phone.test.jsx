import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { PHONE_WIDTH } from '@ui/app-shell';
import { SHEETS } from './shell/phoneNav.js';
import { nasDiskIncident } from './testing/statusFixtures.js';

// The web on a phone (#303, spec §7, §8 "Phone width"): below 768px the app
// draws the shared phone screens (src/phone/, PhoneView.jsx) in place of the
// desktop Overview and today's board, under the five tabs. Services and
// Infrastructure have pages of their own there. A row opens its detail as a
// sheet over the tab, a history entry of its own, which Back closes, focus
// going back to the row. The phone reads the cards and the UPS, nothing else.
// e2e/phone.spec.mjs checks the same in a real browser.

let requests;
const BOARD = nasDiskIncident();

function respond(body, status = 200, headers = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

/** The window as a phone's: PHONE_WIDTH matches, nothing else does. */
function phoneWindow() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    media: query,
    matches: query === PHONE_WIDTH,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('jaghelm-token', 'tok');
  localStorage.setItem('jaghelm-config', JSON.stringify({ tabs: [] }));
  requests = [];
  phoneWindow();
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const path = String(url).split('?')[0];
      requests.push(path);
      if (path === '/api/auth/check') return respond({ authRequired: true, authenticated: true });
      if (path === '/api/status') return respond(BOARD.status);
      if (path === '/api/services') return respond(BOARD.services);
      if (path === '/api/display-config') return respond({}, 200, { ETag: '"v1"' });
      return respond({});
    })
  );
});

const tabs = () => within(screen.getByRole('navigation', { name: 'Tabs' }));
const view = () => document.querySelector('[data-slot="phone-view"]');

async function renderApp(path = '/') {
  window.history.replaceState(null, '', path);
  render(<App />);
  await waitFor(() => expect(view()).not.toBeNull());
}

/** The Overview's list called `name` (Services, Infrastructure), once drawn. */
const list = async (name) => within(await screen.findByRole('region', { name }));

describe('the web on a phone (#303)', () => {
  it('draws the phone screens, not the desktop Overview or today’s board, reading only the cards beside the status', async () => {
    await renderApp();
    const status = await screen.findByRole('region', { name: 'Needs attention' });
    // The word alone, as the Phone board's card says it.
    expect(within(status).getByRole('heading', { level: 2 })).toHaveTextContent(/^Critical$/);
    await list('Services');
    await list('Infrastructure');
    expect(document.querySelector('[data-slot="overview-status"]')).toBeNull();
    expect(document.querySelector('.helmgrid')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    for (const path of ['/api/services', '/api/status']) expect(requests).toContain(path);
    // The model carries the UPS's readings (#549): no /api/ups either.
    for (const path of ['/api/ups', '/api/integrations', '/api/cron/status', '/api/gitea/activity'])
      expect(requests, path).not.toContain(path);
  });

  it('has the five tabs, Services and Infrastructure each a page of its own', async () => {
    await renderApp();
    const links = tabs().getAllByRole('link');
    expect(links.map((l) => l.getAttribute('aria-label'))).toEqual([
      'Overview',
      'Services',
      'Infrastructure',
      expect.stringMatching(/^Alerts/),
    ]);
    expect(tabs().getByRole('button', { name: 'More' })).toBeInTheDocument();
    const user = userEvent.setup();

    await user.click(tabs().getByRole('link', { name: 'Services' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Services' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/services');
    expect(tabs().getByRole('link', { name: 'Services' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('button', { name: /^Jellyfin, / })).toBeInTheDocument();

    await user.click(tabs().getByRole('link', { name: 'Infrastructure' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Infrastructure' })
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/infrastructure');
    expect(await screen.findByRole('article', { name: 'Storage' })).toHaveAttribute(
      'data-state',
      'warn'
    );

    await user.click(tabs().getByRole('link', { name: /^Alerts/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Alerts' })).toBeInTheDocument();
    // No gear: Notification settings are the Android app's own.
    expect(screen.queryByRole('button', { name: 'Notification settings' })).toBeNull();
  });

  it('opens a row’s detail as a sheet, a history entry of its own; Back closes it and focus is back on the row', async () => {
    await renderApp();
    const user = userEvent.setup();
    const row = (await list('Infrastructure')).getByRole('button', { name: /^Storage, / });
    await user.click(row);
    const sheet = await screen.findByRole('dialog', { name: 'Storage' });
    expect(sheet).toHaveAttribute('data-slot', 'phone-sheet');
    expect(window.history.state[SHEETS]).toEqual([
      { screen: 'node', params: { nodeKey: 'storage' } },
    ]);
    expect(window.location.pathname).toBe('/');

    // A service of the node opens over it: a second sheet, a second entry.
    const hosted = within(sheet).getByRole('button', { name: /^Backrest, / });
    await user.click(hosted);
    expect(await screen.findByRole('dialog', { name: 'Backrest' })).toBeInTheDocument();
    expect(window.history.state[SHEETS]).toHaveLength(2);

    window.history.back();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Backrest' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Storage' })).toBeInTheDocument();
    await waitFor(() => expect(hosted).toHaveFocus());

    // The sheet's own Back goes back too.
    await user.click(within(sheet).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(row).toHaveFocus());
  });

  it('draws the detail a history entry holds: a reload, or Back into it', async () => {
    window.history.replaceState(
      { [SHEETS]: [{ screen: 'serviceDetail', params: { uid: 'apps:jellyfin' } }] },
      '',
      '/'
    );
    render(<App />);
    const sheet = await screen.findByRole('dialog', { name: 'Jellyfin' });
    expect(within(sheet).getByText('Service')).toBeInTheDocument();
  });

  it('from 768px, /services and /infrastructure are still the Overview’s, as before', async () => {
    window.matchMedia.mockImplementation((query) => ({
      media: query,
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    window.history.replaceState(null, '', '/services');
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main' });
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(view()).toBeNull();
  });
});
