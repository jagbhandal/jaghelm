import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HistoryCharts } from './HistoryCharts.jsx';
import { forgetOldHistoryServers } from './useHistory.js';
import { chartTarget } from './entityDetail.js';
import { chartsOf, pointsOf, seriesFor } from '../historySeries.js';
import { forgetAnswers } from '../../hooks/useData.js';
import { demoResponse } from '../../../server/demo.js';

// The detail drawer's history (#311): a node's Usage and Temperature, a
// container's CPU and Memory, from /api/history as the demo answers it (the
// live route's shape), in one request per entity and range; the range
// switch; and what a Prometheus that doesn't answer, or a read that fails,
// draws instead of a line.

const NOW = Date.UTC(2026, 9, 23, 12, 0, 30);

let asked;
let answer;

function respond(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name === 'ETag' ? `"${asked.length}"` : null) },
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  forgetAnswers();
  forgetOldHistoryServers();
  asked = [];
  answer = (url) => {
    const u = new URL(url, 'http://localhost');
    const out = demoResponse({
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      now: NOW,
    });
    return respond(out.body, out.status);
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      asked.push(String(url));
      return answer(String(url));
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A status poll stand-in: `tick()` is an answer of it. */
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

const chartNamed = (name) => screen.getByRole('img', { name });
const lines = (img) => img.parentElement.querySelectorAll('[data-slot="chart-line"]');

describe('what a detail charts (#311)', () => {
  it('a node by its key; a service or container with a container as <node>/<container>; else nothing', () => {
    expect(chartTarget({ kind: 'node', node: 'apps' }, null)).toEqual({
      kind: 'node',
      entity: 'apps',
    });
    expect(chartTarget({ kind: 'service', node: 'apps' }, { container: 'jellyfin' })).toEqual({
      kind: 'container',
      entity: 'apps/jellyfin',
    });
    expect(chartTarget({ kind: 'container', node: 'apps' }, { container: 'redis' })).toEqual({
      kind: 'container',
      entity: 'apps/redis',
    });
    // A Kuma monitor with no container, the UPS, a job: no history to chart.
    expect(chartTarget({ kind: 'service', node: 'apps' }, { container: null })).toBeNull();
    expect(chartTarget({ kind: 'ups' }, null)).toBeNull();
    expect(chartTarget({ kind: 'job', node: 'apps' }, null)).toBeNull();
    expect(seriesFor('node')).toEqual(['node.cpu', 'node.memory', 'node.disk', 'node.temperature']);
    expect(seriesFor('container')).toEqual(['container.cpu', 'container.memory']);
  });
});

describe('the drawer’s history (#311)', () => {
  it('a node: Usage (CPU, memory, disk) and Temperature over the last hour, in one request', async () => {
    render(<HistoryCharts target={{ kind: 'node', entity: 'edge' }} updated={poll()} />);
    const usage = await screen.findByRole('img', { name: 'Usage, last hour' });
    expect(asked).toEqual([
      '/api/history?series=node.cpu%2Cnode.memory%2Cnode.disk%2Cnode.temperature&range=1h&entity=edge',
    ]);
    expect(lines(usage)).toHaveLength(3);
    const legend = usage.closest('[data-slot="chart"]').querySelector('[data-slot="chart-legend"]');
    expect(legend).toHaveTextContent('CPUMemoryDisk');
    // The hour ends on the reading the node's meter shows (the demo's 6.2 %).
    expect(usage).toHaveAccessibleDescription(/^CPU: latest 6 % at /);
    expect(chartNamed('Temperature, last hour')).toHaveAccessibleDescription(/^latest 47 °C at /);
    expect(screen.getByRole('radio', { name: '1 h' })).toHaveAttribute('aria-checked', 'true');
  });

  it('a node with no temperature sensor has no Temperature chart', async () => {
    render(<HistoryCharts target={{ kind: 'node', entity: 'apps' }} updated={poll()} />);
    await screen.findByRole('img', { name: 'Usage, last hour' });
    expect(screen.queryByRole('img', { name: /^Temperature/ })).toBeNull();
  });

  it('a container: its CPU and its memory, in GB from 1 GB up', async () => {
    render(
      <HistoryCharts target={{ kind: 'container', entity: 'apps/jellyfin' }} updated={poll()} />
    );
    const memory = await screen.findByRole('img', { name: 'Memory, last hour' });
    expect(asked).toEqual([
      '/api/history?series=container.cpu%2Ccontainer.memory&range=1h&entity=apps%2Fjellyfin',
    ]);
    expect(memory).toHaveAccessibleDescription(/^latest 1\.3 GB at /);
    expect(chartNamed('CPU, last hour')).toHaveAccessibleDescription(/^latest 12 % at /);
  });

  it('the range switch reads that range, keeping the last lines dimmed until it answers', async () => {
    const user = userEvent.setup();
    render(<HistoryCharts target={{ kind: 'node', entity: 'storage' }} updated={poll()} />);
    await screen.findByRole('img', { name: 'Usage, last hour' });
    let release;
    const demo = answer;
    answer = (url) => new Promise((resolve) => (release = () => resolve(demo(url))));
    await user.click(screen.getByRole('radio', { name: '7 d' }));
    expect(asked.at(-1)).toMatch(/range=7d&entity=storage$/);
    // Still the hour's lines, dimmed, while the week is read.
    const busy = screen
      .getByRole('img', { name: 'Usage, last hour' })
      .closest('[data-slot="chart"]');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await act(async () => release());
    const week = await screen.findByRole('img', { name: 'Usage, last 7 days' });
    expect(week.closest('[data-slot="chart"]')).not.toHaveAttribute('aria-busy');
    // Ticks on days, on the local clock, as many as fit: named by the day.
    const days = [
      ...week.closest('[data-slot="chart"]').querySelectorAll('[data-slot="chart-x"] span'),
    ].map((s) => s.textContent);
    expect(days.length).toBeGreaterThanOrEqual(3);
    expect(days.every((d) => /^\D+ \d{1,2}$|^\d{1,2} \D+$/.test(d))).toBe(true);
  });

  it('reads again on a status answer only once the range’s step has passed', async () => {
    const updated = poll();
    let now = NOW;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    render(<HistoryCharts target={{ kind: 'node', entity: 'edge' }} updated={updated} />);
    await screen.findByRole('img', { name: 'Usage, last hour' });
    expect(asked).toHaveLength(1);
    now += 30_000;
    await updated.tick();
    expect(asked).toHaveLength(1);
    now += 30_000;
    await updated.tick();
    expect(asked).toHaveLength(2);
  });

  it('Prometheus not answering: each chart says so, with why, and draws no line', async () => {
    answer = () =>
      respond({
        range: '1h',
        entity: 'edge',
        series: seriesFor('node').map((series) => ({
          series,
          unit: '%',
          startMs: NOW,
          stepMs: 60_000,
          count: 61,
          ok: false,
          error: "Prometheus didn't answer",
        })),
      });
    render(<HistoryCharts target={{ kind: 'node', entity: 'edge' }} updated={poll()} />);
    const usage = await screen.findByRole('img', {
      name: 'Usage, last hour: No data from Prometheus',
    });
    expect(within(usage).getByText("Prometheus didn't answer")).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Temperature, last hour: No data from Prometheus' })
    ).toBeInTheDocument();
    expect(document.querySelector('[data-slot="chart-line"]')).toBeNull();
  });

  it('a read that fails says the history couldn’t be read, and why', async () => {
    answer = () => respond({ error: 'nope' }, 502);
    render(
      <HistoryCharts target={{ kind: 'container', entity: 'apps/jellyfin' }} updated={poll()} />
    );
    const cpu = await screen.findByRole('img', {
      name: 'CPU, last hour: Couldn’t read the history'.replace('’', "'"),
    });
    expect(within(cpu).getByText('HTTP 502')).toBeInTheDocument();
  });

  it('another entity starts afresh: one entity’s lines never show under another’s name', async () => {
    const { rerender } = render(
      <HistoryCharts target={{ kind: 'node', entity: 'edge' }} updated={poll()} />
    );
    await screen.findByRole('img', { name: 'Temperature, last hour' });
    answer = () => new Promise(() => {});
    rerender(<HistoryCharts target={{ kind: 'node', entity: 'apps' }} updated={poll()} />);
    await waitFor(() => expect(document.querySelector('[data-slot="chart-line"]')).toBeNull());
    expect(document.querySelector('[data-slot="chart"] [aria-busy="true"]')).not.toBeNull();
  });
});

describe('the phone’s sheet (#602)', () => {
  // GET /api/history before #311: the ring buffer's readings by "<node>:<metric>",
  // whatever the query asks. An Android app can talk to such a server.
  const RING_BUFFER = { 'edge:cpu': [4, 5, 6], 'edge:mem': [40, 41, 42] };

  it('size="touch": the range switch’s segments are 44px targets; the charts are the drawer’s', async () => {
    render(
      <HistoryCharts target={{ kind: 'node', entity: 'edge' }} updated={poll()} size="touch" />
    );
    await screen.findByRole('img', { name: 'Usage, last hour' });
    expect(screen.getByRole('radiogroup', { name: 'Range' })).toHaveAttribute('data-size', 'touch');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toHaveClass('h-11');
  });

  it('an older server: no charts and no error, and it isn’t asked again this session', async () => {
    const updated = poll();
    let now = NOW;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    answer = () => respond(RING_BUFFER);
    const { container, unmount } = render(
      <HistoryCharts target={{ kind: 'node', entity: 'edge' }} updated={updated} />
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(asked).toHaveLength(1);
    expect(screen.queryByText(/Couldn.t read the history/)).toBeNull();
    // Its step long past: still nothing asked, and nothing drawn.
    now += 60 * 60_000;
    await updated.tick();
    expect(asked).toHaveLength(1);
    expect(container).toBeEmptyDOMElement();
    unmount();
    // Another detail, another kind: nothing asked, nothing drawn, not even a placeholder.
    const again = render(
      <HistoryCharts target={{ kind: 'container', entity: 'apps/jellyfin' }} updated={updated} />
    );
    expect(again.container).toBeEmptyDOMElement();
    expect(asked).toHaveLength(1);
  });

  it('a sheet covered by another (`paused`) reads nothing; on top again, it reads and keeps its lines', async () => {
    const updated = poll();
    let now = NOW;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const target = { kind: 'node', entity: 'edge' };
    const { rerender } = render(<HistoryCharts target={target} updated={updated} paused />);
    expect(asked).toHaveLength(0);
    rerender(<HistoryCharts target={target} updated={updated} />);
    await screen.findByRole('img', { name: 'Usage, last hour' });
    expect(asked).toHaveLength(1);
    // Covered: the poll's answers past the step ask nothing; the lines stay drawn.
    rerender(<HistoryCharts target={target} updated={updated} paused />);
    now += 5 * 60_000;
    await updated.tick();
    expect(asked).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Usage, last hour' })).toBeInTheDocument();
    // On top again: one read at once.
    rerender(<HistoryCharts target={target} updated={updated} />);
    await waitFor(() => expect(asked).toHaveLength(2));
  });
});

describe('historySeries (#311)', () => {
  const body = {
    range: '1h',
    series: [
      {
        series: 'node.cpu',
        unit: '%',
        startMs: 0,
        stepMs: 60_000,
        count: 2,
        ok: true,
        lines: [{ entity: 'a', values: [1, null] }],
      },
      {
        series: 'node.memory',
        unit: '%',
        startMs: 0,
        stepMs: 60_000,
        count: 2,
        ok: false,
        error: 'boom',
      },
      { series: 'node.disk', unit: '%', startMs: 0, stepMs: 60_000, count: 2, ok: true, lines: [] },
      {
        series: 'node.temperature',
        unit: '°C',
        startMs: 0,
        stepMs: 60_000,
        count: 2,
        ok: false,
        error: 'boom',
      },
    ],
  };

  it('a line as timed points, a gap as null; none for an entity without a line or a failed series', () => {
    expect(pointsOf(body.series[0], 'a')).toEqual([
      { time: 0, value: 1 },
      { time: 60_000, value: null },
    ]);
    expect(pointsOf(body.series[0], 'b')).toBeNull();
    expect(pointsOf(body.series[1], 'a')).toBeNull();
  });

  it('a line Prometheus didn’t answer beside ones it did is named under the chart; a chart all failed says so', () => {
    const [usage, temperature] = chartsOf({ kind: 'node', entity: 'a' }, body, { range: '1h' });
    expect(usage.state).toBe('ready');
    expect(usage.series.map((s) => s.name)).toEqual(['CPU']);
    expect(usage.note).toBe('No data from Prometheus for Memory');
    expect(temperature).toMatchObject({ state: 'failed', detail: 'boom' });
    expect(chartsOf({ kind: 'node', entity: 'a' }, null, { range: '1h' })[0].state).toBe('loading');
  });
});
