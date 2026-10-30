import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DrillChart, DrillCharts } from '@ui/drill-chart';

const at = (h, m) => new Date(2026, 9, 20, h, m).getTime();
const points = [10, 12, 11].map((value, i) => ({ time: at(8, i * 15), value }));
const pct = (v) => `${Math.round(v)} %`;
const NOT_A_SLOT =
  /(^|\s)(stroke|fill|text|bg)-(meter|accent|ok|warn|crit|unknown|maintenance|info)(-|\s|$)/;

describe('DrillChart', () => {
  it('is a title over a Chart of its own, with the Chart’s props passed through', () => {
    const { container } = render(
      <DrillCharts>
        <DrillChart
          title="I/O wait"
          label="edge I/O wait, last hour"
          series={[{ key: 'edge', name: 'I/O wait', points }]}
          formatValue={pct}
          thresholds={[{ level: 'warn', value: 50, mark: true }]}
        />
        <DrillChart
          title="Temperature"
          label="edge Temperature, last hour"
          series={[{ key: 'edge', name: 'Temperature', points }]}
          formatValue={pct}
        />
      </DrillCharts>
    );
    expect(screen.getByRole('heading', { name: 'I/O wait', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'edge I/O wait, last hour' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'edge Temperature, last hour' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="drill-chart"]')).toHaveLength(2);
    expect(container.querySelector('[data-slot="chart-threshold-label"]').textContent).toBe(
      'Warn 50 %'
    );
    // The Chart's lines are a chart slot, never a status colour.
    for (const line of container.querySelectorAll('[data-slot="chart"] path')) {
      expect(line.getAttribute('class') ?? '').not.toMatch(NOT_A_SLOT);
    }
  });

  it('says why in words when there is no plot, and draws none', () => {
    const { container } = render(
      <DrillChart
        title="Temperature"
        label="x"
        empty="No temperature reading for edge in this range."
      />
    );
    expect(screen.getByText('No temperature reading for edge in this range.')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="chart"]')).toBeNull();
  });

  it('a failed chart is the Chart’s failed message, not the empty words', () => {
    render(
      <DrillChart
        title="I/O wait"
        label="x"
        state="failed"
        failedText="Prometheus refused the I/O wait query (HTTP 400)"
        empty="No reading."
      />
    );
    expect(
      screen.getByText('Prometheus refused the I/O wait query (HTTP 400)')
    ).toBeInTheDocument();
    expect(screen.queryByText('No reading.')).toBeNull();
  });
});
