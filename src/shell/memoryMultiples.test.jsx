/**
 * The memory small multiples (#757): a cell per visible node with memory and
 * swap as two lines on one scale, the warn line, a node with no swap said in
 * words (no flat line), a node that is off a gap (never 0), the focus ring, and
 * the plain-words failed states.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UiRoot } from '@ui/root';
import { ChartPanel } from './MonitoringPage.jsx';
import { PHONE_DRAWINGS } from './monitoringPhone.jsx';
import { DRAWINGS } from './monitoringDrawings.jsx';
import { monitoringRangeOf } from './monitoring.js';
import { demoMonitoring } from '../../server/demoFixtures.js';
import { chartOfIssue } from '../../server/monitoringFocus.js';

const NOW = Date.parse('2026-10-29T12:00:00Z');
const demo = (range) =>
  demoMonitoring({ query: { range }, now: NOW }).body.charts.find((c) => c.id === 'memory');
const draw = (chart, range = '1h', focus) =>
  render(
    <UiRoot>
      <ChartPanel chart={chart} range={monitoringRangeOf(range)} busy={false} focus={focus} />
    </UiRoot>
  );
const cells = (c) => [...c.querySelectorAll('[data-slot="small-multiples-cell"]')];
const lineCount = (cell) => cell.querySelectorAll('[data-slot="chart-line"]').length;

describe('Memory and swap', () => {
  it('is drawn in Resources and opened by a memory issue', () => {
    expect(DRAWINGS.memory.section).toBe('resources');
    expect(chartOfIssue({ kind: 'node', metric: { name: 'mem' } })).toBe('memory');
  });

  it('draws a cell per node, two lines where the node has swap and one where it has none', () => {
    const chart = demo('1h');
    const { container } = draw(chart);
    expect(cells(container).map((c) => c.querySelector('[data-slot="small-multiples-name"]').textContent)).toEqual(chart.nodes);
    const swapNodes = new Set(chart.swap.lines.map((l) => l.entity));
    expect(swapNodes.size).toBeGreaterThan(0);
    expect(swapNodes.size).toBeLessThan(chart.nodes.length);
    chart.nodes.forEach((node, i) => {
      expect(lineCount(cells(container)[i]), node).toBe(swapNodes.has(node) ? 2 : 1);
    });
    // The warn line, in words, from the table.
    expect(container.textContent).toMatch(/Warn/);
  });

  it('says which nodes have no swap, instead of drawing a flat line', () => {
    const chart = demo('1h');
    const { container } = draw(chart);
    expect(container.querySelector('[data-slot="memory-no-swap-note"]').textContent).toBe(
      'edge has no swap, so no swap line.'
    );
    // Every node with swap: no note.
    const all = {
      ...chart,
      swap: { ...chart.swap, lines: chart.nodes.map((n) => ({ entity: n, values: chart.lines[0].values })) },
    };
    expect(draw(all).container.querySelector('[data-slot="memory-no-swap-note"]')).toBeNull();
  });

  it('a node with no memory reading has its cell, says so and is never zero', () => {
    const chart = demo('1h');
    const off = { ...chart, lines: chart.lines.filter((l) => l.entity !== 'apps') };
    const { container } = draw(off);
    const cell = cells(container).find((c) => c.textContent.includes('apps'));
    expect(cell.getAttribute('data-state')).toBe('empty');
    expect(cell.textContent).toContain('No data');
    expect(container.querySelector('[data-slot="memory-off-note"]').textContent).toMatch(
      /No memory reading in this range from apps: the node may be off\. A gap is shown as a gap, never as 0 %\./
    );
  });

  it('a failed swap read says its sentence and leaves the memory lines', () => {
    const chart = {
      ...demo('1h'),
      swap: { ok: false, error: 'Prometheus refused the swap query (HTTP 400)' },
    };
    const { container } = draw(chart);
    expect(container.querySelector('[data-slot="memory-swap-failed"]').textContent).toBe(
      'Swap could not be read: Prometheus refused the swap query (HTTP 400). The memory lines are unaffected.'
    );
    expect(container.querySelector('[data-slot="memory-no-swap-note"]')).toBeNull();
    cells(container).forEach((c) => expect(lineCount(c)).toBe(1));
  });

  it('points at a node from the banner: its cell takes the selected ring', () => {
    const { container } = draw(demo('1h'), '1h', { node: 'apps', text: 'Warning · 91 %' });
    const marked = cells(container).filter((c) => c.hasAttribute('data-highlighted'));
    expect(marked).toHaveLength(1);
    // The row's own tag always reads "Selected"; the Warning words live in the panel's `tag` (#830).
    expect(marked[0].textContent).toContain('Selected');
    expect(marked[0].textContent).not.toContain('Warning');
  });

  it('says why when the chart failed or there is no node', () => {
    const failed = { ...demo('1h'), ok: false, error: 'Prometheus refused the memory query (HTTP 400)' };
    const a = draw(failed);
    expect(screen.getByText('Prometheus refused the memory query (HTTP 400)')).toBeInTheDocument();
    expect(a.container.querySelector('[data-slot="small-multiples-cell"]')).toBeNull();
    a.unmount();
    draw({ ...demo('1h'), nodes: [], lines: [] });
    expect(screen.getByText('No nodes')).toBeInTheDocument();
  });
});

describe('Memory and swap on a phone (#759)', () => {
  const Body = PHONE_DRAWINGS.memory.Body;
  const phone = (chart) =>
    render(
      <UiRoot>
        <Body chart={chart} range={monitoringRangeOf('1h')} busy={false} />
      </UiRoot>
    );
  const rowOf = (container, node) =>
    cells(container).find((c) => c.querySelector('button')?.getAttribute('aria-label').startsWith(`${node},`));

  it('is drawn, in rows that say swap in words: a figure, "No swap", or why it is unknown', () => {
    expect(PHONE_DRAWINGS.memory).toBeDefined();
    const chart = demo('1h');
    const { container } = phone(chart);
    expect(container.querySelector('[data-variant="phone"]')).not.toBeNull();
    const aside = (node) => rowOf(container, node).querySelector('[data-slot="small-multiples-aside"]');
    expect(aside('edge').textContent).toBe('No swap');
    expect(aside('storage').textContent).toMatch(/^Swap \d+(\.\d)? %$/);
    // The row's name carries it too, for a screen reader.
    expect(rowOf(container, 'storage').querySelector('button').getAttribute('aria-label')).toMatch(/Swap \d/);
  });

  it('says a failed swap read in the row, not "No swap"', () => {
    const chart = { ...demo('1h'), swap: { ok: false, error: 'Prometheus refused the swap query (HTTP 400)' } };
    const { container } = phone(chart);
    expect(container.textContent).toContain('Swap could not be read');
    expect(container.textContent).not.toContain('No swap');
  });

  it('a node that is off gets no swap line of words (it says "No data" alone)', () => {
    const chart = demo('1h');
    const off = { ...chart, lines: chart.lines.filter((l) => l.entity !== 'apps') };
    const { container } = phone(off);
    expect(rowOf(container, 'apps')?.querySelector('[data-slot="small-multiples-aside"]') ?? null).toBeNull();
  });

  it('a tap opens a sheet with the full chart: memory and swap lines on 0 to 100 %', () => {
    const chart = demo('1h');
    const { container } = phone(chart);
    fireEvent.click(rowOf(container, 'storage').querySelector('button'));
    const sheet = document.querySelector('[data-drill="memory"]');
    expect(sheet).not.toBeNull();
    expect(sheet.querySelectorAll('[data-slot="chart-line"]')).toHaveLength(2);
    expect(sheet.textContent).toMatch(/Swap/);
  });

  it('a focus on a node the chart has no cell for opens no sheet (#807)', () => {
    render(
      <UiRoot>
        <Body
          chart={demo('1h')}
          range={monitoringRangeOf('1h')}
          busy={false}
          focus={{ node: 'no-such-node', drill: true }}
        />
      </UiRoot>
    );
    expect(document.querySelector('[data-drill="memory"]')).toBeNull();
  });

  it('a focus on a node it has a cell for opens that node\'s sheet', () => {
    render(
      <UiRoot>
        <Body
          chart={demo('1h')}
          range={monitoringRangeOf('1h')}
          busy={false}
          focus={{ node: 'storage', drill: true }}
        />
      </UiRoot>
    );
    expect(document.querySelector('[data-drill="memory"]')).not.toBeNull();
  });
});
