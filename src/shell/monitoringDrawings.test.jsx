/**
 * The two power charts' drawings (#753): their tiles, bars and words in every
 * state the server can answer (ok, no rate, no UPS, failed), the money in the
 * user's own symbol, and nothing summed from the displayed bars.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { UiRoot } from '@ui/root';
import { ChartPanel } from './MonitoringPage.jsx';
import { GROWERS_UNAVAILABLE, costDays, growthWords, growerRows, moneyOf, ordinalDay, rateWords, runtimeWords, DRAWINGS } from './monitoringDrawings.jsx';
import { monitoringRangeOf } from './monitoring.js';
import { demoMonitoring } from '../../server/demoFixtures.js';

const NOW = Date.parse('2026-10-29T12:00:00Z');
const demo = (range, id) => demoMonitoring({ query: { range }, now: NOW }).body.charts.find((c) => c.id === id);
const draw = (chart, range = '24h') =>
  render(
    <UiRoot>
      <ChartPanel chart={chart} range={monitoringRangeOf(range)} busy={false} />
    </UiRoot>
  );

describe('the helpers', () => {
  it('say a runtime, a day of the month, money and a rate', () => {
    expect(runtimeWords(41)).toBe('41 min');
    expect(runtimeWords(65)).toBe('1 h 5 min');
    expect(runtimeWords(120)).toBe('2 h');
    expect(runtimeWords(null)).toBeNull();
    expect(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-11', '2026-10-22', '2026-10-30'].map(ordinalDay)).toEqual(
      ['1st', '2nd', '3rd', '11th', '22nd', '30th']
    );
    expect(moneyOf('€', 0.294)).toBe('€0.29');
    expect(rateWords('$', 0.16)).toBe('$0.16/kWh');
    expect(rateWords('kr', 0.1475)).toBe('kr0.1475/kWh');
    expect(rateWords('$', 0.1)).toBe('$0.10/kWh');
    expect(rateWords('$', 0.1425)).toBe('$0.1425/kWh');
    expect(rateWords('$', 0.145)).toBe('$0.145/kWh');
    expect(rateWords('$', 2)).toBe('$2.00/kWh');
  });

  it('puts each day on its own calendar date, with the rate and the hours read in its note', () => {
    const chart = demo('30d', 'monthly-cost');
    const days = costDays({
      ...chart,
      days: [{ day: '2026-03-08', kWh: 2.04, cost: 0.2856, ratePerKwh: 0.14, coverage: 0.5, partial: false }],
    });
    expect(days[0]).toMatchObject({ key: '2026-03-08', time: Date.UTC(2026, 2, 8), value: 0.2856 });
    expect(days[0].note).toBe('Rate $0.14/kWh, 2.0 kWh, 50 % of the hours read');
  });
});

describe('Power draw', () => {
  it('draws the line with the runtime tile, the lowest and highest, and the footnote', () => {
    draw(demo('24h', 'power-draw'));
    const card = document.querySelector('[data-chart="power-draw"]');
    expect(within(card).getByRole('group', { name: 'UPS runtime: 41 min, at the current load' })).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: /Power draw, last 24 hours/ })).toBeInTheDocument();
    expect(card.querySelector('[data-slot="power-stats"]').textContent).toMatch(/^Lowest \d+ W, highest \d+ W last 24 hours\.$/);
    expect(card.querySelector('[data-slot="power-footnote"]').textContent).toBe(
      'Covers only what is plugged into the UPS. It is the UPS’s load percentage times its nominal watts, not a metered reading.'
    );
  });

  it('draws the runtime tile only where it is current (1 h, 24 h), and says "lowest average" with a band', () => {
    const { unmount } = draw(demo('7d', 'power-draw'), '7d');
    expect(screen.queryByRole('group', { name: /UPS runtime/ })).toBeNull();
    expect(document.querySelector('[data-slot="power-stats"]').textContent).toMatch(/^Lowest average \d+ W, highest/);
    unmount();
    draw(demo('1h', 'power-draw'), '1h');
    expect(screen.getByRole('group', { name: /UPS runtime/ })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="power-stats"]').textContent).toMatch(/^Lowest \d+ W/);
  });

  it('dims the cost body while the next range is read', () => {
    render(
      <UiRoot>
        <ChartPanel chart={demo('24h', 'monthly-cost')} range={monitoringRangeOf('24h')} busy />
      </UiRoot>
    );
    expect(document.querySelector('[data-chart="monthly-cost"] [data-slot="chart-body"]')).toHaveAttribute('aria-busy', 'true');
  });

  it('carries the max band on 7 d and 30 d only', () => {
    const day = draw(demo('24h', 'power-draw'));
    expect(document.querySelector('[data-slot="chart-band"]')).toBeNull();
    day.unmount();
    draw(demo('7d', 'power-draw'), '7d');
    expect(document.querySelector('[data-slot="chart-band"]')).not.toBeNull();
  });

  it('says "No UPS data" in words, with no plot and no 0 W', () => {
    const chart = { ...demo('24h', 'power-draw'), state: 'no-ups', values: [], maxValues: null, stats: null, runtimeMinutes: null };
    draw(chart);
    const card = document.querySelector('[data-chart="power-draw"]');
    expect(within(card).getByText('No UPS data')).toBeInTheDocument();
    expect(card.querySelector('svg path')).toBeNull();
    expect(card.textContent).not.toMatch(/\b0 W\b/);
  });

  it('a failed read says its own sentence and no tiles', () => {
    const { id, title, question, section } = demo('1h', 'power-draw');
    draw({ id, title, question, section, ok: false, error: 'Prometheus refused the power query (HTTP 400)' }, '1h');
    expect(screen.getByText('Prometheus refused the power query (HTTP 400)')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="stat-tile"]')).toBeNull();
  });

  it('a UPS with no runtime reading says "No reading", never 0 min', () => {
    draw({ ...demo('1h', 'power-draw'), runtimeMinutes: null }, '1h');
    expect(screen.getByRole('group', { name: 'UPS runtime: No reading, at the current load' })).toBeInTheDocument();
  });
});

describe('Monthly cost', () => {
  it('shows the month to date and the projected month in the configured symbol, and the bars', () => {
    const chart = { ...demo('24h', 'monthly-cost'), currency: '€' };
    draw(chart);
    const card = document.querySelector('[data-chart="monthly-cost"]');
    const tiles = [...card.querySelectorAll('[data-slot="stat-tile"]')].map((t) => t.getAttribute('aria-label'));
    expect(tiles[0]).toBe(`Month to date: €${chart.month.cost.toFixed(2)}, so far`);
    expect(tiles[1]).toBe(`Projected month: €${chart.month.projected.cost.toFixed(2)}, at €0.16/kWh, from the last 7 days`);
    expect(within(card).getByRole('img', { name: /Monthly cost, per day/ })).toBeInTheDocument();
    expect(card.querySelector('[data-slot="power-footnote"]')).not.toBeNull();
    expect(card.querySelector('[data-slot="cost-no-rate"]')).toBeNull();
  });

  it('says "since the 2nd" when the month started before the data did', () => {
    const chart = demo('24h', 'monthly-cost');
    draw({ ...chart, month: { ...chart.month, since: '2026-10-02' } });
    expect(screen.getByRole('group', { name: /^Month to date: .*, since the 2nd$/ })).toBeInTheDocument();
  });

  it('with no rate: kWh in the tiles, no bars, and a link to Settings → System', () => {
    const chart = demo('24h', 'monthly-cost');
    draw({
      ...chart,
      currency: null,
      currentRatePerKwh: null,
      days: chart.days.map((d) => ({ ...d, cost: null, ratePerKwh: null })),
      month: { ...chart.month, cost: null, projected: { ...chart.month.projected, cost: null } },
    });
    const card = document.querySelector('[data-chart="monthly-cost"]');
    expect(card.querySelector('[data-slot="stat-tile"]').getAttribute('aria-label')).toMatch(/^Month to date: \d+\.\d kWh, so far$/);
    expect(within(card).getByText('No electricity rate set')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Settings → System → Energy cost' })).toHaveAttribute('href', '/settings/system#energy-cost');
    expect(within(card).queryByRole('img')).toBeNull();
    expect(card.textContent).not.toMatch(/[$€]/);
  });

  it('with too few days for a projection, says so rather than 0', () => {
    const chart = demo('24h', 'monthly-cost');
    draw({ ...chart, month: { ...chart.month, projected: null } });
    expect(screen.getByRole('group', { name: 'Projected month: Not enough days yet' })).toBeInTheDocument();
  });

  it('no UPS and a failed read are words, not an empty plot', () => {
    const chart = demo('24h', 'monthly-cost');
    const { unmount } = draw({ ...chart, state: 'no-ups', days: undefined, month: undefined });
    expect(screen.getByText('No UPS data')).toBeInTheDocument();
    unmount();
    const { id, title, question, section } = chart;
    draw({ id, title, question, section, ok: false, error: 'Prometheus refused the connection' });
    expect(screen.getByText('Prometheus refused the connection')).toBeInTheDocument();
  });

  it('draws the month figure as given, summing nothing from the displayed bars', () => {
    const chart = demo('24h', 'monthly-cost');
    // Bars that do not add up to the month figure: the tile still says the server's.
    draw({ ...chart, month: { ...chart.month, cost: 123.45 } });
    expect(screen.getByRole('group', { name: 'Month to date: $123.45, so far' })).toBeInTheDocument();
  });
});

describe('Container memory growers', () => {
  const growers = () => demo('24h', 'container-memory-growers');

  it('says growth in bytes, with a sign', () => {
    expect([growthWords(2.4e9), growthWords(240e6), growthWords(12_000), growthWords(-3e6), growthWords(null)]).toEqual([
      '+2.4 GB',
      '+240 MB',
      '+12.0 kB',
      '−3.0 MB',
      null,
    ]);
  });

  it('ranks the rows as the server sent them, each value printed, with a trend', () => {
    draw(growers());
    const card = document.querySelector('[data-chart="container-memory-growers"]');
    const rows = [...card.querySelectorAll('[data-slot="ranked-bars-row"]')];
    expect(rows.length).toBe(5);
    expect(rows[0].textContent).toContain('loki (apps)');
    expect(rows[0].textContent).toContain('+2.4 GB');
    expect(rows[0].querySelector('[data-slot="sparkline"]')).not.toBeNull();
    expect(within(card).getByRole('img', { name: /Container memory growth, 7 days/ })).toBeInTheDocument();
  });

  it('draws a row without a trend or with gaps as given, never as 0', () => {
    const chart = growers();
    const rows = growerRows({ ...chart, rows: [{ ...chart.rows[0], trend: [1, null, 3] }, { ...chart.rows[1], trend: null }] });
    expect(rows[0].points.map((p) => p.value)).toEqual([1, null, 3]);
    expect(rows[1].points).toBeUndefined();
  });

  it('a missing rule says "Not available" with the cause, not an empty list', () => {
    for (const state of ['no-rule', 'no-cadvisor']) {
      const { unmount } = draw({ ...growers(), state, rows: [] });
      const note = document.querySelector('[data-slot="growers-unavailable"]');
      expect(note.textContent).toContain('Not available');
      expect(note.textContent).toContain(GROWERS_UNAVAILABLE[state]);
      expect(document.querySelector('[data-slot="ranked-bars"]')).toBeNull();
      unmount();
    }
  });

  it('nothing growing is said in words; a failed read says its own sentence', () => {
    const { unmount } = draw({ ...growers(), rows: [] });
    expect(screen.getByText('No container grew over the last 7 days')).toBeInTheDocument();
    unmount();
    draw({ id: 'container-memory-growers', title: 'Container memory growers', question: 'q', section: 'resources', ok: false, error: 'Prometheus refused the connection' });
    expect(screen.getByText('Prometheus refused the connection')).toBeInTheDocument();
  });
});

describe('the drawings table', () => {
  it('gives every entry a section and a Body', () => {
    for (const [id, d] of Object.entries(DRAWINGS)) {
      expect(typeof d.section, id).toBe('string');
      expect(typeof d.Body, id).toBe('function');
    }
  });
});
