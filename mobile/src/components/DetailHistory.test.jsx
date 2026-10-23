import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { DetailHistory } from './DetailHistory.jsx';
import { historyTargetOf } from '../data/historyTarget.js';
import { forgetAnswers } from '@shared/hooks/useData.js';
import { forgetOldHistoryServers } from '@shared/shell/detail/useHistory.js';
import { UPS_ONLINE, boardOf, card, inputs, monitored, node } from '../testing/board.js';

// The Android app's detail history (#602): a node's sheet and a container's
// draw the web drawer's charts (HistoryCharts) in a root of the new UI, the
// range switch sized for a thumb. A server from before #311, whose
// /api/history is the ring buffer's, gets no charts and no error, and isn't
// asked again this session.

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const MINUTE = 60_000;

const BOARD = boardOf(
  inputs({
    nodes: {
      'vm-101': node(
        { cpu: '45', memPercent: '31', diskPercent: '55', temp: '48' },
        {
          display_name: 'VM 101',
          services: [
            monitored('vm-101:gitea', 'up', { display_name: 'Gitea' }),
            { ...card('vm-101:kuma-only'), container: null, display_name: 'Router' },
          ],
        }
      ),
    },
    ups: UPS_ONLINE,
  })
);

/** /api/history's answer since #311: every series asked, three readings for `entity`. */
function historyOf(url) {
  const u = new URL(url, 'http://localhost');
  const entity = u.searchParams.get('entity');
  return {
    range: u.searchParams.get('range'),
    entity,
    series: u.searchParams
      .get('series')
      .split(',')
      .map((series) => ({
        series,
        unit: series.endsWith('temperature') ? '°C' : '%',
        startMs: NOW - 2 * MINUTE,
        stepMs: MINUTE,
        count: 3,
        ok: true,
        lines: [{ entity, values: [20, 30, 25] }],
      })),
  };
}

/** GET /api/history before #311: the ring buffer's readings, whatever is asked. */
const RING_BUFFER = { 'vm-101:cpu': [4, 5, 6], 'vm-101:mem': [40, 41, 42] };

let asked;
let answer;

beforeEach(() => {
  forgetAnswers();
  forgetOldHistoryServers();
  asked = [];
  answer = historyOf;
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      asked.push(String(url));
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve(answer(String(url))),
      });
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

/** The status poll stand-in: `tick()` is an answer of it. */
function poll() {
  const listeners = new Set();
  return {
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    tick: () => act(() => listeners.forEach((fn) => fn())),
  };
}

describe('what an Android detail charts (#602)', () => {
  it("the drawer's rule: a node by its key, a service by its container, else nothing", () => {
    const of = (screen, params) => historyTargetOf({ screen, params, data: BOARD });
    expect(of('node', { nodeKey: 'vm-101' })).toEqual({ kind: 'node', entity: 'vm-101' });
    expect(of('serviceDetail', { uid: 'vm-101:gitea' })).toEqual({
      kind: 'container',
      entity: 'vm-101/gitea',
    });
    expect(of('serviceDetail', { uid: 'vm-101:kuma-only' })).toBeNull();
    expect(of('node', { nodeKey: 'gone' })).toBeNull();
    expect(of('incident', { id: 'power/ups' })).toBeNull();
    expect(of('overview', {})).toBeNull();
    expect(historyTargetOf({ screen: 'node', params: { nodeKey: 'vm-101' }, data: {} })).toBeNull();
  });
});

describe('DetailHistory (#602)', () => {
  it("a node: the drawer's Usage and Temperature in a root of the new UI, a 44px range switch", async () => {
    const { container } = render(
      <DetailHistory target={{ kind: 'node', entity: 'vm-101' }} updated={poll()} />
    );
    expect(await screen.findByRole('img', { name: 'Usage, last hour' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Temperature, last hour' })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('jh-ui');
    expect(screen.getByRole('region', { name: 'History' })).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) expect(radio).toHaveClass('h-11');
    expect(asked).toEqual([
      '/api/history?series=node.cpu%2Cnode.memory%2Cnode.disk%2Cnode.temperature&range=1h&entity=vm-101',
    ]);
  });

  it('a container: its CPU and Memory', async () => {
    render(
      <DetailHistory target={{ kind: 'container', entity: 'vm-101/gitea' }} updated={poll()} />
    );
    expect(await screen.findByRole('img', { name: 'CPU, last hour' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Memory, last hour' })).toBeInTheDocument();
  });

  it('a server older than #311: no charts, no error, and not asked again this session', async () => {
    answer = () => RING_BUFFER;
    const updated = poll();
    let now = NOW;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const first = render(
      <DetailHistory target={{ kind: 'node', entity: 'vm-101' }} updated={updated} />
    );
    await waitFor(() => expect(screen.queryByRole('region', { name: 'History' })).toBeNull());
    expect(asked).toHaveLength(1);
    expect(screen.queryByText(/Couldn.t read the history|No data/)).toBeNull();
    now += 60 * MINUTE;
    await updated.tick();
    expect(asked).toHaveLength(1);
    first.unmount();
    // The next sheet, another kind: nothing drawn, nothing asked.
    render(
      <DetailHistory target={{ kind: 'container', entity: 'vm-101/gitea' }} updated={updated} />
    );
    expect(screen.queryByRole('region', { name: 'History' })).toBeNull();
    expect(document.querySelector('[data-slot="chart"]')).toBeNull();
    expect(asked).toHaveLength(1);
  });
});
