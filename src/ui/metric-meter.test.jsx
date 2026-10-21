import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MetricMeter, meterState } from '@ui/metric-meter';

const fill = (meter) => meter.querySelector('[data-slot="meter-fill"]');
const ticks = (meter) => [...meter.querySelectorAll('[data-slot="meter-tick"]')];
const threshold = (meter) => meter.querySelector('[data-slot="meter-threshold"]');
const STATUS_FILLS = /(^|\s)bg-(ok|warn|crit|unknown|maintenance|info)-solid(\s|$)/;

describe('meterState', () => {
  it('is ok below every threshold, warn at or above warn, crit at or above crit', () => {
    const disk = { warn: 90, crit: 95 }; // spec §6.1, node disk
    expect(meterState(0, disk)).toBe('ok');
    expect(meterState(89.9, disk)).toBe('ok');
    expect(meterState(90, disk)).toBe('warn');
    expect(meterState(94.9, disk)).toBe('warn');
    expect(meterState(95, disk)).toBe('crit');
    expect(meterState(140, disk)).toBe('crit');
  });

  it('reads only the thresholds it is given', () => {
    expect(meterState(99, { warn: 90 })).toBe('warn'); // CPU and memory: no crit
    expect(meterState(99, { crit: 95 })).toBe('crit');
    expect(meterState(99, {})).toBe('ok');
    expect(meterState(99)).toBe('ok');
  });

  it('is no signal without a reading', () => {
    for (const v of [null, undefined, NaN, '92']) {
      expect(meterState(v, { warn: 90 })).toBe('unknown');
    }
  });
});

describe('MetricMeter', () => {
  it("fills with the accent's meter colour below its threshold, the value in text-1", () => {
    render(<MetricMeter label="Memory" value={61} warn={90} />);
    const meter = screen.getByRole('meter', { name: 'Memory' });
    expect(fill(meter)).toHaveClass('bg-meter');
    expect(fill(meter).className).not.toMatch(STATUS_FILLS);
    expect(screen.getByText('61%')).toHaveClass('text-text-1', 'font-bold', 'text-body-sm');
    expect(meter).toHaveAttribute('data-state', 'ok');
  });

  it('turns to a status colour only at or above a threshold: warn-solid, then crit-solid', () => {
    const cases = [
      [89, 'ok', 'bg-meter', 'text-text-1'],
      [90, 'warn', 'bg-warn-solid', 'text-warn-fg'],
      [92, 'warn', 'bg-warn-solid', 'text-warn-fg'],
      [95, 'crit', 'bg-crit-solid', 'text-crit-fg'],
      [100, 'crit', 'bg-crit-solid', 'text-crit-fg'],
    ];
    for (const [value, state, fillClass, word] of cases) {
      const { unmount } = render(<MetricMeter label="Disk" value={value} warn={90} crit={95} />);
      const meter = screen.getByRole('meter', { name: 'Disk' });
      expect(meter, `${value}%`).toHaveAttribute('data-state', state);
      expect(fill(meter), `${value}%`).toHaveClass(fillClass);
      expect(screen.getByText(`${value}%`), `${value}%`).toHaveClass(word);
      unmount();
    }
  });

  it('reads thresholds in its own unit: a temperature turns at 75 °C and 85 °C', () => {
    const { rerender } = render(
      <MetricMeter label="Temp" value={74} unit="°C" warn={75} crit={85} />
    );
    expect(fill(screen.getByRole('meter'))).toHaveClass('bg-meter');
    rerender(<MetricMeter label="Temp" value={78} unit="°C" warn={75} crit={85} />);
    expect(fill(screen.getByRole('meter'))).toHaveClass('bg-warn-solid');
    expect(screen.getByText('78°C')).toHaveClass('text-warn-fg');
    rerender(<MetricMeter label="Temp" value={86} unit="°C" warn={75} crit={85} />);
    expect(fill(screen.getByRole('meter'))).toHaveClass('bg-crit-solid');
  });

  it("takes the server's state over its thresholds (hysteresis keeps a warning to 85 %)", () => {
    render(<MetricMeter label="Disk" value={87} warn={90} crit={95} state="warn" />);
    const meter = screen.getByRole('meter', { name: 'Disk' });
    expect(fill(meter)).toHaveClass('bg-warn-solid');
    expect(screen.getByText('87%')).toHaveClass('text-warn-fg');
    expect(meter).toHaveAttribute('aria-valuetext', '87%, warning');
  });

  it('is a meter named by its label, its value and any threshold it passed said in words', () => {
    const { rerender } = render(<MetricMeter label="Disk" value={92} warn={90} crit={95} />);
    const meter = screen.getByRole('meter', { name: 'Disk' });
    expect(meter).toHaveAttribute('aria-valuenow', '92');
    expect(meter).toHaveAttribute('aria-valuemin', '0');
    expect(meter).toHaveAttribute('aria-valuemax', '100');
    expect(meter).toHaveAttribute('aria-valuetext', '92%, warning above 90%');
    rerender(<MetricMeter label="Disk" value={96} warn={90} crit={95} />);
    expect(meter).toHaveAttribute('aria-valuetext', '96%, critical above 95%');
    rerender(<MetricMeter label="Disk" value={40} warn={90} crit={95} />);
    expect(meter).toHaveAttribute('aria-valuetext', '40%');
  });

  it("clamps the fill to the track, as UsageBar did, and keeps the reading's own value", () => {
    const { rerender } = render(<MetricMeter label="CPU" value={45.3} valueText="45.3%" />);
    expect(fill(screen.getByRole('meter'))).toHaveStyle({ width: '45.3%' });
    rerender(<MetricMeter label="CPU" value={130} />);
    expect(fill(screen.getByRole('meter'))).toHaveStyle({ width: '100%' });
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('130%')).toBeInTheDocument();
    rerender(<MetricMeter label="CPU" value={-4} />);
    expect(fill(screen.getByRole('meter'))).toHaveStyle({ width: '0%' });
    rerender(<MetricMeter label="Load" value={50} max={200} unit="" />);
    expect(fill(screen.getByRole('meter'))).toHaveStyle({ width: '25%' });
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuemax', '200');
  });

  it("prints the value rounded down unless given its own text: the model's one rule (#450)", () => {
    const { rerender } = render(<MetricMeter label="CPU" value={33.6} />);
    expect(screen.getByText('33%')).toBeInTheDocument();
    rerender(<MetricMeter label="CPU" value={33.6} valueText="33.6 %" />);
    expect(screen.getByText('33.6 %')).toBeInTheDocument();
  });

  it('never prints a number at or over a line the reading is under: 94.6 % by a 95 % line is 94 (#450)', () => {
    const cases = [
      [94.6, '94%', 'warn', '94%, warning above 90%'],
      [95, '95%', 'crit', '95%, critical above 95%'],
      [95.4, '95%', 'crit', '95%, critical above 95%'],
      [89.9, '89%', 'ok', '89%'],
    ];
    for (const [value, shown, state, said] of cases) {
      const { unmount } = render(<MetricMeter label="Disk" value={value} warn={90} crit={95} />);
      const meter = screen.getByRole('meter', { name: 'Disk' });
      expect(screen.getByText(shown), `${value}`).toBeInTheDocument();
      expect(meter, `${value}`).toHaveAttribute('data-state', state);
      expect(meter, `${value}`).toHaveAttribute('aria-valuetext', said);
      unmount();
    }
  });

  it("beside a line with a fraction, prints the reading to that line's decimals (#450)", () => {
    const cases = [
      [87.4, '87.4%', 'ok'],
      [87.5, '87.5%', 'warn'],
      [87.6, '87.6%', 'warn'],
      [92, '92%', 'warn'],
    ];
    for (const [value, shown, state] of cases) {
      const { unmount } = render(<MetricMeter label="Disk" value={value} warn={87.5} crit={95} />);
      expect(screen.getByText(shown), `${value}`).toBeInTheDocument();
      expect(screen.getByRole('meter'), `${value}`).toHaveAttribute('data-state', state);
      unmount();
    }
    expect(
      render(<MetricMeter label="Disk" value={87.6} warn={87.5} crit={95} />).container.firstChild
    ).toHaveAttribute('aria-valuetext', '87.6%, warning above 87.5%');
  });

  it('takes the hysteresis as `band`, so a reading held over a fractional clear line reads over it (#450)', () => {
    render(<MetricMeter label="Disk" value={87.6} warn={90} crit={95} band={2.5} state="warn" />);
    const meter = screen.getByRole('meter', { name: 'Disk' });
    expect(screen.getByText('87.6%')).toHaveClass('text-warn-fg');
    expect(meter).not.toHaveAttribute('band');
  });

  it("has no reading: an empty track, a no-signal dash, said as 'No data', never a meter", () => {
    for (const value of [null, undefined]) {
      const { container, unmount } = render(<MetricMeter label="Temp" value={value} warn={75} />);
      expect(screen.queryByRole('meter')).toBeNull();
      const root = container.firstChild;
      expect(root).toHaveAttribute('data-state', 'unknown');
      expect(fill(root)).toBeNull();
      expect(root.querySelector('[data-slot="meter-track"]')).toHaveClass('bg-track');
      const dash = screen.getByText('—');
      expect(dash).toHaveClass('text-unknown-fg');
      expect(dash).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByText('No data')).toHaveClass('sr-only');
      expect(screen.getByText('Temp')).toBeInTheDocument();
      unmount();
    }
  });

  it("draws the mock's meter: an overline label, a 6px round track with quarter ticks", () => {
    render(<MetricMeter label="Memory" value={61} warn={90} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('data-slot', 'metric-meter');
    expect(meter).toHaveClass('flex', 'flex-col', 'gap-1.5');
    expect(screen.getByText('Memory')).toHaveClass('text-overline', 'text-text-3', 'uppercase');
    const track = meter.querySelector('[data-slot="meter-track"]');
    expect(track).toHaveClass('h-1.5', 'rounded-full', 'bg-track', 'overflow-hidden');
    expect(ticks(meter).map((t) => t.style.left)).toEqual(['25%', '50%', '75%']);
    for (const t of ticks(meter)) expect(t).toHaveClass('w-px', 'bg-tick');
    expect(fill(meter)).toHaveClass('rounded-full', 'transition-[width]');
  });

  it('marks where it leaves the accent with a threshold tick, cut over the fill', () => {
    const { rerender } = render(<MetricMeter label="Disk" value={92} warn={90} crit={95} />);
    let mark = threshold(screen.getByRole('meter'));
    expect(mark).toHaveStyle({ left: '90%' });
    expect(mark).toHaveClass('bg-lamp-cut', 'w-0.5');
    // Drawn after the fill, so a reading past it shows the cut.
    expect(fill(screen.getByRole('meter')).compareDocumentPosition(mark)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    rerender(<MetricMeter label="Temp" value={52} unit="°C" crit={85} />);
    expect(threshold(screen.getByRole('meter'))).toHaveStyle({ left: '85%' });
    rerender(<MetricMeter label="Load" value={50} max={200} unit="" warn={150} />);
    expect(threshold(screen.getByRole('meter'))).toHaveStyle({ left: '75%' });
    rerender(<MetricMeter label="CPU" value={40} />);
    expect(threshold(screen.getByRole('meter'))).toBeNull();
    rerender(<MetricMeter label="CPU" value={40} warn={100} />);
    expect(threshold(screen.getByRole('meter'))).toBeNull();
  });

  it('passes className and other props to its root', () => {
    render(<MetricMeter label="CPU" value={18} className="col-span-2" data-testid="cpu" />);
    expect(screen.getByTestId('cpu')).toHaveClass('col-span-2');
  });
});
