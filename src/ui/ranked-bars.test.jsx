import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { RankedBars } from '@ui/ranked-bars';

const qa = (sel) => [...document.querySelectorAll(sel)];
const NOT_SLOT_1 =
  /(^|\s)(stroke|fill|text|bg)-(series-[2-6]|meter|accent|ok|warn|crit|unknown|maintenance|info)(-|\s|$)/;

const days = (v) => `${v} days`;
const at = (h, m) => new Date(2026, 9, 20, h, m).getTime();
const ROWS = [
  {
    key: 'nas',
    name: 'JagNAS volume 1',
    value: 9,
    state: 'crit',
    points: [
      { time: at(8, 0), value: 30 },
      { time: at(8, 30), value: 20 },
      { time: at(9, 0), value: 9 },
    ],
  },
  { key: 'pve', name: 'pve local-lvm', value: 41, state: 'warn' },
  { key: 'vm', name: 'vm-103 rootfs', value: 120 },
];

afterEach(() => vi.restoreAllMocks());

describe('RankedBars', () => {
  it('keeps the order given and prints every row’s value as text', () => {
    render(<RankedBars label="Days until full" rows={ROWS} formatValue={days} />);
    const rows = qa('[data-slot="ranked-bars-row"]');
    expect(rows.map((r) => r.dataset.key)).toEqual(['nas', 'pve', 'vm']);
    expect(qa('[data-slot="ranked-bars-value"]').map((v) => v.textContent)).toEqual([
      '9 days',
      '41 days',
      '120 days',
    ]);
  });

  it('scales bars from 0 to the largest value, or to `max`', () => {
    const { rerender } = render(<RankedBars label="Days" rows={ROWS} formatValue={days} />);
    const widths = () => qa('[data-slot="ranked-bars-bar"]').map((b) => b.getAttribute('width'));
    expect(parseFloat(widths()[2])).toBe(100);
    expect(parseFloat(widths()[0])).toBeCloseTo(7.5, 1);
    rerender(<RankedBars label="Days" rows={ROWS} formatValue={days} max={240} />);
    expect(parseFloat(widths()[2])).toBe(50);
  });

  it('draws every bar in slot 1, flagged or not, and a flagged row carries a lamp', () => {
    render(<RankedBars label="Days until full" rows={ROWS} formatValue={days} />);
    for (const bar of qa('[data-slot="ranked-bars-bar"]')) {
      expect(bar).toHaveClass('fill-series-1');
    }
    for (const el of document.querySelectorAll('[data-slot="ranked-bars"] svg *')) {
      if (el.closest('[data-slot="status-lamp"]')) continue;
      expect(el.getAttribute('class') ?? '').not.toMatch(NOT_SLOT_1);
    }
    const lamps = qa('[data-slot="status-lamp"]');
    expect(lamps.map((l) => l.dataset.state)).toEqual(['crit', 'warn']);
    // The row without a lamp keeps the name column aligned.
    expect(
      qa('[data-slot="ranked-bars-row"]')[2].querySelector('[data-slot="status-lamp"]')
    ).toBeNull();
  });

  it('draws a sparkline for a row with points, decorative', () => {
    render(<RankedBars label="Days until full" rows={ROWS} formatValue={days} />);
    expect(qa('[data-slot="sparkline"]')).toHaveLength(1);
    expect(qa('[data-slot="sparkline"]')[0]).toHaveAttribute('aria-hidden', 'true');
    expect(qa('[data-slot="sparkline-line"]')[0]).toHaveClass('stroke-series-1');
  });

  it('uses valueText over formatValue, and says No data for a missing value', () => {
    render(
      <RankedBars
        label="Growth"
        rows={[
          { key: 'a', name: 'netdata', value: 5e8, valueText: '+480 MB' },
          { key: 'b', name: 'loki', value: null },
        ]}
      />
    );
    expect(qa('[data-slot="ranked-bars-value"]').map((v) => v.textContent)).toEqual([
      '+480 MB',
      'No data',
    ]);
    expect(qa('[data-slot="ranked-bars-bar"]')).toHaveLength(1);
  });

  it('is one image with a text summary of every row, status included', () => {
    render(<RankedBars label="Days until full" rows={ROWS} formatValue={days} />);
    expect(screen.getByRole('img', { name: 'Days until full' })).toHaveAccessibleDescription(
      'Ranked as listed. 1, JagNAS volume 1, 9 days, Critical. 2, pve local-lvm, 41 days, Warning. 3, vm-103 rootfs, 120 days. The arrow keys read each row.'
    );
  });

  it('reads rows with the keyboard: starts at the first, arrows move, Escape clears', async () => {
    const user = userEvent.setup();
    render(<RankedBars label="Days until full" rows={ROWS} formatValue={days} />);
    const img = screen.getByRole('img', { name: 'Days until full' });
    const active = () => qa('[data-active]').map((r) => r.dataset.key);
    await user.tab();
    expect(img).toHaveFocus();
    expect(active()).toEqual(['nas']);
    await user.keyboard('{ArrowDown}');
    expect(active()).toEqual(['pve']);
    expect(document.querySelector('[aria-live="polite"]').textContent).toBe(
      '2 of 3, pve local-lvm, 41 days, Warning'
    );
    await user.keyboard('{End}');
    expect(active()).toEqual(['vm']);
    await user.keyboard('{Home}{ArrowUp}');
    expect(active()).toEqual(['nas']);
    await user.keyboard('{Escape}');
    expect(active()).toEqual([]);
  });

  it('says loading, failed and empty in words, never an empty list', () => {
    const { rerender } = render(<RankedBars label="Days" rows={[]} state="loading" />);
    expect(screen.getByText('Days: loading')).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    rerender(<RankedBars label="Days" rows={ROWS} state="failed" detail="Prometheus is down" />);
    expect(screen.getByRole('img', { name: 'Days: No data from Prometheus' })).toBeInTheDocument();
    expect(screen.getByText('Prometheus is down')).toBeInTheDocument();
    expect(qa('[data-slot="ranked-bars-row"]')).toHaveLength(0);
    rerender(<RankedBars label="Days" rows={[]} />);
    expect(screen.getByRole('img', { name: 'Days: Nothing to rank' })).toBeInTheDocument();
  });

  it('refuses a missing label', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<RankedBars rows={ROWS} />)).toThrow(/needs a `label`/);
    error.mockRestore();
  });

  it('highlights a row under the pointer by hover class only', () => {
    render(<RankedBars label="Days" rows={ROWS} formatValue={days} />);
    fireEvent.pointerMove(qa('[data-slot="ranked-bars-row"]')[0]);
    expect(qa('[data-slot="ranked-bars-row"]')[0]).toHaveClass('hover:bg-row-hover');
  });
});
