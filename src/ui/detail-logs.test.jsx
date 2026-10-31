import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DetailLogs } from './detail-logs.jsx';

// The detail's Recent errors (#672): the list scrolls inside itself so the
// panel does not grow with the logs.

const at = Date.UTC(2026, 9, 24, 12, 0, 0);
const many = Array.from({ length: 20 }, (_, i) => ({
  at: at - i * 1000,
  text: `ERROR line ${i} ${'x'.repeat(300)}`,
}));

describe('DetailLogs', () => {
  it('puts the lines in a bounded, focusable, labelled scroll region under the fixed heading', () => {
    render(<DetailLogs state="ok" lines={many} />);
    const section = screen.getByRole('region', { name: 'Recent errors' });
    const scroll = within(section).getByRole('region', { name: 'Error log lines' });
    expect(scroll).toHaveAttribute('tabindex', '0');
    expect(scroll).toHaveClass('max-h-[18rem]', 'overflow-y-auto', 'overscroll-auto');
    expect(scroll).not.toHaveClass('overscroll-contain');
    expect(scroll.querySelectorAll('li')).toHaveLength(20);
    // The heading and its note are outside the scroll area.
    expect(scroll).not.toContainElement(screen.getByRole('heading', { name: 'Recent errors' }));
    expect(scroll).not.toContainElement(screen.getByText('last 6 h'));
  });

  it('long unbroken text wraps instead of widening the list', () => {
    render(<DetailLogs state="ok" lines={[{ at, text: 'E'.repeat(500) }]} />);
    expect(screen.getByText('E'.repeat(500))).toHaveClass('[overflow-wrap:anywhere]');
    expect(screen.getByRole('region', { name: 'Error log lines' })).toHaveClass(
      'overflow-x-hidden'
    );
  });

  it('draws no scroll region without lines', () => {
    render(<DetailLogs state="none" />);
    expect(screen.queryByRole('region', { name: 'Error log lines' })).toBeNull();
  });
});
