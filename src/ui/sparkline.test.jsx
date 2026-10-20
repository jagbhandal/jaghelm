import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Sparkline } from '@ui/sparkline';

const popup = () => document.querySelector('[data-slot="sparkline-tooltip"]');
const line = () => document.querySelector('[data-slot="sparkline-line"]');
const area = () => document.querySelector('[data-slot="sparkline-area"]');
const SLOT =
  /(^|\s)(stroke|fill|text|bg)-(series-[2-6]|meter|accent|ok|warn|crit|unknown|maintenance|info)/;

// Local times, so the default HH:MM reads the same in every time zone.
const at = (h, m) => new Date(2026, 9, 20, h, m).getTime();
const CPU = [
  { time: at(8, 30), value: 12 },
  { time: at(8, 34), value: 48 },
  { time: at(8, 38), value: 30 },
  { time: at(8, 42), value: 41 },
];

afterEach(() => vi.restoreAllMocks());

describe('Sparkline', () => {
  it('draws one series in slot 1, azure: never another slot, a status or the accent', () => {
    render(<Sparkline label="CPU, last hour" points={CPU} unit="%" />);
    expect(line()).toHaveClass('stroke-series-1', 'fill-none');
    expect(line()).toHaveAttribute('stroke-width', '1.5');
    expect(area()).toBeNull();
    const svg = line().closest('svg');
    for (const el of svg.querySelectorAll('*')) {
      expect(el.getAttribute('class') ?? '').not.toMatch(SLOT);
    }
  });

  it("draws the Charts board's area and end dot with `area`", () => {
    render(
      <Sparkline label="CPU, last 4 hours" points={CPU} unit="%" area width={240} height={48} />
    );
    expect(area()).toHaveClass('fill-series-1/14');
    expect(line()).toHaveAttribute('stroke-width', '2');
    const end = document.querySelector('[data-slot="sparkline-end"]');
    expect(end).toHaveClass('fill-series-1', 'stroke-surface-1');
    expect(end).toHaveAttribute('r', '3.5');
    // The board's insets: 4px each side and on top, 2px at the bottom.
    expect(end).toHaveAttribute('cx', '236');
    expect(area().getAttribute('d')).toMatch(/^M4 46L/);
  });

  it('plots against 0–100 by default, the readings’ own range with domain="auto"', () => {
    const { rerender } = render(
      <Sparkline label="CPU" points={[0, 50, 100]} width={100} height={20} />
    );
    expect(line()).toHaveAttribute('d', 'M1 19L50 10L99 1');
    rerender(<Sparkline label="CPU" points={[0, 50, 100, 150]} width={100} height={20} />);
    // Clamped to the domain, so 150 % draws at the top.
    expect(line().getAttribute('d')).toMatch(/L99 1$/);
    rerender(
      <Sparkline label="Latency" points={[10, 20, 30]} domain="auto" width={100} height={20} />
    );
    expect(line()).toHaveAttribute('d', 'M1 19L50 10L99 1');
    rerender(<Sparkline label="Latency" points={[10, 10]} domain="auto" width={100} height={20} />);
    expect(line()).toHaveAttribute('d', 'M1 10L99 10');
  });

  it('breaks the line where a reading is missing', () => {
    render(<Sparkline label="CPU" points={[10, 20, null, 40, 50]} width={100} height={20} />);
    expect(line().getAttribute('d').match(/M/g)).toHaveLength(2);
  });

  it('draws nothing with fewer than two readings', () => {
    const { container, rerender } = render(<Sparkline label="CPU" points={[42]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Sparkline label="CPU" points={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is an image named by its label, described by its latest, lowest and highest', () => {
    render(<Sparkline label="CPU, last hour" points={CPU} unit="%" />);
    const chart = screen.getByRole('img', { name: 'CPU, last hour' });
    expect(chart).toHaveAccessibleDescription(
      'Latest 41% at 08:42. Lowest 12%, highest 48%. The arrow keys read each point.'
    );
    expect(chart).toHaveAttribute('tabindex', '0');
    expect(chart).toHaveAttribute('data-slot', 'sparkline-chart');
    // The summary and the live region sit in the sparkline, outside the image.
    const root = chart.closest('[data-slot="sparkline"]');
    expect(root.querySelector('[aria-live="polite"]').closest('[role="img"]')).toBeNull();
  });

  it('opens on keyboard focus at the latest point: value and time; arrows, Home and End move; Escape closes', async () => {
    const user = userEvent.setup();
    render(<Sparkline label="CPU, last hour" points={CPU} unit="%" />);
    await user.tab();
    const chart = screen.getByRole('img', { name: 'CPU, last hour' });
    expect(chart).toHaveFocus();
    await waitFor(() => expect(popup()).toHaveTextContent('41%08:42'));
    expect(popup()).toHaveClass(
      'bg-surface-2',
      'border-border-strong',
      'text-caption',
      'shadow-pop'
    );
    expect(document.querySelector('[data-slot="sparkline-active"]')).toHaveClass('fill-series-1');

    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(popup()).toHaveTextContent('30%08:38'));
    await user.keyboard('{Home}');
    await waitFor(() => expect(popup()).toHaveTextContent('12%08:30'));
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(popup()).toHaveTextContent('12%08:30'));
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(popup()).toHaveTextContent('48%08:34'));
    await user.keyboard('{End}');
    await waitFor(() => expect(popup()).toHaveTextContent('41%08:42'));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(popup()).toBeNull());
    expect(chart).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(popup()).toHaveTextContent('30%08:38'));

    await user.tab();
    await waitFor(() => expect(popup()).toBeNull());
  });

  it('keeps its tooltip from assistive tech: the live region and the description say it (#289)', async () => {
    // Exposed, the tooltip's text would sit at the end of <body>, outside every
    // landmark, repeating what the live region just said (axe's region rule).
    const user = userEvent.setup();
    render(<Sparkline label="CPU, last hour" points={CPU} unit="%" />);
    await user.tab();
    await waitFor(() => expect(popup()).toHaveTextContent('41%08:42'));
    expect(popup()).toHaveAttribute('aria-hidden', 'true');
    await user.keyboard('{ArrowLeft}');
    await waitFor(() =>
      expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('30% at 08:38')
    );
  });

  it('says the point the arrows reach in a polite live region', async () => {
    const user = userEvent.setup();
    render(<Sparkline label="CPU, last hour" points={CPU} unit="%" />);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toHaveClass('sr-only');
    expect(live).toBeEmptyDOMElement();
    await user.tab();
    await user.keyboard('{ArrowLeft}');
    expect(live).toHaveTextContent('30% at 08:38');
  });

  it('opens under the pointer at the nearest point, and closes when it leaves; never on touch', async () => {
    render(<Sparkline label="CPU, last hour" points={CPU} unit="%" width={96} height={24} />);
    const chart = screen.getByRole('img');
    const svg = chart.querySelector('svg');
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 50,
      right: 196,
      bottom: 74,
      width: 96,
      height: 24,
      x: 100,
      y: 50,
    });
    fireEvent.pointerMove(chart, { clientX: 101, clientY: 60, pointerType: 'mouse' });
    await waitFor(() => expect(popup()).toHaveTextContent('12%08:30'));
    fireEvent.pointerMove(chart, { clientX: 140, clientY: 60, pointerType: 'mouse' });
    await waitFor(() => expect(popup()).toHaveTextContent('48%08:34'));
    fireEvent.pointerMove(chart, { clientX: 195, clientY: 60, pointerType: 'mouse' });
    await waitFor(() => expect(popup()).toHaveTextContent('41%08:42'));
    fireEvent.pointerLeave(chart, { pointerType: 'mouse' });
    await waitFor(() => expect(popup()).toBeNull());
    fireEvent.pointerMove(chart, { clientX: 101, clientY: 60, pointerType: 'touch' });
    await new Promise((r) => setTimeout(r, 20));
    expect(popup()).toBeNull();
  });

  it('shows the value alone for readings without times, and "No data" for a gap', async () => {
    const user = userEvent.setup();
    render(<Sparkline label="CPU" points={[10, null, 30]} unit="%" />);
    await user.tab();
    await waitFor(() => expect(popup()).toHaveTextContent(/^30%$/));
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(popup()).toHaveTextContent(/^No data$/));
  });

  it('formats values and times as asked', async () => {
    const user = userEvent.setup();
    render(
      <Sparkline
        label="Response time"
        points={CPU}
        domain="auto"
        formatValue={(v) => `${v} ms`}
        formatTime={(t) => `t${new Date(t).getMinutes()}`}
      />
    );
    await user.tab();
    await waitFor(() => expect(popup()).toHaveTextContent('41 mst42'));
  });

  it('is decorative inside something that opens: hidden, out of the tab order, still shown under the pointer', async () => {
    const user = userEvent.setup();
    render(
      <button type="button">
        Proxmox
        <Sparkline label="CPU, last hour" points={CPU} unit="%" decorative />
      </button>
    );
    expect(document.querySelector('[data-slot="sparkline"]')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
    const chart = document.querySelector('[data-slot="sparkline-chart"]');
    expect(chart).not.toHaveAttribute('tabindex');
    expect(chart).not.toHaveAttribute('role');
    expect(document.querySelector('[aria-live]')).toBeNull();
    expect(screen.getByRole('button')).toHaveAccessibleName('Proxmox');
    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await user.tab();
    expect(document.body).toHaveFocus();
    vi.spyOn(chart.querySelector('svg'), 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 96,
      bottom: 24,
      width: 96,
      height: 24,
      x: 0,
      y: 0,
    });
    fireEvent.pointerMove(chart, { clientX: 95, clientY: 10, pointerType: 'mouse' });
    await waitFor(() => expect(popup()).toHaveTextContent('41%08:42'));
  });

  it('passes className to its root; the chart in it takes the focus ring, and fills a wider root', () => {
    render(<Sparkline label="CPU" points={CPU} className="w-full" data-testid="cpu" />);
    expect(screen.getByTestId('cpu')).toHaveClass('w-full', 'inline-block');
    expect(screen.getByTestId('cpu')).not.toHaveClass('w-fit');
    const chart = screen.getByRole('img');
    expect(chart).toHaveClass('block', 'rounded-sm');
    expect(chart.className).not.toMatch(/(^|\s|:)outline-(none|hidden|0)(\s|$)/);
    expect(chart.querySelector('svg')).toHaveClass('max-w-full');
    expect(chart.querySelector('svg')).toHaveAttribute('width', '96');
  });

  it('keeps its own width where a layout would stretch it, unless its root is given one', () => {
    render(<Sparkline label="CPU" points={CPU} data-testid="cpu" />);
    // fit-content, so a flex column doesn't stretch it to its width.
    expect(screen.getByTestId('cpu')).toHaveClass('w-fit');
  });

  it('draws at the width its root gives it, its height and line kept: never scaled', () => {
    const box = (width) => ({
      left: 0,
      top: 0,
      right: width,
      bottom: 24,
      width,
      height: 24,
      x: 0,
      y: 0,
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return box(this.dataset.slot === 'sparkline-chart' ? 480 : 0);
    });
    const { rerender } = render(<Sparkline label="CPU" points={[0, 50, 100]} className="w-full" />);
    const svg = screen.getByRole('img').querySelector('svg');
    // The view box is the box it is drawn in, so nothing in it scales.
    expect(svg).toHaveAttribute('viewBox', '0 0 480 24');
    expect(svg).toHaveAttribute('width', '480');
    expect(svg).toHaveAttribute('height', '24');
    expect(line()).toHaveAttribute('stroke-width', '1.5');
    expect(line()).toHaveAttribute('d', 'M1 23L240 12L479 1');
    rerender(<Sparkline label="CPU" points={[0, 50, 100]} className="w-full" area />);
    expect(line()).toHaveAttribute('stroke-width', '2');
    expect(document.querySelector('[data-slot="sparkline-end"]')).toHaveAttribute('r', '3.5');
    expect(document.querySelector('[data-slot="sparkline-end"]')).toHaveAttribute('cx', '476');
  });

  it('needs a label unless decorative: without one it throws in development', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Sparkline points={CPU} />)).toThrow(/label/);
    expect(() => render(<Sparkline points={CPU} decorative />)).not.toThrow();
  });
});
