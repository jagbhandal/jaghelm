import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import {
  ChartFocusTag,
  MonitoringBannerFrame,
  MonitoringNote,
  MonitoringOther,
  MonitoringSection,
  chartFocus,
} from '@ui/monitoring-section';
import { Panel } from '@ui/panel';

describe('MonitoringSection', () => {
  it('is a region named by its heading, with the question under it and its charts after', () => {
    render(
      <MonitoringSection title="Resources" question="Is any node short of CPU?">
        <p>a chart</p>
      </MonitoringSection>
    );
    const region = screen.getByRole('region', { name: 'Resources' });
    const heading = within(region).getByRole('heading', { level: 2, name: 'Resources' });
    expect(heading).toHaveClass('text-title-xs', 'text-text-1');
    expect(within(region).getByText('Is any node short of CPU?')).toHaveClass(
      'text-caption',
      'text-text-3'
    );
    expect(within(region).getByText('a chart')).toBeInTheDocument();
    expect(region).not.toHaveAttribute('aria-busy');
  });

  it('while loading, stands a still block where the charts go and says so once', () => {
    render(
      <MonitoringSection title="Resources" loading>
        <p>a chart</p>
      </MonitoringSection>
    );
    const region = screen.getByRole('region', { name: 'Resources' });
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(within(region).getByText('Loading Resources')).toHaveClass('sr-only');
    expect(region.querySelector('[data-slot="monitoring-skeleton"]')).toHaveAttribute(
      'aria-hidden',
      'true'
    );
    expect(screen.queryByText('a chart')).toBeNull();
  });
});

describe('MonitoringNote', () => {
  it('is a polite status line', () => {
    render(<MonitoringNote>The charts couldn’t be read.</MonitoringNote>);
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('The charts couldn’t be read.');
    expect(note).toHaveClass('text-caption', 'text-text-2', 'bg-surface-1');
  });
});

describe('the banner and focus parts (#752)', () => {
  it('stacks the banner and its "other issues" line', () => {
    const { container } = render(
      <MonitoringBannerFrame>
        <p>panel</p>
        <MonitoringOther>
          2 other issues <a href="/alerts">Alerts</a>
        </MonitoringOther>
      </MonitoringBannerFrame>
    );
    expect(container.querySelector('[data-slot="monitoring-banner"]')).toHaveClass('flex-col');
    expect(screen.getByRole('link', { name: 'Alerts' }).closest('p')).toHaveClass('text-text-2');
  });

  it('the tag says the issue in words beside its lamp', () => {
    render(<ChartFocusTag state="warn">Warning · Disk 91 % full</ChartFocusTag>);
    const tag = screen.getByText(/Warning · Disk 91 % full/);
    expect(tag).toHaveAttribute('data-slot', 'monitoring-focus-tag');
    expect(tag.querySelector('[data-slot="status-lamp"]')).not.toBeNull();
  });

  it('a chart panel takes focus and is marked and tagged only while focused', () => {
    const { rerender } = render(<Panel title="CPU" {...chartFocus(false, <span>tag</span>)} />);
    const panel = screen.getByRole('region', { name: 'CPU' });
    expect(panel).toHaveAttribute('tabindex', '-1');
    expect(panel).not.toHaveAttribute('data-focused');
    expect(screen.queryByText('tag')).toBeNull();
    rerender(<Panel title="CPU" {...chartFocus(true, <span>tag</span>)} />);
    expect(screen.getByRole('region', { name: 'CPU' })).toHaveAttribute('data-focused');
    expect(screen.getByText('tag')).toBeInTheDocument();
  });
});
