/**
 * Disk runway's drawing (#754): the ranked bars in the server's order, the
 * plain-words state of a row with no date (never a bar, never "plenty"), the
 * drill-in's projection that ends where the server's days left say, and a
 * failed chart.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { UiRoot } from '@ui/root';
import { ChartPanel } from './MonitoringPage.jsx';
import { canProject, projectionOf, runwayRow } from './diskRunway.js';
import { monitoringRangeOf } from './monitoring.js';
import { demoMonitoring } from '../../server/demoFixtures.js';

const NOW = Date.parse('2026-10-29T12:00:00Z');
const demo = () => demoMonitoring({ query: { range: '24h' }, now: NOW }).body.charts.find((c) => c.id === 'disk-runway');
const draw = (chart, busy = false) =>
  render(
    <UiRoot>
      <ChartPanel chart={chart} range={monitoringRangeOf('24h')} busy={busy} />
    </UiRoot>
  );
const row = (node, status, extra = {}) => ({
  node,
  mount: '/',
  primary: true,
  status,
  daysLeft: null,
  growthBytesPerDay: null,
  r2: null,
  samples: 0,
  sizeBytes: 100e9,
  usedBytes: 50e9,
  ...extra,
});
const LINES = { warn: 14, crit: 3 };
const withRows = (rows) => ({ ...demo(), rows });

describe('row names (#797)', () => {
  it('name the mount and its size, and a node with two rows keeps two keys', () => {
    const small = row('nas', 'ok', { daysLeft: 38, mount: '/ugreen', sizeBytes: 4.19e9 });
    const pool = row('nas', 'stable', { mount: '/volume1', sizeBytes: 16e12, growthBytesPerDay: 0 });
    expect(runwayRow(small, LINES).name).toBe('nas /ugreen, 4.2 GB');
    expect(runwayRow(pool, LINES).name).toBe('nas /volume1, 16 TB');
    expect(runwayRow(small, LINES).key).not.toBe(runwayRow(pool, LINES).key);
    expect(runwayRow(row('x', 'nodata', { mount: null, sizeBytes: null }), LINES).name).toBe('x');
  });

  it('draw both rows of the NAS in the chart', () => {
    draw(withRows([
      row('nas', 'ok', { daysLeft: 38, growthBytesPerDay: 1e7, samples: 100, mount: '/ugreen', sizeBytes: 4.19e9, usedBytes: 2.4e9 }),
      row('nas', 'stable', { mount: '/volume1', sizeBytes: 16e12, growthBytesPerDay: 0 }),
    ]));
    expect(screen.getByText('nas /ugreen, 4.2 GB')).toBeInTheDocument();
    expect(screen.getByText('nas /volume1, 16 TB')).toBeInTheDocument();
  });
});

describe('runwayRow', () => {
  it('colours a date against the Settings lines, with the days in words', () => {
    expect(runwayRow(row('a', 'ok', { daysLeft: 2.5 }), LINES)).toMatchObject({ value: 2.5, valueText: '2 days left', state: 'crit' });
    expect(runwayRow(row('a', 'ok', { daysLeft: 9 }), LINES).state).toBe('warn');
    expect(runwayRow(row('a', 'ok', { daysLeft: 90 }), LINES).state).toBe('ok');
    expect(runwayRow(row('a', 'ok', { daysLeft: 0.2 }), LINES).valueText).toBe('Under 1 day left');
  });

  it('gives a row with no date words and no value: never 0, never a bar', () => {
    const cases = {
      nodata: 'No signal',
      noisy: 'Too irregular to forecast',
      insufficient: 'Not enough history',
      surprise: 'No forecast',
    };
    for (const [status, words] of Object.entries(cases)) {
      expect(runwayRow(row('a', status), LINES)).toMatchObject({ value: null, valueText: words, state: 'unknown' });
    }
    expect(runwayRow(row('a', 'stable', { growthBytesPerDay: 0 }), LINES)).toMatchObject({ value: null, valueText: 'Not filling' });
    expect(runwayRow(row('a', 'stable', { growthBytesPerDay: 1e6 }), LINES).valueText).toBe('Over 6 months');
    // An ok row whose days did not arrive is not a bar either.
    expect(runwayRow(row('a', 'ok', { daysLeft: null }), LINES)).toMatchObject({ value: null, state: 'unknown' });
  });
});

describe('projectionOf', () => {
  const r = row('a', 'ok', { daysLeft: 10, growthBytesPerDay: 5e9, samples: 100, usedBytes: 50e9 });
  it('runs from the reading now to 100 % on the day the server says, dashed part after now only', () => {
    const p = projectionOf(r, NOW);
    expect(p.fullMs).toBe(NOW + 10 * 86_400_000);
    expect(p.projection.at(-1)).toEqual({ time: p.fullMs, value: 100 });
    const nowAt = p.fitted.find((x) => x.time === NOW);
    expect(nowAt.value).toBe(50);
    expect(p.projection.find((x) => x.time === NOW).value).toBe(50);
    expect(p.fitted.filter((x) => x.time > NOW).every((x) => x.value === null)).toBe(true);
    expect(p.projection.filter((x) => x.time < NOW).every((x) => x.value === null)).toBe(true);
    expect(p.fitted[0].value).toBeLessThan(50);
  });

  it('needs a date, a size, a reading and growth', () => {
    expect(canProject(r)).toBe(true);
    expect(canProject({ ...r, usedBytes: null })).toBe(false);
    expect(canProject({ ...r, status: 'noisy' })).toBe(false);
    expect(canProject({ ...r, growthBytesPerDay: 0 })).toBe(false);
  });
});

describe('Disk runway', () => {
  it('draws the demo: worst first, the days in words, the projection and its sentence', () => {
    draw(demo());
    const card = document.querySelector('[data-chart="disk-runway"]');
    const bars = within(card).getByRole('img', { name: /Disk runway, days until full/ });
    const names = [...card.querySelectorAll('[data-slot="ranked-bars-row"]')].map((r) => r.getAttribute('data-key'));
    expect(names).toEqual(['storage /overlay', 'storage /volume1', 'apps /', 'edge /']);
    expect(card.textContent).toContain('storage /overlay, 17 GB');
    expect(card.textContent).toContain('storage /volume1, 12 TB');
    expect(bars).toBeInTheDocument();
    expect(card.querySelector('[data-slot="ranked-bars-value"]').textContent).toBe('24 days left');
    expect(within(card).getByRole('img', { name: /storage \/overlay, 17 GB, disk filling/ })).toBeInTheDocument();
    expect(card.querySelector('[data-slot="runway-note"]').textContent).toMatch(/is 56\.4 % full .* The dashed part is a projection, not a reading\.$/);
    expect(card.querySelector('[data-slot="chart-line"][stroke-dasharray]')).not.toBeNull();
  });

  it('a node with no signal reads as such with no bar and no number', () => {
    draw(withRows([row('pve', 'ok', { daysLeft: 20, growthBytesPerDay: 1e9, samples: 100 }), row('ms-s1', 'nodata', { mount: null, sizeBytes: null, usedBytes: null })]));
    const card = document.querySelector('[data-chart="disk-runway"]');
    const off = card.querySelector('[data-key="ms-s1"]');
    expect(off.textContent).toContain('No signal');
    expect(off.querySelector('[data-slot="ranked-bars-bar"]')).toBeNull();
    expect(off.textContent).not.toMatch(/\d+ days?/);
  });

  it('a noisy disk says so and gets no projection when nothing else has a date', () => {
    draw(withRows([row('apps', 'noisy')]));
    const card = document.querySelector('[data-chart="disk-runway"]');
    expect(card.querySelector('[data-key="apps /"]').textContent).toContain('Too irregular to forecast');
    expect(card.querySelector('[data-slot="runway-no-projection"]')).not.toBeNull();
    expect(card.querySelector('[data-slot="chart-line"]')).toBeNull();
  });

  it('offers a choice of node only when more than one can be projected', () => {
    draw(demo());
    expect(screen.getByText('Projection for')).toBeInTheDocument();
  });

  it('says so with no nodes, not an empty plot', () => {
    draw(withRows([]));
    expect(screen.getByText('No disks to forecast')).toBeInTheDocument();
  });

  it('a failed chart says the server’s sentence and draws no rows', () => {
    const { id, title, question, section } = demo();
    draw({ id, title, question, section, ok: false, error: 'Prometheus refused the disk query (HTTP 400)' });
    expect(screen.getByText('Prometheus refused the disk query (HTTP 400)')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="ranked-bars-row"]')).toBeNull();
  });

  it('dims while the next range is read', () => {
    draw(demo(), true);
    expect(document.querySelector('[data-chart="disk-runway"] [data-slot="chart-body"]')).toHaveAttribute('aria-busy', 'true');
  });
});
