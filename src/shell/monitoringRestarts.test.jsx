/**
 * The Restarts and OOM kills drawing (#761): the strip's rows and marks from
 * the server's events, and a gap, a failure and the source's limits said in
 * words, never an empty plot that looks healthy.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { UiRoot } from '@ui/root';
import { ChartPanel } from './MonitoringPage.jsx';
import { MAX_STRIP_ROWS, stepWords, stripRows } from './monitoringDrawings.jsx';
import { monitoringRangeOf } from './monitoring.js';
import { demoMonitoring } from '../../server/demoFixtures.js';

const NOW = Date.parse('2026-10-29T12:00:00Z');
const demo = (range) => demoMonitoring({ query: { range }, now: NOW }).body.charts.find((c) => c.id === 'restarts');
const draw = (chart, range = '24h') =>
  render(
    <UiRoot>
      <ChartPanel chart={chart} range={monitoringRangeOf(range)} busy={false} />
    </UiRoot>
  );
const card = () => document.querySelector('[data-chart="restarts"]');

describe('stripRows', () => {
  const e = (node, name, kind = 'restart', time = 1) => ({ node, name, kind, time, how: 'process restarted', count: 1 });

  it('makes one row per container with the node in the tooltip words, and names the node only when two share a name', () => {
    const { rows } = stripRows([e('apps', 'jellyfin'), e('apps', 'jellyfin', 'oom', 2), e('apps', 'cadvisor'), e('edge', 'cadvisor')]);
    expect(rows.map((r) => r.name)).toEqual(['cadvisor (apps)', 'cadvisor (edge)', 'jellyfin']);
    const jelly = rows.find((r) => r.name === 'jellyfin');
    expect(jelly.events.map((x) => [x.kind, x.detail])).toEqual([
      ['restart', 'process restarted on apps'],
      ['oom', 'OOM kill on apps'],
    ]);
  });

  it('keeps the busiest containers when there are too many, and counts the rest', () => {
    const many = Array.from({ length: MAX_STRIP_ROWS + 3 }, (_, i) => e('apps', `c${String(i).padStart(2, '0')}`));
    many.push(e('apps', 'c14', 'restart', 5), e('apps', 'c14', 'restart', 6));
    const { rows, left } = stripRows(many);
    expect(rows).toHaveLength(MAX_STRIP_ROWS);
    expect(left).toBe(3);
    expect(rows.map((r) => r.name)).toContain('c14');
  });

  it('says a step in words', () => {
    expect([60_000, 300_000, 1_800_000, 3_600_000, 7_200_000].map(stepWords)).toEqual([
      '1 minute', '5 minutes', '30 minutes', '1 hour', '2 hours',
    ]);
  });
});

describe('Restarts and OOM kills', () => {
  it('draws a row per container, a circle for a restart and a cross for an OOM kill, and says what the source cannot see', () => {
    draw(demo('24h'));
    const strip = card().querySelector('[data-slot="event-strip"]');
    const names = [...strip.querySelectorAll('[data-slot="event-strip-name"]')].map((n) => n.textContent);
    expect(names).toEqual(['backrest', 'jellyfin', 'nextcloud', 'paperless-ngx', 'photoprism']);
    expect(strip.querySelector('[data-slot="event-strip-mark"][data-kind="restart"]').getAttribute('data-shape')).toBe('circle');
    expect(strip.querySelector('[data-slot="event-strip-mark"][data-kind="oom"]').getAttribute('data-shape')).toBe('cross');
    expect(within(card()).getByRole('img', { name: /Restarts and OOM kills, last 24 hours/ })).toBeInTheDocument();
    expect(card().querySelector('[data-slot="restarts-limit"]').textContent).toMatch(
      /^Read from cAdvisor through Prometheus, to the nearest 5 minutes\..*a plain docker restart is not always visible\.$/
    );
  });

  it('lists the events as text for a screen reader: container, kind, time', () => {
    draw(demo('24h'));
    const items = [...card().querySelectorAll('[data-slot="event-strip-list"] li')].map((li) => li.textContent);
    expect(items.some((t) => /^paperless-ngx: OOM kill at .*2 OOM kills on apps$/.test(t))).toBe(true);
  });

  it('with no event in range says so in words, and a container with none is not listed', () => {
    draw({ ...demo('24h'), events: [] });
    expect(card().querySelector('[data-slot="event-strip"]').getAttribute('data-state')).toBe('empty');
    expect(screen.getByText('No restarts or OOM kills seen in the last 24 hours')).toBeInTheDocument();
  });

  it('a missing reading is a gap, not a quiet spell: no containers, a node without readings, no OOM counter', () => {
    const chart = demo('24h');
    const { unmount } = draw({ ...chart, state: 'no-containers', events: [] });
    expect(screen.getByText('No container readings')).toBeInTheDocument();
    expect(card().textContent).toMatch(/whether anything restarted is unknown/);
    expect(card().querySelector('[data-slot="event-strip"]')).toBeNull();
    unmount();
    draw({ ...chart, blindNodes: ['nas', 'edge'], oomCounter: false });
    const notes = [...card().querySelectorAll('[data-slot="restarts-note"]')].map((n) => n.textContent);
    expect(notes).toEqual([
      'No container readings from nas, edge in this range, so restarts there are not shown.',
      'cAdvisor exports no OOM counter here, so OOM kills are not shown.',
    ]);
  });

  it('a failed read is the server\'s sentence, not an empty strip', () => {
    const { id, title, question, section } = demo('24h');
    draw({ id, title, question, section, ok: false, error: 'Prometheus refused the connection' });
    expect(screen.getByText('Prometheus refused the connection')).toBeInTheDocument();
    expect(card().querySelector('[data-slot="event-strip"]').getAttribute('data-state')).toBe('failed');
  });

  it('says when events were cut', () => {
    draw({ ...demo('30d'), truncated: true }, '30d');
    expect(screen.getByText('So many events that only the latest are drawn.')).toBeInTheDocument();
    expect(card().querySelector('[data-slot="restarts-limit"]').textContent).toMatch(/nearest 2 hours/);
  });
});
