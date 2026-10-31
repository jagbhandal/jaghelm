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

  // The level marker (#844): a word on the status tint, never colour alone.
  describe('level markers', () => {
    const mixed = [
      { at, text: 'oom killed', level: 'fatal' },
      { at: at - 1000, text: 'upstream timed out', level: 'error' },
      { at: at - 2000, text: 'slow query', level: 'warn' },
      { at: at - 3000, text: 'started', level: 'other' },
    ];

    it('says the level in a word and tints it with that status, the fatal one solid', () => {
      render(<DetailLogs state="ok" lines={mixed} />);
      const marks = Array.from(document.querySelectorAll('[data-slot="detail-logs-level"]'));
      expect(marks.map((m) => m.textContent)).toEqual(['Fatal', 'Error', 'Warn']);
      expect(marks[0]).toHaveClass('border-crit-border', 'bg-crit-solid', 'text-crit-on-solid', 'uppercase', 'font-mono');
      expect(marks[1]).toHaveClass('bg-crit-tint', 'text-crit-fg', 'border-crit-border');
      expect(marks[2]).toHaveClass('bg-warn-tint', 'text-warn-fg', 'border-warn-border');
    });

    it('keeps the line text itself in the neutral colour and readable', () => {
      render(<DetailLogs state="ok" lines={mixed} />);
      expect(screen.getByText('upstream timed out')).toHaveClass('text-text-2');
    });

    it('draws no marker for other, a missing or an unknown level, and keeps the text aligned', () => {
      render(
        <DetailLogs
          state="ok"
          lines={[
            { at, text: 'boom', level: 'error' },
            { at, text: 'quiet', level: 'other' },
            { at, text: 'old server' },
            { at, text: 'new word', level: 'severe' },
            { at, text: 'proto', level: '__proto__' },
          ]}
        />
      );
      expect(document.querySelectorAll('[data-slot="detail-logs-level"]')).toHaveLength(1);
      const quiet = screen.getByText('quiet').closest('li');
      expect(quiet.querySelector('[aria-hidden="true"]')).toHaveClass('w-[3.25rem]');
    });

    it('an older server (no level on any line) renders as before: no markers, no spacer', () => {
      const { container } = render(<DetailLogs state="ok" lines={[{ at, text: 'ERROR x' }]} />);
      expect(container.querySelector('[data-slot="detail-logs-level"]')).toBeNull();
      expect(container.querySelector('li [aria-hidden="true"]')).toBeNull();
    });

    it('reads the level from the page text for a screen reader, not only from colour', () => {
      render(<DetailLogs state="ok" lines={mixed} />);
      expect(within(screen.getByRole('region', { name: 'Error log lines' })).getByText('Warn')).toBeVisible();
    });
  });
});
