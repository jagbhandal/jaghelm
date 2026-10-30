import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DailyBars } from '@ui/daily-bars';

const qa = (sel) => [...document.querySelectorAll(sel)];
const q = (sel) => document.querySelector(sel);
const NOT_SLOT_1 =
  /(^|\s)(stroke|fill|text|bg)-(series-[2-6]|meter|accent|ok|warn|crit|unknown|maintenance|info)(-|\s|$)/;

const money = (v) => `$${v.toFixed(2)}`;
// Local midnights, so day names read the same in every time zone.
const DAYS = [26, 27, 28, 29].map((d, i) => ({
  key: `d${d}`,
  time: new Date(2026, 9, d).getTime(),
  value: [2.1, 2.4, 1.8, 0.9][i],
  note: `Rate $0.${12 + (i > 1 ? 1 : 0)}/kWh`,
}));

afterEach(() => vi.restoreAllMocks());

describe('DailyBars', () => {
  it('draws a slot 1 bar a day from 0, with a value axis and day labels', () => {
    render(<DailyBars label="Cost per day" days={DAYS} formatValue={money} />);
    const bars = qa('[data-slot="daily-bars-bar"]');
    expect(bars).toHaveLength(4);
    for (const b of bars) expect(b).toHaveClass('fill-series-1');
    expect(bars[0]).not.toHaveAttribute('data-partial');
    // Taller for a bigger day.
    expect(Number(bars[1].getAttribute('height'))).toBeGreaterThan(
      Number(bars[0].getAttribute('height'))
    );
    expect(q('[data-slot="daily-bars-y"]').textContent).toMatch(/\$0\.00/);
    expect(q('[data-slot="daily-bars-x"]').textContent).toContain('29 Thu');
    for (const el of qa('[data-slot="daily-bars"] svg *')) {
      expect(el.getAttribute('class') ?? '').not.toMatch(NOT_SLOT_1);
    }
  });

  it('draws the partial last bar lighter and says "so far" in the line, the summary and the reading', () => {
    render(<DailyBars label="Cost per day" days={DAYS} formatValue={money} partial />);
    const bars = qa('[data-slot="daily-bars-bar"]');
    expect(bars.at(-1)).toHaveAttribute('data-partial');
    expect(bars.at(-1)).toHaveClass('fill-series-1/40', 'stroke-series-1');
    expect(bars.at(-1)).toHaveAttribute('stroke-dasharray');
    expect(bars[0]).not.toHaveAttribute('data-partial');
    expect(q('[data-slot="daily-bars-partial"]').textContent).toContain('$0.90 so far');
    expect(screen.getByRole('img', { name: 'Cost per day' })).toHaveAccessibleDescription(
      /^Latest Thu, Oct 29: \$0\.90 so far, Rate \$0\.13\/kWh\. Lowest \$0\.90, highest \$2\.40\./
    );
  });

  it('shows the day, the value and the caller’s extra line in the tooltip on hover', () => {
    render(<DailyBars label="Cost per day" days={DAYS} formatValue={money} partial />);
    const plot = q('[data-slot="daily-bars-plot"]');
    plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 112, right: 400 });
    // Width falls back to 400 in jsdom: four slots of 100.
    fireEvent.pointerMove(plot, { clientX: 150, pointerType: 'mouse' });
    const tip = q('[data-slot="daily-bars-tooltip"]');
    expect(tip.textContent).toBe('Tue, Oct 27$2.40Rate $0.12/kWh');
    expect(tip).toHaveAttribute('aria-hidden', 'true');
    expect(q('[data-slot="daily-bars-crosshair"]')).not.toBeNull();
    fireEvent.pointerMove(plot, { clientX: 390, pointerType: 'mouse' });
    expect(q('[data-slot="daily-bars-tooltip"]').textContent).toBe(
      'Thu, Oct 29$0.90so farRate $0.13/kWh'
    );
    fireEvent.pointerLeave(plot);
    expect(q('[data-slot="daily-bars-tooltip"]')).toBeNull();
  });

  it('opens no tooltip for a touch pointer', () => {
    render(<DailyBars label="Cost per day" days={DAYS} formatValue={money} />);
    fireEvent.pointerMove(q('[data-slot="daily-bars-plot"]'), {
      clientX: 10,
      pointerType: 'touch',
    });
    expect(q('[data-slot="daily-bars-tooltip"]')).toBeNull();
  });

  it('reads days with the keyboard: starts at the latest, arrows move, Escape hides', async () => {
    const user = userEvent.setup();
    render(<DailyBars label="Cost per day" days={DAYS} formatValue={money} partial />);
    await user.tab();
    expect(screen.getByRole('img', { name: 'Cost per day' })).toHaveFocus();
    expect(q('[data-slot="daily-bars-tooltip"]').textContent).toContain('Thu, Oct 29');
    await user.keyboard('{ArrowLeft}');
    expect(q('[data-slot="daily-bars-tooltip"]').textContent).toContain('Wed, Oct 28');
    expect(q('[aria-live="polite"]').textContent).toBe('Wed, Oct 28: $1.80, Rate $0.13/kWh');
    await user.keyboard('{Home}');
    expect(q('[data-slot="daily-bars-tooltip"]').textContent).toContain('Mon, Oct 26');
    await user.keyboard('{End}');
    expect(q('[aria-live="polite"]').textContent).toBe('Thu, Oct 29: $0.90 so far, Rate $0.13/kWh');
    await user.keyboard('{Escape}');
    expect(q('[data-slot="daily-bars-tooltip"]')).toBeNull();
  });

  it('draws no bar for a missing day and says No data', () => {
    const gap = [DAYS[0], { ...DAYS[1], value: null }, DAYS[2]];
    render(<DailyBars label="Cost per day" days={gap} formatValue={money} />);
    expect(qa('[data-slot="daily-bars-bar"]')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'Cost per day' })).toBeInTheDocument();
  });

  it('says loading, failed and empty in words', () => {
    const { rerender } = render(<DailyBars label="Cost" days={[]} state="loading" />);
    expect(screen.getByText('Cost: loading')).toBeInTheDocument();
    rerender(<DailyBars label="Cost" days={DAYS} state="failed" detail="Prometheus is down" />);
    expect(screen.getByRole('img', { name: 'Cost: No data from Prometheus' })).toBeInTheDocument();
    expect(screen.getByText('Prometheus is down')).toBeInTheDocument();
    expect(qa('[data-slot="daily-bars-bar"]')).toHaveLength(0);
    rerender(<DailyBars label="Cost" days={[]} emptyText="No days yet" />);
    expect(screen.getByRole('img', { name: 'Cost: No days yet' })).toBeInTheDocument();
  });

  it('refuses a missing label', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<DailyBars days={DAYS} />)).toThrow(/needs a `label`/);
    error.mockRestore();
  });
});
