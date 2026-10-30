import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventStrip, SHAPES } from '@ui/event-strip';
import { Chart, ChartGroup } from '@ui/chart';

const q = (sel) => document.querySelector(sel);
const qa = (sel) => [...document.querySelectorAll(sel)];
const NOT_A_SLOT =
  /(^|\s)(stroke|fill|text|bg)-(meter|accent|ok|warn|crit|unknown|maintenance|info)(-|\s|$)/;

// Local times, so the default HH:MM reads the same in every time zone.
const at = (h, m) => new Date(2026, 9, 20, h, m).getTime();
const FROM = at(8, 0);
const TO = at(9, 0);

const ROWS = [
  {
    key: 'api',
    name: 'api',
    events: [
      { time: at(8, 10), kind: 'restart', detail: 'exit 1' },
      { time: at(8, 40), kind: 'oom', detail: 'killed at 512 MB' },
    ],
  },
  { key: 'quiet', name: 'quiet', events: [] },
  { key: 'worker', name: 'worker', events: [{ time: at(8, 25), kind: 'restart' }] },
];

const strip = (props) => (
  <EventStrip label="Restarts, last hour" rows={ROWS} from={FROM} to={TO} {...props} />
);

afterEach(() => vi.restoreAllMocks());

describe('EventStrip', () => {
  it('draws one row per entity with events, and leaves out a row with none', () => {
    render(strip());
    expect(qa('[data-slot="event-strip-name"]').map((n) => n.textContent)).toEqual([
      'api',
      'worker',
    ]);
    expect(q('[data-slot="event-strip"]')).toHaveAttribute('data-rows', '2');
    expect(qa('[data-slot="event-strip-mark"]')).toHaveLength(3);
  });

  it('tells kinds by shape, and the colour follows the row’s slot, never a status', () => {
    render(strip());
    const marks = qa('[data-slot="event-strip-mark"]');
    const shapes = marks.map((m) => `${m.dataset.kind}:${m.dataset.shape}`);
    expect(shapes).toEqual(['restart:circle', 'restart:circle', 'oom:cross']);
    expect(new Set(marks.map((m) => m.getAttribute('d').slice(0, 1) + m.dataset.shape)).size).toBe(
      2
    );
    // api is slot 1, worker is slot 3 (its place in the list): the quiet row keeps its place too.
    // The marks are in time order: api 08:10, worker 08:25, api 08:40.
    expect(marks[0]).toHaveClass('fill-series-1');
    expect(marks[1]).toHaveClass('fill-series-3');
    expect(marks[2]).toHaveClass('stroke-series-1');
    marks.forEach((m) => expect(m.getAttribute('class')).not.toMatch(NOT_A_SLOT));
    expect(SHAPES).toContain('cross');
  });

  it('a row’s own slot wins; a seventh row falls back to text-2', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      key: `r${i}`,
      name: `r${i}`,
      slot: i === 0 ? 4 : undefined,
      events: [{ time: at(8, 10 + i), kind: 'restart' }],
    }));
    render(strip({ rows }));
    const marks = qa('[data-slot="event-strip-mark"]');
    expect(marks[0]).toHaveClass('fill-series-5');
    expect(marks[6]).toHaveClass('fill-text-2');
  });

  it('a legend names each kind that is drawn, with its shape', () => {
    render(strip({ rows: [ROWS[2]] }));
    const items = qa('[data-slot="event-strip-legend"] li');
    expect(items.map((i) => i.textContent)).toEqual(['Restart']);
    render(strip());
    expect(qa('[data-slot="event-strip-legend"]').at(-1).querySelectorAll('li')).toHaveLength(2);
  });

  it('a custom kind list sets the words and shapes', () => {
    render(
      strip({
        kinds: [
          { key: 'restart', word: 'Started again', shape: 'square' },
          { key: 'oom', word: 'Out of memory', shape: 'triangle' },
        ],
      })
    );
    expect(qa('[data-slot="event-strip-mark"]').map((m) => m.dataset.shape)).toEqual([
      'square',
      'square',
      'triangle',
    ]);
    expect(q('[data-slot="event-strip-legend"]').textContent).toBe('Started againOut of memory');
  });

  it('ignores events outside from and to', () => {
    render(
      strip({
        rows: [
          { key: 'a', name: 'a', events: [{ time: at(7, 0), kind: 'restart' }] },
          { key: 'b', name: 'b', events: [{ time: at(8, 30), kind: 'oom' }] },
        ],
      })
    );
    expect(qa('[data-slot="event-strip-name"]').map((n) => n.textContent)).toEqual(['b']);
  });

  it('with no event in range, says the caller’s empty-state text', () => {
    render(
      strip({ rows: ROWS.slice(1, 2), emptyText: 'No restarts or OOM kills in the last hour' })
    );
    expect(q('[data-slot="event-strip"]')).toHaveAttribute('data-state', 'empty');
    expect(q('[data-slot="event-strip-message"]')).toHaveTextContent(
      'No restarts or OOM kills in the last hour'
    );
    expect(
      screen.getByRole('img', {
        name: 'Restarts, last hour: No restarts or OOM kills in the last hour',
      })
    ).toBeInTheDocument();
    expect(q('[data-slot="event-strip-mark"]')).toBeNull();
  });

  it('loading is a placeholder; failed says why, never an empty strip', () => {
    const { unmount } = render(strip({ state: 'loading' }));
    expect(q('[data-slot="event-strip"]')).toHaveAttribute('data-state', 'loading');
    expect(q('[aria-busy="true"]')).not.toBeNull();
    unmount();
    render(strip({ state: 'failed', detail: 'Prometheus refused the connection' }));
    expect(q('[data-slot="event-strip-message"]')).toHaveTextContent('No data from Prometheus');
    expect(q('[data-slot="event-strip-detail"]')).toHaveTextContent(
      'Prometheus refused the connection'
    );
    expect(q('[data-slot="event-strip-mark"]')).toBeNull();
  });

  it('is an image named by its label, with a count, and a text list of every event', () => {
    render(strip());
    const plot = screen.getByRole('img', { name: 'Restarts, last hour' });
    expect(plot).toHaveAccessibleDescription(
      '3 events in 2 rows, latest 08:40. The arrow keys step through them.'
    );
    expect(qa('[data-slot="event-strip-list"] li').map((li) => li.textContent)).toEqual([
      'api: Restart at 08:10, exit 1',
      'worker: Restart at 08:25',
      'api: OOM kill at 08:40, killed at 512 MB',
    ]);
  });

  it('keyboard: focus marks the latest event; arrows, Home and End step in time order; Escape hides', async () => {
    const user = userEvent.setup();
    render(strip());
    await user.tab();
    const plot = q('[data-slot="event-strip-plot"]');
    expect(plot).toHaveFocus();
    // Latest is api's OOM kill at 08:40.
    expect(q('[data-slot="event-strip-tooltip"]').textContent).toBe(
      '08:40OOM killapikilled at 512 MB'
    );
    expect(q('[data-slot="event-strip-ring"]')).not.toBeNull();
    expect(q('[data-slot="event-strip-crosshair"]')).not.toBeNull();
    await user.keyboard('{ArrowLeft}');
    expect(q('[data-slot="event-strip-tooltip"]').textContent).toBe('08:25Restartworker');
    expect(
      screen.getByText('worker: Restart at 08:25', { selector: '[aria-live]' })
    ).toBeInTheDocument();
    await user.keyboard('{Home}');
    expect(q('[data-slot="event-strip-tooltip"]').textContent).toContain('08:10');
    await user.keyboard('{ArrowLeft}');
    expect(q('[data-slot="event-strip-tooltip"]').textContent).toContain('08:10');
    await user.keyboard('{End}');
    expect(q('[data-slot="event-strip-tooltip"]').textContent).toContain('08:40');
    await user.keyboard('{Escape}');
    expect(q('[data-slot="event-strip-tooltip"]')).toBeNull();
    await user.keyboard('{ArrowLeft}');
    expect(q('[data-slot="event-strip-tooltip"]')).not.toBeNull();
  });

  it('the tooltip is hidden from assistive tech', async () => {
    const user = userEvent.setup();
    render(strip());
    await user.tab();
    expect(q('[data-slot="event-strip-tooltip"]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('pointer: the event under it gets the tooltip; empty space gets none', () => {
    render(strip());
    const plot = q('[data-slot="event-strip-plot"]');
    plot.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 68,
      right: 400,
      bottom: 68,
    });
    // 08:10 of 08:00-09:00 on 400px is x 66.67; api's row centre is y 6 + 14.
    fireEvent.pointerMove(plot, { clientX: 67, clientY: 20, pointerType: 'mouse' });
    expect(q('[data-slot="event-strip-tooltip"]').textContent).toContain('08:10');
    fireEvent.pointerMove(plot, { clientX: 300, clientY: 20, pointerType: 'mouse' });
    expect(q('[data-slot="event-strip-tooltip"]')).toBeNull();
    fireEvent.pointerMove(plot, { clientX: 67, clientY: 20, pointerType: 'mouse' });
    fireEvent.pointerLeave(plot);
    expect(q('[data-slot="event-strip-tooltip"]')).toBeNull();
  });

  it('time ticks come from the shared helpers, centred; a label that would run off is left out', () => {
    render(strip());
    expect(q('[data-slot="event-strip-x"]').textContent).toBe('08:1508:3008:45');
  });

  it('in a ChartGroup it takes the group’s columns as a subgrid, on the chart’s own axis', () => {
    const points = [FROM, at(8, 15), at(8, 30), at(8, 45), TO].map((time, i) => ({
      time,
      value: 10 * i,
    }));
    render(
      <ChartGroup>
        <Chart label="CPU" series={[{ key: 'c', name: 'CPU', points }]} />
        {strip()}
      </ChartGroup>
    );
    const el = q('[data-slot="event-strip"]');
    expect(el).toHaveClass('col-span-full', 'grid-cols-subgrid');
    expect(q('[data-slot="event-strip-axes"]')).toHaveClass('grid-cols-subgrid');
    expect(q('[data-slot="event-strip-x"]').textContent).toBe(
      q('[data-slot="chart-x"]').textContent
    );
  });

  it('without from and to, the axis fits the events', () => {
    render(<EventStrip label="Restarts" rows={ROWS} />);
    expect(qa('[data-slot="event-strip-mark"]')).toHaveLength(3);
  });

  it('a row with one event alone still draws', () => {
    render(
      <EventStrip
        label="Restarts"
        rows={[{ key: 'a', name: 'a', events: [{ time: at(8, 10), kind: 'restart' }] }]}
      />
    );
    expect(qa('[data-slot="event-strip-mark"]')).toHaveLength(1);
  });

  it('without a label it logs in production', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('DEV', false);
    render(<EventStrip label="" rows={ROWS} from={FROM} to={TO} />);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('needs a `label`'));
    vi.unstubAllEnvs();
  });
});
