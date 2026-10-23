import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PhoneDetail from './PhoneDetail.jsx';
import { PhonePlatform } from '../phone/platform.js';
import { forgetAnswers } from '../hooks/useData.js';
import { forgetOldHistoryServers } from './detail/useHistory.js';
import { demoResponse } from '../../server/demo.js';
import { runScenario } from '../../server/testing/statusScenarios.js';

// The phone's sheet on the web (#602): a node's and a container's sheet draw
// the drawer's history (HistoryCharts) under the status box, with the range
// switch's segments 44px targets; a sheet covered by another reads none, and
// an entity with nothing to chart (a monitor with no container, an alert)
// draws none.

const NOW = Date.UTC(2026, 9, 23, 12, 0, 30);
const RUN = runScenario('incident', { now: NOW });
const STATUS = JSON.parse(JSON.stringify(RUN.status));
const SERVICES = JSON.parse(JSON.stringify(RUN.cycle.caches.getCached('services')));

/** The status poll stand-in: no answers in these tests. */
const UPDATED = Object.freeze({ subscribe: () => () => {}, get: () => NOW });

const dataOf = (servicesBody = SERVICES) => ({
  status: STATUS,
  reach: 'ok',
  servicesBody,
  updated: UPDATED,
  loading: false,
  error: null,
  freshness: { stale: false },
});

let asked;

function respond(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  forgetAnswers();
  forgetOldHistoryServers();
  asked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const u = new URL(String(url), 'http://localhost');
      asked.push(u.pathname + u.search);
      const out = demoResponse({
        path: u.pathname,
        query: Object.fromEntries(u.searchParams),
        now: NOW,
      });
      return respond(out.body, out.status);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sheet(screenName, params, { data = dataOf(), top = true } = {}) {
  const nav = { push: vi.fn(), pop: vi.fn() };
  return render(
    <PhonePlatform value={{ openTarget: vi.fn() }}>
      <PhoneDetail screen={screenName} data={data} nav={nav} params={params} top={top} />
    </PhonePlatform>
  );
}

/** Every read a render asked for has gone out (the reads start in effects). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const historyReads = () => asked.filter((a) => a.startsWith('/api/history'));
const region = () => screen.getByRole('region', { name: 'History' });

describe('the phone’s sheet draws the drawer’s history (#602)', () => {
  it('a node: Usage and Temperature under the status box, before the meters, in one request', async () => {
    sheet('node', { nodeKey: 'edge' });
    const usage = await screen.findByRole('img', { name: 'Usage, last hour' });
    expect(screen.getByRole('img', { name: 'Temperature, last hour' })).toBeInTheDocument();
    expect(
      usage.closest('[data-slot="chart"]').querySelectorAll('[data-slot="chart-line"]')
    ).toHaveLength(3);
    expect(historyReads()).toEqual([
      '/api/history?series=node.cpu%2Cnode.memory%2Cnode.disk%2Cnode.temperature&range=1h&entity=edge',
    ]);
    // The drawer's order: the status box, then the history, then the meters.
    const status = document.querySelector('[data-slot="detail-status"]');
    const meters = document.querySelector('[data-slot="node-meters"]');
    expect(
      status.compareDocumentPosition(region()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      region().compareDocumentPosition(meters) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // The range switch: 44px targets for a thumb.
    const radios = within(region()).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['1 h', '24 h', '7 d']);
    for (const radio of radios) expect(radio).toHaveClass('h-11');
  });

  it('a container: its CPU and Memory; 7 d reads the week', async () => {
    const user = userEvent.setup();
    sheet('serviceDetail', { uid: 'apps:jellyfin' });
    await screen.findByRole('img', { name: 'CPU, last hour' });
    expect(screen.getByRole('img', { name: 'Memory, last hour' })).toBeInTheDocument();
    expect(historyReads()).toEqual([
      '/api/history?series=container.cpu%2Ccontainer.memory&range=1h&entity=apps%2Fjellyfin',
    ]);
    await user.click(within(region()).getByRole('radio', { name: '7 d' }));
    expect(await screen.findByRole('img', { name: 'CPU, last 7 days' })).toBeInTheDocument();
    expect(historyReads().at(-1)).toMatch(/range=7d&entity=apps%2Fjellyfin$/);
  });

  it('a monitor with no container, and an alert: no history, and none asked', async () => {
    const services = JSON.parse(JSON.stringify(SERVICES));
    services.nodes.apps.services.find((s) => s.uid === 'apps:gitea').container = null;
    sheet('serviceDetail', { uid: 'apps:gitea' }, { data: dataOf(services) });
    expect(await screen.findByRole('heading', { name: 'Gitea' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'History' })).toBeNull();
    const id = STATUS.issues[0].id;
    sheet('incident', { id });
    await settle();
    expect(screen.queryByRole('region', { name: 'History' })).toBeNull();
    expect(historyReads()).toEqual([]);
  });

  it('a sheet covered by another asks nothing until it is on top', async () => {
    const view = sheet('node', { nodeKey: 'storage' }, { top: false });
    await settle();
    expect(historyReads()).toEqual([]);
    view.rerender(
      <PhonePlatform value={{ openTarget: vi.fn() }}>
        <PhoneDetail
          screen="node"
          data={dataOf()}
          nav={{ push: vi.fn(), pop: vi.fn() }}
          params={{ nodeKey: 'storage' }}
          top
        />
      </PhonePlatform>
    );
    await screen.findByRole('img', { name: 'Usage, last hour' });
    expect(historyReads()).toHaveLength(1);
  });
});
