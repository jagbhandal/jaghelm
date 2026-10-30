import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MonitoringNote, MonitoringSection } from '@ui/monitoring-section';

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
