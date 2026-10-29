import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { PHONE_WIDTH } from '@ui/app-shell';
import { forgetAnswers } from './hooks/useData.js';
import { demoResponse } from '../server/demo.js';

// The Alerts page (#314), the whole web app at /alerts, every request answered
// by the demo server (its status, and its alert history, server/demoEvents.js,
// paged and filtered by the live store). Two views on the page: Active (the
// status model's issues, worst first) and History (/api/events, newest first,
// by day: when, the entity, the change, why, and what the phones got). One set
// of filters over both, in the address: severity, kind and a search, so Back
// undoes one and a link opens the page filtered. Active filters in the
// client; History asks the server. A failed read says so, never "nothing
// happened". The phone's tab (below 768px) is the shared phone screen.

let events; // each /api/events query, as an object
let eventsAnswer; // null: the demo's; else (url) => Response

function serveDemo(scenario = 'incident') {
  events = [];
  eventsAnswer = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init = {}) => {
      const url = new URL(String(input), 'http://demo.test');
      const method = (init.method || 'GET').toUpperCase();
      if (url.pathname === '/api/events') {
        events.push(Object.fromEntries(url.searchParams));
        if (eventsAnswer) return eventsAnswer(url);
      }
      const out = demoResponse({
        method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        scenario,
      });
      if (out.location) return new Response(null, { status: 302 });
      return new Response(JSON.stringify(out.body ?? {}), {
        status: out.status,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
}

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
  // The clock at noon, so the newest events (minutes old) are "Today".
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(Date.parse('2026-10-23T12:00:00'));
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('jaghelm-token', 'tok');
  forgetAnswers();
  windowOf({ phone: false });
  serveDemo();
});

afterEach(() => vi.useRealTimers());

async function openAlerts(path = '/alerts') {
  window.history.replaceState(null, '', path);
  await act(async () => {
    render(<App />);
  });
  await screen.findByRole('heading', { level: 1, name: 'Alerts' });
}

const active = () => screen.findByRole('region', { name: /^(Needs attention|Status)$/ });
const history = () => screen.getByRole('region', { name: 'History' });
const historyRows = () =>
  [...history().querySelectorAll('[data-slot="event-row"]')].map((row) => row.textContent);
const activeRows = async () =>
  within(await active())
    .queryAllByRole('listitem')
    .map((li) => li.textContent);
const loaded = () =>
  waitFor(() =>
    expect(history().querySelectorAll('[data-slot="event-row"]').length).toBeGreaterThan(0)
  );

describe('the Alerts page, Active and History (#314)', () => {
  it('shows what is wrong now, worst first, and what happened, newest first, by day', async () => {
    await openAlerts();
    expect(await activeRows()).toEqual([
      expect.stringContaining('Jellyfin'),
      expect.stringContaining('nightly-backup'),
      // The storage node's drive that keeps remapping sectors (#727).
      expect.stringContaining('Storage'),
    ]);
    await loaded();
    expect(events[0]).toEqual({ limit: '50' });
    const region = history();
    expect(within(region).getByRole('heading', { level: 2, name: 'History' })).toBeInTheDocument();
    expect(within(region).getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('Today');
    // The newest: Jellyfin going down, with why and what the phones got, at its time.
    const newest = within(region).getAllByRole('link')[0];
    expect(newest).toHaveAccessibleName(
      expect.stringMatching(/^Jellyfin, Critical, Down, Service · apps, \d\d:\d\d$/)
    );
    expect(newest).toHaveAccessibleDescription('Kuma: down Sent to 2 phones');
    // A recovery: the change from and to.
    expect(within(region).getAllByRole('link', { name: /^Gitea, Info, Down → Up/ })).toHaveLength(
      1
    );
    // The other kinds of event, each with its words.
    const text = region.textContent;
    for (const said of [
      'On battery → On mains',
      'Not sent: off in phone settings',
      'Push not set up',
      'Up → Down',
    ]) {
      expect(text).toContain(said);
    }
  });

  it('a row opens its entity over the page; one the model no longer has says "No longer monitored"', async () => {
    const user = userEvent.setup();
    await openAlerts('/alerts?severity=critical');
    await loaded();
    const plex = within(history()).getAllByRole('link', {
      name: /^Plex, Critical, Down, Service · apps · No longer monitored/,
    })[0];
    expect(plex).toHaveAttribute('href', '/alerts?severity=critical&entity=services/apps:plex');
    await user.click(plex);
    expect(window.location.search).toBe('?severity=critical&entity=services/apps:plex');
    expect(await screen.findByRole('dialog', { name: 'No longer monitored' })).toBeInTheDocument();
  });

  it("a recovered source's row opens a drawer that says it resolved, not that it is gone", async () => {
    const user = userEvent.setup();
    await openAlerts('/alerts?kind=sources');
    await loaded();
    const back = within(history()).getByRole('link', { name: /^Prometheus, Info, Down → Up/ });
    expect(back).toHaveAccessibleName(
      /^Prometheus, Info, Down → Up, Monitoring source, \d\d:\d\d$/
    );
    await user.click(back);
    expect(window.location.search).toBe('?kind=sources&entity=sources/prometheus');
    const drawer = await screen.findByRole('dialog', { name: 'Incident' });
    expect(drawer).toHaveTextContent('This incident has resolved.');
    expect(drawer).not.toHaveTextContent('No longer monitored');
  });

  it('severity: Active keeps the issues of that severity, History asks the server; Back undoes it', async () => {
    const user = userEvent.setup();
    await openAlerts();
    await loaded();
    await user.click(screen.getByRole('radio', { name: 'Warning' }));
    expect(window.location.search).toBe('?severity=warning');
    const panel = await active();
    expect(panel).toHaveTextContent('Showing warning alerts only');
    expect(await activeRows()).toEqual([expect.stringContaining('drive sdb has 8 reallocated sectors')]);
    await waitFor(() => expect(events.at(-1)).toEqual({ severity: 'warning', limit: '50' }));
    await waitFor(() =>
      expect(historyRows()).toEqual([
        expect.stringContaining('drive sdb has 8 reallocated sectors'),
        expect.stringContaining('Storage'),
        expect.stringContaining('Monitoring source'),
        expect.stringContaining('db-dump'),
      ])
    );
    await user.click(screen.getByRole('radio', { name: 'Critical' }));
    expect(await activeRows()).toHaveLength(2);
    // Back: warning again, then everything.
    await act(async () => window.history.back());
    await waitFor(() => expect(window.location.search).toBe('?severity=warning'));
    expect(screen.getByRole('radio', { name: 'Warning' })).toHaveAttribute('aria-checked', 'true');
    await act(async () => window.history.back());
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(await activeRows()).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
  });

  it('kind: Active keeps that subsystem, History asks the server for that kind', async () => {
    const user = userEvent.setup();
    await openAlerts();
    await loaded();
    await user.click(screen.getByRole('combobox', { name: 'Kind' }));
    await user.click(await screen.findByRole('option', { name: 'Backups' }));
    await waitFor(() => expect(window.location.search).toBe('?kind=backups'));
    expect(await activeRows()).toEqual([expect.stringContaining('nightly-backup')]);
    await waitFor(() => expect(events.at(-1)).toEqual({ kind: 'backups', limit: '50' }));
    await waitFor(() => expect(historyRows()).toEqual([expect.stringContaining('nightly-backup')]));
  });

  it('search: once typing stops, both views narrow to it; Clear filters shows everything again', async () => {
    const user = userEvent.setup();
    await openAlerts();
    await loaded();
    await user.type(screen.getByRole('searchbox', { name: 'Search alerts' }), 'gitea');
    await waitFor(() => expect(window.location.search).toBe('?q=gitea'));
    expect(await active()).toHaveTextContent('No active alerts matching “gitea”');
    await waitFor(() => expect(events.at(-1)).toEqual({ q: 'gitea', limit: '50' }));
    await waitFor(() => expect(historyRows()).toHaveLength(2));
    expect(historyRows().every((row) => row.includes('Gitea'))).toBe(true);
    // The whole search is one entry: Back leaves it at once, the box emptied.
    await act(async () => window.history.back());
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(screen.getByRole('searchbox', { name: 'Search alerts' })).toHaveValue('');
    expect(await activeRows()).toHaveLength(3);
    // Clear filters: everything again.
    await user.type(screen.getByRole('searchbox', { name: 'Search alerts' }), 'plex');
    await waitFor(() => expect(window.location.search).toBe('?q=plex'));
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(screen.getByRole('searchbox', { name: 'Search alerts' })).toHaveValue('');
  });

  it('a link opens the page filtered: the controls say so, and History asks with them', async () => {
    await openAlerts('/alerts?severity=warning&kind=nodes&q=storage');
    expect(screen.getByRole('radio', { name: 'Warning' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('combobox', { name: 'Kind' })).toHaveTextContent('Nodes');
    expect(screen.getByRole('searchbox', { name: 'Search alerts' })).toHaveValue('storage');
    await loaded();
    expect(events[0]).toEqual({ severity: 'warning', kind: 'nodes', q: 'storage', limit: '50' });
    expect(historyRows()).toEqual([
      expect.stringContaining('drive sdb has 8 reallocated sectors'),
      expect.stringContaining('Disk 91 %'),
    ]);
  });

  it('nothing in 30 days says so; filtered to nothing, says what it looked for', async () => {
    serveDemo('healthy');
    eventsAnswer = () => new Response(JSON.stringify({ events: [], next: null }), { status: 200 });
    await openAlerts();
    await waitFor(() =>
      expect(history()).toHaveTextContent(
        'No alerts in the last 30 days. Every change is recorded here, whether or not push is set up.'
      )
    );
    expect(await active()).toHaveTextContent('All systems normal');
  });

  it('a failed read of the history says so, never "nothing happened"; Retry reads it', async () => {
    const user = userEvent.setup();
    eventsAnswer = () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 });
    await openAlerts('/alerts?q=zzz');
    await waitFor(() => expect(history()).toHaveTextContent('History unavailable'));
    expect(history()).not.toHaveTextContent('No alerts');
    eventsAnswer = null;
    await user.click(within(history()).getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(history()).toHaveTextContent('No alerts matching “zzz” in the last 30 days.')
    );
  });
});

describe('the Alerts page from the command palette (#314, #315)', () => {
  it('⌘K → Alerts opens the page, both views; its filters work; an issue opened there keeps them', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/');
    await act(async () => {
      render(<App />);
    });
    await screen.findByRole('navigation', { name: 'Main' });
    await user.keyboard('{Control>}k{/Control}');
    const field = await screen.findByRole('combobox', { name: 'Search' });
    await user.type(field, 'alerts');
    await user.click(screen.getByRole('option', { name: /^Alerts, Page/ }));
    await waitFor(() => expect(window.location.pathname).toBe('/alerts'));
    await loaded();
    await user.click(screen.getByRole('radio', { name: 'Critical' }));
    expect(window.location.search).toBe('?severity=critical');
    await waitFor(() => expect(events.at(-1)).toEqual({ severity: 'critical', limit: '50' }));
    // An issue from the palette opens over the filtered page, the filters kept.
    await user.keyboard('{Control>}k{/Control}');
    await user.type(await screen.findByRole('combobox', { name: 'Search' }), 'jellyfin');
    await user.click(screen.getAllByRole('option', { name: /^Jellyfin, Issue/ })[0]);
    await waitFor(() =>
      expect(window.location.search).toBe('?severity=critical&entity=services/apps:jellyfin')
    );
    expect(await screen.findByRole('dialog', { name: 'Jellyfin' })).toBeInTheDocument();
  });
});

describe("the phone's Alerts tab on the web (#314)", () => {
  beforeEach(() => windowOf({ phone: true }));

  it('shows Active and History from the same filters, kept in the address', async () => {
    const user = userEvent.setup();
    await openAlerts('/alerts');
    const tab = screen.getByRole('heading', { level: 1, name: 'Alerts' }).parentElement;
    await waitFor(() =>
      expect(
        within(tab)
          .getByRole('region', { name: 'History' })
          .querySelectorAll('[data-slot="event-row"]').length
      ).toBeGreaterThan(0)
    );
    expect(within(tab).getByRole('region', { name: 'Active' })).toHaveTextContent('Jellyfin');
    await user.click(within(tab).getByRole('button', { name: 'Warning' }));
    expect(window.location.search).toBe('?severity=warning');
    await waitFor(() => expect(events.at(-1)).toEqual({ severity: 'warning', limit: '50' }));
    expect(within(within(tab).getByRole('region', { name: 'Active' })).getAllByRole('listitem')).toHaveLength(1);
    await act(async () => window.history.back());
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(within(tab).getByRole('region', { name: 'Active' })).toHaveTextContent('Jellyfin');
  });

  it('kind and search narrow both views; a link opens the tab filtered', async () => {
    const user = userEvent.setup();
    await openAlerts('/alerts');
    const tab = screen.getByRole('heading', { level: 1, name: 'Alerts' }).parentElement;
    // The severity chips, then the search with the kind beside it: two lines at 390px.
    expect(within(tab).getByRole('group', { name: 'Severity' })).toBeInTheDocument();
    expect(within(tab).queryByRole('group', { name: 'Kind' })).toBeNull();
    const kind = within(tab).getByRole('combobox', { name: 'Kind' });
    expect(kind.parentElement).toBe(
      within(tab)
        .getByRole('searchbox', { name: 'Search alerts' })
        .closest('[data-slot="alert-search"]')
    );
    await user.click(kind);
    await user.click(await screen.findByRole('option', { name: 'Backups' }));
    await waitFor(() => expect(window.location.search).toBe('?kind=backups'));
    const activeRegion = within(tab).getByRole('region', { name: 'Active' });
    expect(within(activeRegion).getAllByRole('listitem')).toHaveLength(1);
    expect(activeRegion).toHaveTextContent('nightly-backup');
    await waitFor(() => expect(events.at(-1)).toEqual({ kind: 'backups', limit: '50' }));
    await user.click(kind);
    await user.click(await screen.findByRole('option', { name: 'Everything' }));
    await waitFor(() => expect(window.location.search).toBe(''));
    await user.type(within(tab).getByRole('searchbox', { name: 'Search alerts' }), 'gitea');
    await waitFor(() => expect(window.location.search).toBe('?q=gitea'));
    await waitFor(() => expect(events.at(-1)).toEqual({ q: 'gitea', limit: '50' }));
    const historyRegion = within(tab).getByRole('region', { name: 'History' });
    await waitFor(() =>
      expect(historyRegion.querySelectorAll('[data-slot="event-row"]')).toHaveLength(2)
    );
    expect(within(tab).getByText('No active alerts matching “gitea”')).toBeInTheDocument();
  });
});
