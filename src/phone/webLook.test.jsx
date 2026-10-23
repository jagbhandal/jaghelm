/*
 * The phone screens' web look (#303): the web's build draws each screen from
 * src/ui's parts (its __ANDROID_LOOK__ is false), none of the Android app's
 * class names, and the screens behave as they do on Android. The Android
 * look's own tests are in mobile/src/, in the Android build.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Overview from './views/Overview.jsx';
import Services from './views/Services.jsx';
import Infra from './views/Infra.jsx';
import Alerts from './views/Alerts.jsx';
import ServiceDetail from './views/ServiceDetail.jsx';
import NodeDetail from './views/NodeDetail.jsx';
import IncidentDetail from './views/IncidentDetail.jsx';
import StatusBanner from './components/StatusBanner.jsx';
import { PhonePlatform } from './platform.js';
import { SheetContext } from './sheet.js';
import { sinceLine } from './data/detail.js';
import { formatClock } from './data/derive.js';
import { runScenario } from '../../server/testing/statusScenarios.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const RUN = runScenario('incident', { now: NOW });
const STATUS = JSON.parse(JSON.stringify(RUN.status));
const SERVICES = JSON.parse(JSON.stringify(RUN.cycle.caches.getCached('services')));
const DATA = {
  status: STATUS,
  reach: 'ok',
  servicesBody: SERVICES,
  ups: null,
  loading: false,
  error: null,
  freshness: { stale: false },
};
// The Android app's class names: none is drawn on the web.
const ANDROID = /mobile-view|svc-row|svc-list|node-card__|detail-head|alert-row|back-header|chip/;

function draw(Screen, { data = DATA, params = {}, openTarget = vi.fn(), sheet = null } = {}) {
  const nav = { push: vi.fn(), pop: vi.fn() };
  const view = render(
    <PhonePlatform value={{ openTarget }}>
      <SheetContext.Provider value={sheet}>
        <Screen data={data} nav={nav} params={params} />
      </SheetContext.Provider>
    </PhonePlatform>
  );
  return { nav, openTarget, ...view };
}

describe("the phone screens' web look", () => {
  it('draws each screen and detail from src/ui, with none of the Android class names', () => {
    expect(__ANDROID_LOOK__).toBe(false);
    for (const [Screen, params] of [
      [Overview, {}],
      [Services, {}],
      [Infra, {}],
      [Alerts, {}],
      [ServiceDetail, { uid: 'apps:jellyfin' }],
      [NodeDetail, { nodeKey: 'storage' }],
      [IncidentDetail, { id: 'backups/storage:nightly-backup' }],
    ]) {
      const { container, unmount } = draw(Screen, { params });
      const classes = [...container.querySelectorAll('[class]')].map(
        (el) => el.className.baseVal ?? el.className
      );
      expect(
        classes.filter((c) => ANDROID.test(c)),
        Screen.name
      ).toEqual([]);
      expect(container.querySelector('[data-slot]'), Screen.name).not.toBeNull();
      unmount();
    }
  });

  it('Overview: a row opens what the Android row opens, by the same route', async () => {
    const { nav } = draw(Overview);
    const user = userEvent.setup();
    const issues = screen.getByRole('region', { name: 'Needs attention' });
    await user.click(within(issues).getByRole('button', { name: /^Jellyfin, Down/ }));
    expect(nav.push).toHaveBeenLastCalledWith('serviceDetail', { uid: 'apps:jellyfin' });
    const services = screen.getByRole('region', { name: 'Services' });
    await user.click(within(services).getByRole('button', { name: /^Gitea, / }));
    expect(nav.push).toHaveBeenLastCalledWith('serviceDetail', { uid: 'apps:gitea' });
    const nodes = screen.getByRole('region', { name: 'Infrastructure' });
    await user.click(within(nodes).getByRole('button', { name: /^Storage, / }));
    expect(nav.push).toHaveBeenLastCalledWith('node', { nodeKey: 'storage' });
  });

  it('Services: the search and the chips narrow the list, as on Android', async () => {
    draw(Services);
    const user = userEvent.setup();
    const rows = () => screen.getAllByRole('button', { name: /, (Up|Down)/ });
    const all = rows().length;
    await user.click(screen.getByRole('button', { name: /^Down/ }));
    expect(rows().map((r) => r.getAttribute('aria-label'))).toEqual(['Jellyfin, Down']);
    await user.click(screen.getByRole('button', { name: /^All/ }));
    expect(rows()).toHaveLength(all);
    await user.type(screen.getByRole('searchbox', { name: 'Search services' }), 'graf');
    expect(rows().map((r) => r.getAttribute('aria-label'))).toEqual(['Grafana, Up']);
  });

  it('Infrastructure: a card per node, the whole card opening it', async () => {
    const { nav } = draw(Infra);
    const storage = screen.getByRole('article', { name: 'Storage' });
    await userEvent.setup().click(within(storage).getByRole('button', { name: 'Storage' }));
    expect(nav.push).toHaveBeenCalledWith('node', { nodeKey: 'storage' });
  });

  it('Alerts: the rows under Active, each opening its incident, and no gear on the web', async () => {
    const { nav } = draw(Alerts);
    expect(screen.queryByRole('button', { name: 'Notification settings' })).toBeNull();
    const active = screen.getByRole('region', { name: 'Active' });
    await userEvent.setup().click(within(active).getByRole('button', { name: /^nightly-backup/ }));
    expect(nav.push).toHaveBeenCalledWith('incident', { id: 'backups/storage:nightly-backup' });
    expect(screen.getByText('No earlier alerts this session.')).toBeInTheDocument();
  });

  it('Alerts, stale: no signal and why, the rows last known', () => {
    draw(Alerts, {
      data: {
        ...DATA,
        freshness: { stale: true, cause: "Can't reach JagHelm", lastKnown: 'last known 3 min ago' },
      },
    });
    expect(screen.getByText("Can't reach JagHelm")).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Last known' })).toHaveTextContent(
      'Last known 3 min ago'
    );
    for (const row of screen.getAllByRole('button', { name: /, / }))
      expect(row).toHaveAttribute('data-state', 'unknown');
  });

  it('a detail: Back, its kind, its title naming the sheet, the facts, and Open', async () => {
    const card = SERVICES.nodes.apps.services.find((s) => s.uid === 'apps:grafana');
    card.url = 'https://grafana.example/';
    const { nav, openTarget } = draw(ServiceDetail, {
      params: { uid: 'apps:grafana' },
      sheet: { titleId: 'sheet-0-title' },
    });
    const user = userEvent.setup();
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Grafana' })).toHaveAttribute(
      'id',
      'sheet-0-title'
    );
    expect(document.querySelector('[data-slot="fact-list"]')).not.toBeNull();
    expect(screen.getByText('Latency')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Grafana' }));
    expect(openTarget).toHaveBeenCalledWith({
      kind: 'service',
      uid: 'apps:grafana',
      url: 'https://grafana.example/',
    });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(nav.pop).toHaveBeenCalled();
    delete card.url;
  });

  it("a down service's detail says the model's reason, and no container numbers", () => {
    draw(ServiceDetail, { params: { uid: 'apps:jellyfin' } });
    const status = document.querySelector('[data-slot="detail-status"]');
    expect(status).toHaveAttribute('data-state', 'crit');
    expect(status).toHaveTextContent('DownKuma: down');
    expect(screen.queryByText('CPU')).toBeNull();
  });

  it("a tapped push's event the status no longer has: its event, severity and time", () => {
    draw(IncidentDetail, {
      params: {
        id: 'nope',
        type: 'host_unreachable',
        severity: 'critical',
        ts: NOW,
        node: 'vm103',
      },
    });
    expect(screen.getByRole('heading', { level: 2, name: 'Host unreachable' })).toBeInTheDocument();
    expect(screen.getByText('vm103')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="detail-status"]')).toHaveTextContent('CRITICAL');
    expect(screen.getByText(/Host unreachable · \d\d:\d\d/)).toBeInTheDocument();
  });

  it('Overview: the status card is the word alone, 22/28 at 800 with a 16px lamp, the sentence under it', () => {
    expect(STATUS.overall.state).toBe('crit');
    draw(Overview);
    const header = document.querySelector('[data-slot="attention-panel-header"]');
    const heading = within(header).getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent(/^Critical$/);
    expect(heading).toHaveClass('text-title-lg');
    expect(header.querySelector('[data-slot="status-lamp"]')).toHaveAttribute('width', '16');
    expect(header).toHaveTextContent(STATUS.overall.sentence);
  });

  it("a detail's title is 22/28 at 800, and its status box's lamp 16px", () => {
    draw(ServiceDetail, { params: { uid: 'apps:jellyfin' } });
    expect(screen.getByRole('heading', { level: 2, name: 'Jellyfin' })).toHaveClass(
      'text-title-lg'
    );
    const box = document.querySelector('[data-slot="detail-status"]');
    expect(box.querySelector('[data-slot="status-lamp"]')).toHaveAttribute('width', '16');
  });

  it("the status box says how long it has been so: the model's since, against the status's time", () => {
    const since = STATUS.entities.find((e) => e.id === 'services/apps:jellyfin').since;
    const updated = { subscribe: () => () => {}, get: () => since + 4 * 60_000 };
    const line = () => document.querySelector('[data-slot="detail-since"]');
    const { unmount } = draw(ServiceDetail, {
      data: { ...DATA, updated },
      params: { uid: 'apps:jellyfin' },
    });
    expect(line()).toHaveTextContent(`for 4 min · since ${formatClock(since)}`);
    unmount();
    // Stale, the state drawn is no signal, not the one it dates: none.
    const stale = { stale: true, cause: "Can't reach JagHelm" };
    draw(NodeDetail, {
      data: { ...DATA, updated, freshness: stale },
      params: { nodeKey: 'storage' },
    }).unmount();
    expect(line()).toBeNull();
    // No status time, none: never a made-up age.
    draw(IncidentDetail, { params: { id: 'backups/storage:nightly-backup' } }).unmount();
    expect(line()).toBeNull();
    const backup = STATUS.issues.find((i) => i.id === 'backups/storage:nightly-backup').since;
    draw(IncidentDetail, {
      data: { ...DATA, updated: { ...updated, get: () => backup + 3 * 3_600_000 } },
      params: { id: 'backups/storage:nightly-backup' },
    });
    expect(line()).toHaveTextContent(`for 3 h · since ${formatClock(backup)}`);
    // Past a day, how long alone.
    expect(sinceLine(0, 3 * 86_400_000 + 1, { stale: false })).toBe('for 3 d');
    expect(sinceLine(undefined, 1000, { stale: false })).toBeNull();
  });

  describe('a detail drawn before its sources answered (a reload with the sheet open)', () => {
    const WAITING = { ...DATA, status: null, reach: 'loading', servicesBody: null, loading: true };
    for (const [Screen, params, kind, gone, missing] of [
      [ServiceDetail, { uid: 'apps:jellyfin' }, 'Service', 'Jellyfin', /no longer reported/],
      [NodeDetail, { nodeKey: 'storage' }, 'Node', 'Storage', /no longer reported/],
      [
        IncidentDetail,
        { id: 'backups/storage:nightly-backup' },
        'Alert',
        'nightly-backup',
        /has resolved/,
      ],
    ]) {
      it(`${kind}: "Loading…" until the status and the cards are in, then the thing; gone only once they said so`, () => {
        const sheet = { titleId: 'sheet-0-title' };
        const open = (data, p = params) => draw(Screen, { data, params: p, sheet });
        const said = () => document.body.textContent;
        let view = open(WAITING);
        expect(screen.getByRole('heading', { level: 2, name: 'Loading…' })).toHaveAttribute(
          'id',
          'sheet-0-title'
        );
        expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
        expect(screen.getByText(kind)).toBeInTheDocument();
        expect(said()).not.toMatch(missing);
        view.unmount();
        // The status in, the cards still on their way: still waiting.
        view = open({ ...WAITING, status: STATUS, reach: 'ok' });
        expect(screen.getByRole('heading', { level: 2, name: 'Loading…' })).toBeInTheDocument();
        view.unmount();
        // The cards in, the status still on its way: still waiting.
        view = open({ ...WAITING, servicesBody: SERVICES, loading: false });
        expect(screen.getByRole('heading', { level: 2, name: 'Loading…' })).toBeInTheDocument();
        view.unmount();
        // Both in: the thing.
        view = open(DATA);
        expect(screen.getByRole('heading', { level: 2, name: gone })).toBeInTheDocument();
        expect(document.querySelector('[aria-busy="true"]')).toBeNull();
        view.unmount();
        // They answered without it: gone.
        const none = { uid: 'apps:nope', nodeKey: 'nope', id: 'nope' };
        open(DATA, none);
        expect(said()).toMatch(missing);
      });
    }

    it("a service's with no cards to read says the read failed, never that it's gone", () => {
      draw(ServiceDetail, {
        data: { ...DATA, servicesBody: null, loading: false, error: 'HTTP 502' },
        params: { uid: 'apps:jellyfin' },
      });
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't reach JagHelm");
      expect(document.body.textContent).not.toMatch(/no longer reported/);
    });

    it("a node's or an alert's with no status to read: No signal and why", () => {
      const down = {
        ...DATA,
        status: null,
        reach: 'down',
        freshness: { stale: true, cause: "Can't reach JagHelm" },
      };
      for (const [Screen, params] of [
        [NodeDetail, { nodeKey: 'storage' }],
        [IncidentDetail, { id: 'backups/storage:nightly-backup' }],
      ]) {
        const { unmount } = draw(Screen, { data: down, params });
        expect(document.body).toHaveTextContent("No signalCan't reach JagHelm");
        expect(document.body.textContent).not.toMatch(/no longer reported|has resolved/);
        unmount();
      }
    });
  });

  it('StatusBanner: a placeholder while loading, then a Banner when the read fails', () => {
    const { rerender } = render(<StatusBanner loading hasData={false} />);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    rerender(<StatusBanner loading={false} error="HTTP 502" hasData />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't reach JagHelm");
    expect(screen.getByRole('alert')).toHaveTextContent('Showing last known data');
    rerender(<StatusBanner loading={false} error={null} hasData />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
