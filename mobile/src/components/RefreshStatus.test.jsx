import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import RefreshStatus from './RefreshStatus.jsx';

/**
 * RefreshStatus is now the worst-of annunciator strip (spec §7.1).
 * Status meaning is carried by the StatusLamp severity class (green/amber/red/steel);
 * chrome (the countdown) is indigo `--accent-light`, never a status color.
 */
describe('RefreshStatus annunciator', () => {
  function lamp(container) {
    return container.querySelector('.status-lamp');
  }
  // The visible status sentence lives in the summary span (the lamp's SVG <title>
  // mirrors it for a11y, so query the span explicitly to avoid a dup match).
  function summary(container) {
    return container.querySelector('.mobile-statusbar__summary').textContent;
  }

  it('healthy → green lamp + "All systems operational" + an indigo countdown', () => {
    const { container } = render(
      <RefreshStatus
        severity="healthy"
        summary="All systems operational"
        lastUpdated={Date.now()}
        intervalMs={30000}
        error={null}
        loading={false}
        onRefresh={vi.fn()}
      />,
    );
    expect(summary(container)).toBe('All systems operational');
    expect(lamp(container).classList.contains('lamp--healthy')).toBe(true);

    // The "next Xs" countdown is chrome (accent-light), NOT a status color.
    const next = screen.getByText(/next \d+s/);
    expect(next.style.color).toBe('var(--accent-light)');
    expect(next.style.color).not.toMatch(/red|green|amber/);
  });

  it('down → red lamp + the worst-of sentence', () => {
    const { container } = render(
      <RefreshStatus
        severity="critical"
        summary="2 services down"
        lastUpdated={Date.now()}
        intervalMs={30000}
        error={null}
        loading={false}
        onRefresh={vi.fn()}
      />,
    );
    expect(summary(container)).toBe('2 services down');
    expect(lamp(container).classList.contains('lamp--critical')).toBe(true);
  });

  it('error/unreachable → STEEL lamp (NOT red, NOT green) + "Can\'t reach JagHelm" + "Retrying…"', () => {
    const { container } = render(
      <RefreshStatus
        severity="unknown"
        summary="No signal"
        lastUpdated={Date.now()}
        intervalMs={30000}
        error={new Error('fetch failed')}
        loading={false}
        onRefresh={vi.fn()}
      />,
    );
    const l = lamp(container);
    expect(l.classList.contains('lamp--unknown')).toBe(true);   // steel
    expect(l.classList.contains('lamp--critical')).toBe(false); // not red
    expect(l.classList.contains('lamp--healthy')).toBe(false);  // not green
    expect(summary(container)).toBe("Can't reach JagHelm");
    expect(screen.getByText('Retrying…')).toBeInTheDocument();
    // No live countdown while unreachable.
    expect(screen.queryByText(/next \d+s/)).toBeNull();
    // Progress line is frozen steel, not the animated indigo fill.
    expect(container.querySelector('.mobile-statusbar__progress--frozen')).not.toBeNull();
  });

  it('loading (no data yet) → steel lamp + "Connecting…" + no countdown', () => {
    const { container } = render(
      <RefreshStatus
        severity="unknown"
        summary=""
        lastUpdated={null}
        intervalMs={30000}
        error={null}
        loading
        onRefresh={vi.fn()}
      />,
    );
    expect(summary(container)).toBe('Connecting…');
    expect(lamp(container).classList.contains('lamp--unknown')).toBe(true);
    expect(screen.queryByText(/next \d+s/)).toBeNull();
  });
});
