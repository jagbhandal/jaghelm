import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PhoneDetail from './PhoneDetail.jsx';
import { PhonePlatform } from '../phone/platform.js';
import { EntityDetail } from './detail/EntityDetail.jsx';
import { entityDetail } from './detail/entityDetail.js';
import { HistoryCharts } from './detail/HistoryCharts.jsx';
import { forgetAnswers } from '../hooks/useData.js';
import { forgetOldHistoryServers } from './detail/useHistory.js';
import { demoResponse } from '../../server/demo.js';
import { runScenario } from '../../server/testing/statusScenarios.js';
import { hdd, nasWith, nasWithoutDrives, nvme } from '../testing/driveFixtures.js';

// Drive health in a node's detail (#728): the Drives block directly under the
// status box on the desktop's drawer and the phone's sheet, the drive's reason
// in the status box, the drives on the temperature chart, and an install with
// no drive data exactly as it was. The demo's storage node has the drives.

const NOW = Date.UTC(2026, 9, 23, 12, 0, 30);
const RUN = runScenario('incident', { now: NOW });
const STATUS = JSON.parse(JSON.stringify(RUN.status));
const SERVICES = JSON.parse(JSON.stringify(RUN.cycle.caches.getCached('services')));
const UPDATED = Object.freeze({ subscribe: () => () => {}, get: () => NOW });

let asked;
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
      return Promise.resolve({
        ok: out.status < 300,
        status: out.status,
        headers: { get: () => null },
        json: () => Promise.resolve(out.body),
      });
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const historyReads = () => asked.filter((a) => a.startsWith('/api/history'));
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const drawer = (status, id, props = {}) =>
  render(
    <EntityDetail
      view={entityDetail({ status, reach: 'ok', id, at: NOW })}
      slots={{ chart: () => <div data-testid="chart" /> }}
      {...props}
    />
  );

describe('the desktop drawer', () => {
  it('draws the Drives block directly under the status box, before the history', () => {
    drawer(STATUS, 'nodes/storage');
    const drives = screen.getByRole('region', { name: 'Drives' });
    expect(before(document.querySelector('[data-slot="detail-status"]'), drives)).toBe(true);
    expect(before(drives, screen.getByTestId('chart'))).toBe(true);
    expect(within(drives).getAllByRole('button').length).toBe(4);
    expect(within(drives).getByText('Sleeping drives show their last reading')).toBeInTheDocument();
  });

  it('a node with no drive data: no block, no heading, nothing in its place', () => {
    drawer(STATUS, 'nodes/edge');
    expect(screen.queryByRole('region', { name: 'Drives' })).toBeNull();
    expect(document.querySelector('[data-slot="detail-drives"]')).toBeNull();
    expect(screen.queryByText(/Sleeping drives/)).toBeNull();
  });

  it("an install with no drive data at all is the node's detail as it was", () => {
    const { status } = nasWithoutDrives();
    const view = entityDetail({ status, reach: 'ok', id: 'nodes/nas', at: NOW });
    expect(view.drives).toBeNull();
    expect(view.chart).toEqual({ kind: 'node', entity: 'nas' });
  });

  it("the status box carries the drive's reason from the model, the services line untouched", () => {
    const { status } = nasWith([hdd('sda'), hdd('sdb', { smartPassed: false }), hdd('sdc')]);
    drawer(status, 'nodes/nas');
    const box = document.querySelector('[data-slot="detail-status"]');
    expect(box).toHaveAttribute('data-state', 'crit');
    expect(box).toHaveTextContent('Critical');
    expect(box).toHaveTextContent('drive sdb failed its health check');
    expect(box).toHaveTextContent('1 / 1 service up');
  });

  it('a link names a drive: that row is open and marked', () => {
    const { status } = nasWith([hdd('sda'), hdd('sdb', { smartPassed: false })]);
    drawer(status, 'nodes/nas', { drive: 'sdb' });
    expect(document.querySelector('[data-drive="sdb"]')).toHaveAttribute('data-highlighted');
    expect(screen.getByRole('button', { name: /^sdb, Critical/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('is not drawn for any other kind of entity', () => {
    drawer(STATUS, `services/${STATUS.entities.find((e) => e.kind === 'service').id.slice(9)}`);
    expect(screen.queryByRole('region', { name: 'Drives' })).toBeNull();
  });
});

describe('the phone sheet', () => {
  const sheet = (nodeKey, data) =>
    render(
      <PhonePlatform value={{ openTarget: vi.fn() }}>
        <PhoneDetail
          screen="node"
          nav={{ push: vi.fn(), pop: vi.fn() }}
          params={{ nodeKey }}
          data={{
            status: STATUS,
            reach: 'ok',
            servicesBody: SERVICES,
            updated: UPDATED,
            loading: false,
            error: null,
            freshness: { stale: false },
            ...data,
          }}
        />
      </PhonePlatform>
    );

  it('draws the Drives block under the status box and before the history', async () => {
    sheet('storage');
    const drives = await screen.findByRole('region', { name: 'Drives' });
    expect(before(document.querySelector('[data-slot="detail-status"]'), drives)).toBe(true);
    expect(before(drives, await screen.findByRole('region', { name: 'History' }))).toBe(true);
  });

  it('a node with no drive data draws none and reads four series, as before', async () => {
    sheet('edge');
    await screen.findByRole('region', { name: 'History' });
    expect(screen.queryByRole('region', { name: 'Drives' })).toBeNull();
    expect(historyReads()).toEqual([
      '/api/history?series=node.cpu%2Cnode.memory%2Cnode.disk%2Cnode.temperature&range=1h&entity=edge',
    ]);
  });
});

describe('the temperature chart', () => {
  const target = (drives) => ({ kind: 'node', entity: 'storage', drives });
  const DRIVES = ['nvme0', 'sda', 'sdb', 'sdc'].map((device) => ({ device, temperature: 40 }));
  const legend = () =>
    [...document.querySelectorAll('[data-chart="temperature"] [data-slot="chart-legend"] li')].map(
      (li) => li.textContent
    );

  it('a node with drives reads five series and draws a line each after its sensor, in order', async () => {
    render(<HistoryCharts target={target(DRIVES)} updated={UPDATED} />);
    await screen.findByRole('img', { name: 'Temperature, last hour' });
    expect(historyReads()).toEqual([
      '/api/history?series=node.cpu%2Cnode.memory%2Cnode.disk%2Cnode.temperature%2Cdrive.temperature&range=1h&entity=storage',
    ]);
    const chart = screen
      .getByRole('img', { name: 'Temperature, last hour' })
      .closest('[data-slot="chart"]');
    expect(chart.querySelectorAll('[data-slot="chart-line"]')).toHaveLength(5);
    expect(legend()).toEqual(['Temperature', 'nvme0', 'sda', 'sdb', 'sdc']);
    // The slots in order after the sensor's: rose, lime, plum, orange.
    expect(
      [...chart.querySelectorAll('[data-slot="chart-line"]')].map((l) =>
        [...l.classList].find((c) => c.startsWith('stroke-series'))
      )
    ).toEqual([
      'stroke-series-1',
      'stroke-series-2',
      'stroke-series-3',
      'stroke-series-4',
      'stroke-series-5',
    ]);
    expect(screen.getByText('Drives update about every 10 minutes')).toBeInTheDocument();
  });

  it('a node without drive data keeps the chart it had: one line, no legend, no note', async () => {
    render(<HistoryCharts target={{ kind: 'node', entity: 'storage' }} updated={UPDATED} />);
    await screen.findByRole('img', { name: 'Temperature, last hour' });
    expect(historyReads()[0]).toContain(
      'series=node.cpu%2Cnode.memory%2Cnode.disk%2Cnode.temperature&'
    );
    expect(historyReads()[0]).not.toContain('drive');
    const chart = screen
      .getByRole('img', { name: 'Temperature, last hour' })
      .closest('[data-slot="chart"]');
    expect(chart.querySelectorAll('[data-slot="chart-line"]')).toHaveLength(1);
    expect(screen.queryByText(/Drives update/)).toBeNull();
    await settle();
  });

  it('the phone sheet and the drawer ask the same', async () => {
    render(<HistoryCharts target={target(DRIVES)} updated={UPDATED} size="touch" />);
    await screen.findByRole('img', { name: 'Temperature, last hour' });
    expect(historyReads()[0]).toContain('drive.temperature');
  });
});

describe('what the Drives block never does', () => {
  it('the drawer shows no serial number, whatever a record carries', () => {
    const { status } = nasWith([nvme('nvme0'), hdd('sda', { serial_number: 'SN-SECRET-123' })]);
    drawer(status, 'nodes/nas');
    expect(document.body.innerHTML).not.toMatch(/SN-SECRET/);
  });

  it('opens and closes a row from the keyboard in the drawer', async () => {
    const user = userEvent.setup();
    drawer(STATUS, 'nodes/storage');
    const sda = screen.getByRole('button', { name: /^sda, Healthy/ });
    sda.focus();
    await user.keyboard('{Enter}');
    expect(sda).toHaveAttribute('aria-expanded', 'true');
  });
});
