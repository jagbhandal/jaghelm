/**
 * The CPU small multiples and their drill-down (#756): a cell per visible node
 * on one scale with the warn line, the max band on the long ranges, a node that
 * is off said in words (never 0), the drill-down from a cell and from a focus,
 * and the plain-words states of its two parts.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { UiRoot } from '@ui/root';
import { ChartPanel } from './MonitoringPage.jsx';
import { monitoringRangeOf } from './monitoring.js';
import { demoMonitoring } from '../../server/demoFixtures.js';

const NOW = Date.parse('2026-10-29T12:00:00Z');
const demo = (range) =>
  demoMonitoring({ query: { range }, now: NOW }).body.charts.find((c) => c.id === 'cpu-overview');
const draw = (chart, range = '1h', focus) =>
  render(
    <UiRoot>
      <ChartPanel chart={chart} range={monitoringRangeOf(range)} busy={false} focus={focus} />
    </UiRoot>
  );
const cells = (c) => [...c.querySelectorAll('[data-slot="small-multiples-cell"]')];

describe('CPU by node', () => {
  it('draws a cell per node, each named, with the warn line and no band on an hour', () => {
    const chart = demo('1h');
    const { container } = draw(chart);
    expect(
      cells(container).map((c) => c.querySelector('[data-slot="small-multiples-name"]').textContent)
    ).toEqual(chart.nodes);
    expect(container.querySelectorAll('[data-slot="chart-band"]')).toHaveLength(0);
    expect(container.querySelector('[data-slot="cpu-off-note"]')).toBeNull();
    // The warn line from the table, in words, on a cell.
    expect(container.textContent).toMatch(/Warn/);
  });

  it('draws the max band behind every line on 7 d and 30 d', () => {
    for (const range of ['7d', '30d']) {
      const chart = demo(range);
      const { container, unmount } = draw(chart, range);
      expect(container.querySelectorAll('[data-slot="chart-band"]')).toHaveLength(
        chart.lines.length
      );
      unmount();
    }
  });

  it('a node with no reading has its cell, says so in words and is never zero', () => {
    const chart = demo('1h');
    const off = { ...chart, lines: chart.lines.filter((l) => l.entity !== 'apps') };
    const { container } = draw(off);
    const cell = cells(container).find((c) => c.textContent.includes('apps'));
    expect(cell.getAttribute('data-state')).toBe('empty');
    expect(cell.textContent).toContain('No data');
    expect(cell.querySelector('[data-slot="chart"]')).toBeNull();
    expect(container.querySelector('[data-slot="cpu-off-note"]').textContent).toMatch(
      /No CPU reading in this range from apps: the node may be off\. A gap is shown as a gap, never as 0 %\./
    );
    // A step missed in the middle of a line is a gap too, not 0.
    const gap = {
      ...chart,
      lines: chart.lines.map((l) => ({
        ...l,
        values: l.values.map((v, i) => (i === 30 ? null : v)),
      })),
    };
    expect(draw(gap).container.querySelector('[data-slot="cpu-off-note"]')).toBeNull();
  });

  it('says why when the chart failed or there is no node', () => {
    const failed = {
      id: 'cpu-overview',
      title: 'CPU by node',
      question: 'q',
      section: 'resources',
      ok: false,
      error: 'Prometheus refused the CPU query (HTTP 400)',
    };
    const a = draw(failed);
    expect(screen.getByText('Prometheus refused the CPU query (HTTP 400)')).toBeInTheDocument();
    expect(a.container.querySelector('[data-slot="small-multiples-cell"]')).toBeNull();
    a.unmount();
    draw({ ...demo('1h'), nodes: [], lines: [] });
    expect(screen.getByText('No nodes')).toBeInTheDocument();
  });
});

describe('the drill-down', () => {
  const open = (chart, range) => {
    draw(chart, range);
    fireEvent.click(screen.getByRole('button', { name: 'edge. Open the chart' }));
    return screen.findByRole('dialog', { name: 'edge' });
  };

  it('opens from a cell with the node’s I/O wait and temperature', async () => {
    const chart = demo('24h');
    const sheet = await open(chart, '24h');
    expect(within(sheet).getByText('I/O wait')).toBeInTheDocument();
    expect(within(sheet).getByText('Temperature')).toBeInTheDocument();
    expect(
      within(sheet).getByRole('img', { name: /edge I\/O wait, last 24 hours/ })
    ).toBeInTheDocument();
    expect(
      within(sheet).getByRole('img', { name: /edge Temperature, last 24 hours/ })
    ).toBeInTheDocument();
    // Both lines of the temperature, in words, from the table.
    expect(
      [...sheet.querySelectorAll('[data-slot="chart-threshold-label"]')].map((e) => e.textContent)
    ).toEqual(['Warn 75 °C', 'Critical 85 °C']);
    expect(sheet.querySelectorAll('[data-slot="chart-band"]')).toHaveLength(0);
  });

  it('carries the max band on 7 d', async () => {
    const sheet = await open(demo('7d'), '7d');
    expect(sheet.querySelectorAll('[data-slot="chart-band"]')).toHaveLength(2);
  });

  it('a node with no sensor says so in words', async () => {
    const chart = demo('1h');
    const sheet = await open(
      {
        ...chart,
        temperature: {
          ...chart.temperature,
          lines: chart.temperature.lines.filter((l) => l.entity !== 'edge'),
        },
      },
      '1h'
    );
    expect(
      within(sheet).getByText(/No temperature reading for edge in this range/)
    ).toBeInTheDocument();
    expect(within(sheet).getByRole('img', { name: /edge I\/O wait/ })).toBeInTheDocument();
  });

  it('a part Prometheus could not answer says its own sentence; the other still draws', async () => {
    const chart = demo('1h');
    const sheet = await open(
      {
        ...chart,
        iowait: { ok: false, error: 'Prometheus refused the I/O wait query (HTTP 400)' },
      },
      '1h'
    );
    expect(
      within(sheet).getByText('Prometheus refused the I/O wait query (HTTP 400)')
    ).toBeInTheDocument();
    expect(within(sheet).getByRole('img', { name: /edge Temperature/ })).toBeInTheDocument();
  });

  it('focus marks the node’s cell with the tag; with drill it opens the drill-down', async () => {
    const chart = demo('1h');
    const a = draw(chart, '1h', { node: 'apps', text: 'Warning · 91 %' });
    const marked = cells(a.container).filter((c) => c.hasAttribute('data-highlighted'));
    expect(marked).toHaveLength(1);
    // The row's own tag always reads "Selected"; the Warning words live in the panel's `tag` (#830).
    expect(marked[0].textContent).toContain('Selected');
    expect(marked[0].textContent).not.toContain('Warning');
    expect(screen.queryByRole('dialog')).toBeNull();
    a.unmount();
    draw(chart, '1h', { node: 'apps', drill: true });
    expect(await screen.findByRole('dialog', { name: 'apps' })).toBeInTheDocument();
  });
});
