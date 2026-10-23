import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const { openTarget } = vi.hoisted(() => ({ openTarget: vi.fn() }));
vi.mock('../open.js', () => ({ openTarget }));

import Alerts from '@shared/phone/views/Alerts.jsx';
import { STALE, UPS_ONLINE, boardOf, inputs, monitored, node } from '../testing/board.js';
import {
  eventsAnswer,
  eventsQueryOf,
  isEvents,
  respondJson,
} from '@shared/testing/eventsServer.js';
import { demoServices, demoStatus } from '../../../server/demoFixtures.js';
import { forgetOldServers } from '@shared/shell/useAlertHistory.js';

// The Alerts tab draws History from /api/events (#314): every test here gets
// the demo's alert history (server/demoEvents.js) unless it answers otherwise,
// at a clock fixed at noon so "Today" is today.
const NOW = Date.parse('2026-10-23T12:00:00');
let asked;
let answerEvents;

beforeEach(() => {
  forgetOldServers();
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  asked = [];
  answerEvents = (url) => eventsAnswer(url, { now: NOW });
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      if (!isEvents(url)) return Promise.reject(new Error(`unexpected ${url}`));
      asked.push(eventsQueryOf(url));
      return Promise.resolve(answerEvents(url));
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const DATA = boardOf(
  inputs({
    nodes: {
      'vm-101': node(
        {},
        {
          display_name: 'VM 101',
          services: [
            monitored('vm-101:gitea', 'down', {
              display_name: 'Gitea',
              uptime24: 0.42,
              url: 'http://h/gitea',
            }),
          ],
        }
      ),
    },
    ups: UPS_ONLINE,
  })
);

describe('Alerts', () => {
  it('pins the active incident at top under Active heading', () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    expect(screen.getByRole('heading', { name: 'Active' })).toBeInTheDocument();
    expect(screen.getAllByText('Gitea').length).toBeGreaterThanOrEqual(1);
  });

  it('the gear is enabled and pushes the notificationSettings screen on tap', () => {
    const push = vi.fn();
    render(<Alerts data={DATA} nav={{ push }} />);
    const gear = screen.getByRole('button', { name: /notification settings/i });
    expect(gear).not.toBeDisabled();
    fireEvent.click(gear);
    expect(push).toHaveBeenCalledWith('notificationSettings');
  });

  it('tapping an incident pushes its detail', () => {
    const push = vi.fn();
    render(<Alerts data={DATA} nav={{ push }} />);
    // Active row has "(active)" appended; click it to trigger nav
    fireEvent.click(screen.getByRole('button', { name: 'Gitea, Service · vm-101 (active)' }));
    expect(push).toHaveBeenCalledWith('incident', { id: 'services/vm-101:gitea' });
  });

  // Active cards must show cause (Bug #8): the model's reason.
  it("active incident row shows where it is and the model's reason", () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    const activeRow = screen.getByRole('button', { name: /Gitea.*active/i });
    expect(activeRow.querySelector('.alert-row__node').textContent).toBe('Service · vm-101');
    expect(activeRow.querySelector('.alert-row__cause').textContent).toBe('Kuma: down');
  });

  it('shows an empty state when nothing is wrong', () => {
    const calm = boardOf(
      inputs({ nodes: { 'vm-101': node({}, { display_name: 'VM 101' }) }, ups: UPS_ONLINE })
    );
    render(<Alerts data={calm} nav={{ push: vi.fn() }} />);
    expect(screen.getByText(/All clear/i)).toBeInTheDocument();
  });

  it('an empty board (#449) says "Nothing monitored yet", never all clear', () => {
    const empty = boardOf(
      inputs({
        nodes: {},
        services: { nodes: {}, overallHealth: 'unknown', sources: { prometheus: { ok: true } } },
        ups: {
          status: null,
          charge: null,
          runtime: null,
          load: null,
          ok: true,
          configured: false,
          model: null,
        },
      })
    );
    render(<Alerts data={empty} nav={{ push: vi.fn() }} />);
    expect(screen.getByText('Nothing monitored yet')).toBeInTheDocument();
    expect(screen.queryByText(/All clear/i)).toBeNull();
  });

  // A status past its TTL (a 503 after one), or no answer for over 72 s: no
  // fetch error, only a stale status. As on the web after #480.
  const OUT_OF_DATE = { ...STALE, cause: "JagHelm's status is out of date", reach: 'expired' };

  it('a stale status (#480) keeps its rows as last known, steel, under "No signal · why"', () => {
    const push = vi.fn();
    const { container } = render(
      <Alerts data={{ ...DATA, freshness: OUT_OF_DATE }} nav={{ push }} />
    );
    expect(screen.getByText("No signal · JagHelm's status is out of date")).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Last known 3 min ago' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Active' })).toBeNull();
    // The row stays, with its words and reason, but drawn no signal, never active red.
    const row = screen.getByRole('button', { name: 'Gitea, Service · vm-101 (last known)' });
    expect(row.dataset.state).toBe('unknown');
    expect(row.className).toMatch(/alert-row--stale/);
    expect(container.querySelector('.alert-row--active')).toBeNull();
    expect(row.querySelector('.alert-row__cause').textContent).toBe('Kuma: down');
    expect(screen.queryByRole('button', { name: /\(active\)/ })).toBeNull();
    expect(screen.queryByText(/All clear/i)).toBeNull();
    // It still opens the issue.
    fireEvent.click(row);
    expect(push).toHaveBeenCalledWith('incident', { id: 'services/vm-101:gitea' });
  });

  it('a stale status with no issues says no signal and why, never all clear', () => {
    const calm = boardOf(
      inputs({ nodes: { 'vm-101': node({}, { display_name: 'VM 101' }) }, ups: UPS_ONLINE })
    );
    render(<Alerts data={{ ...calm, freshness: OUT_OF_DATE }} nav={{ push: vi.fn() }} />);
    expect(screen.getByText("No signal · JagHelm's status is out of date")).toBeInTheDocument();
    expect(screen.queryByText(/All clear/i)).toBeNull();
  });

  it('a fresh status draws its issues as active, red', () => {
    const { container } = render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    expect(container.querySelector('.alert-row--active')).not.toBeNull();
    expect(container.querySelector('.alert-row--stale')).toBeNull();
    expect(container.querySelector('.alerts-stale')).toBeNull();
  });

  it('shows error banner and NOT all-clear when backend unreachable (has prior data)', () => {
    const errData = { ...DATA, error: new Error('network error'), freshness: STALE };
    render(<Alerts data={errData} nav={{ push: vi.fn() }} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't reach JagHelm/);
    expect(screen.queryByText(/All clear/i)).toBeNull();
    // The banner says "showing last known data", so the rows are there, steel;
    // the banner already says why, so no second note.
    expect(screen.getByRole('button', { name: /Gitea.*\(last known\)/ })).toBeInTheDocument();
    expect(document.querySelector('.alerts-stale')).toBeNull();
  });

  it('shows error banner without "showing last known data" when no prior data', () => {
    const errNoData = {
      status: null,
      servicesBody: null,
      loading: false,
      error: new Error('fail'),
      freshness: STALE,
    };
    render(<Alerts data={errNoData} nav={{ push: vi.fn() }} />);
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toBe("Couldn't reach JagHelm");
    expect(banner.textContent).not.toMatch(/last known/i);
  });

  it('shows loading state and NOT all-clear when loading with no data', () => {
    const loading = { status: null, servicesBody: null, loading: true, error: null };
    render(<Alerts data={loading} nav={{ push: vi.fn() }} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(/All clear/i)).toBeNull();
  });

  it('gear button does not have disabled attribute (always active)', () => {
    render(<Alerts data={DATA} nav={{ push: vi.fn() }} />);
    const gear = screen.getByRole('button', { name: /notification settings/i });
    expect(gear).not.toHaveAttribute('disabled');
  });
});

// #314: History, from /api/events, in the app's own rows (no redesign before
// #326), and the filters over both views, kept in the screen.
describe('Alerts: History and the filters (#314)', () => {
  const DEMO = {
    status: JSON.parse(JSON.stringify(demoStatus({ scenario: 'incident', now: NOW }))),
    servicesBody: demoServices({ scenario: 'incident', now: NOW }),
    reach: 'ok',
    freshness: { stale: false },
    loading: false,
    error: null,
  };
  const historyRows = (container) => [
    ...container.querySelectorAll('.alert-row:not(.alert-row--active):not(.alert-row--stale)'),
  ];
  const loaded = (container) =>
    waitFor(() => expect(historyRows(container).length).toBeGreaterThan(0));

  it('shows what happened under History, newest first, by day: the change, where, when, what the phones got, why', async () => {
    const push = vi.fn();
    const { container } = render(<Alerts data={DEMO} nav={{ push }} />);
    expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument();
    await loaded(container);
    expect(asked[0]).toEqual({ limit: '50' });
    expect(screen.getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('Today');
    const [newest] = historyRows(container);
    expect(newest.querySelector('.alert-row__title').textContent).toBe('Jellyfin · Down');
    expect(newest.querySelector('.alert-row__node').textContent).toMatch(
      /^Service · apps · \d\d:\d\d · Sent to 2 phones$/
    );
    expect(newest.querySelector('.alert-row__cause').textContent).toBe('Kuma: down');
    // An event and an active issue are both listed: History is what happened.
    expect(container.querySelector('.alert-row--active')).toHaveTextContent('Jellyfin');
    // Push off still records every event: History works without it.
    expect(container.textContent).toContain('Push not set up');
  });

  it("each history row opens the detail its entity's kind opens, as everywhere (entityRoute)", async () => {
    const push = vi.fn();
    const { container } = render(<Alerts data={DEMO} nav={{ push }} />);
    await loaded(container);
    const open = (name) => {
      fireEvent.click(screen.getAllByRole('button', { name })[0]);
      return push.mock.calls.at(-1);
    };
    // A service, healthy now: its Service detail, never "this incident has resolved".
    expect(open(/^Gitea, Down → Up, Service · apps, /)).toEqual([
      'serviceDetail',
      { uid: 'apps:gitea' },
    ]);
    // A service the model no longer has: its Service detail, which says it is no longer reported.
    expect(open(/^Plex, Down, Service · apps · No longer monitored/)).toEqual([
      'serviceDetail',
      { uid: 'apps:plex' },
    ]);
    // A node: its Node detail.
    expect(open(/^Storage, Warning, Node · storage, /)).toEqual(['node', { nodeKey: 'storage' }]);
    // Anything else: the incident's, by its id.
    expect(open(/^Example UPS 1500VA, On battery, Power, /)).toEqual([
      'incident',
      { id: 'power/ups' },
    ]);
    expect(open(/^Prometheus, Up → Down, Monitoring source, /)).toEqual([
      'incident',
      { id: 'sources/prometheus' },
    ]);
  });

  it('severity: Active and History both narrow to it (History asks the server)', async () => {
    const { container } = render(<Alerts data={DEMO} nav={{ push: vi.fn() }} />);
    await loaded(container);
    const severity = screen.getByRole('group', { name: 'Severity' });
    fireEvent.click(within(severity).getByRole('button', { name: 'Warning' }));
    expect(within(severity).getByRole('button', { name: 'Warning' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByText('No active warning alerts')).toBeInTheDocument();
    expect(container.querySelector('.alert-row--active')).toBeNull();
    await waitFor(() => expect(asked.at(-1)).toEqual({ severity: 'warning', limit: '50' }));
    await waitFor(() =>
      expect(
        historyRows(container).map((r) => r.querySelector('.alert-row__title').textContent)
      ).toEqual(['Storage · Warning', 'Prometheus · Up → Down', 'db-dump · Overdue'])
    );
    fireEvent.click(within(severity).getByRole('button', { name: 'Critical' }));
    expect(container.querySelectorAll('.alert-row--active')).toHaveLength(2);
  });

  it('kind: Active keeps that subsystem, History asks for that kind', async () => {
    const { container } = render(<Alerts data={DEMO} nav={{ push: vi.fn() }} />);
    await loaded(container);
    const kinds = screen.getByRole('group', { name: 'Kind' });
    fireEvent.click(within(kinds).getByRole('button', { name: 'Backups' }));
    const active = [...container.querySelectorAll('.alert-row--active')];
    expect(active.map((r) => r.querySelector('.alert-row__title').textContent)).toEqual([
      'nightly-backup',
    ]);
    await waitFor(() => expect(asked.at(-1)).toEqual({ kind: 'backups', limit: '50' }));
    await waitFor(() => expect(historyRows(container)).toHaveLength(1));
    expect(historyRows(container)[0]).toHaveTextContent('nightly-backup · Failed');
  });

  it('search: once typing stops, both views narrow to it', async () => {
    const { container } = render(<Alerts data={DEMO} nav={{ push: vi.fn() }} />);
    await loaded(container);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search alerts' }), {
      target: { value: 'gitea' },
    });
    await waitFor(() => expect(asked.at(-1)).toEqual({ q: 'gitea', limit: '50' }));
    expect(screen.getByText('No active alerts matching “gitea”')).toBeInTheDocument();
    await waitFor(() => expect(historyRows(container)).toHaveLength(2));
    expect(historyRows(container).every((r) => r.textContent.includes('Gitea'))).toBe(true);
  });

  it('a server older than /api/events: Active only, one line that History needs a newer server, no error, not asked again', async () => {
    answerEvents = () => respondJson({ error: 'Endpoint not found' }, 404);
    const listeners = new Set();
    const updated = {
      get: () => NOW,
      subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    };
    const { container } = render(<Alerts data={{ ...DEMO, updated }} nav={{ push: vi.fn() }} />);
    expect(await screen.findByText('History needs a newer JagHelm server.')).toBeInTheDocument();
    expect(container.querySelectorAll('.alert-row--active')).toHaveLength(2);
    expect(historyRows(container)).toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Couldn't/)).toBeNull();
    // The next polls ask nothing more of it, nor does a filter changed: no "Loading".
    act(() => listeners.forEach((fn) => fn()));
    act(() => listeners.forEach((fn) => fn()));
    const severity = screen.getByRole('group', { name: 'Severity' });
    fireEvent.click(within(severity).getByRole('button', { name: 'Critical' }));
    expect(screen.queryByText('Loading the history…')).toBeNull();
    expect(screen.getByText('History needs a newer JagHelm server.')).toBeInTheDocument();
    expect(asked).toHaveLength(1);
  });

  it('a failed read says so, never "no alerts"; Retry reads it', async () => {
    answerEvents = () => respondJson({ error: 'unavailable' }, 503);
    const { container } = render(<Alerts data={DEMO} nav={{ push: vi.fn() }} />);
    expect(await screen.findByText(/^Couldn't load the history/)).toBeInTheDocument();
    expect(screen.queryByText(/No alerts in the last 30 days/)).toBeNull();
    answerEvents = (url) => eventsAnswer(url, { now: NOW });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await loaded(container);
  });

  it('nothing in 30 days says so', async () => {
    answerEvents = () => respondJson({ events: [], next: null });
    render(<Alerts data={DEMO} nav={{ push: vi.fn() }} />);
    expect(
      await screen.findByText(
        'No alerts in the last 30 days. Every change is recorded here, whether or not push is set up.'
      )
    ).toBeInTheDocument();
  });

  it('Show older loads the next page', async () => {
    answerEvents = (url) => eventsAnswer(url.replace('limit=50', 'limit=4'), { now: NOW });
    const { container } = render(<Alerts data={DEMO} nav={{ push: vi.fn() }} />);
    await waitFor(() => expect(historyRows(container)).toHaveLength(4));
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    await waitFor(() => expect(historyRows(container)).toHaveLength(8));
    expect(asked.at(-1)).toMatchObject({ before: expect.any(String) });
  });
});
