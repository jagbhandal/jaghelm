import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusBadge, StatusWord } from '@ui/status-word';
import { STATES, WORDS } from '@ui/lib/status.js';

describe('StatusWord', () => {
  it("says its word, bold in the state's word colour", () => {
    render(<StatusWord state="crit" word="Down" />);
    const word = screen.getByText('Down');
    expect(word).toHaveAttribute('data-slot', 'status-word');
    expect(word).toHaveClass('font-bold', 'text-crit-fg');
  });

  it("reads its state's word when given none, so a status is never colour alone", () => {
    for (const state of STATES) {
      const { container, unmount } = render(<StatusWord state={state} />);
      expect(container.firstChild).toHaveTextContent(WORDS[state]);
      expect(container.firstChild).toHaveClass(`text-${state}-fg`);
      unmount();
    }
  });

  it('keeps the case it is given and takes the size around it', () => {
    render(<StatusWord state="warn" word="On battery" className="text-body-sm" />);
    const word = screen.getByText('On battery');
    expect(word).toHaveClass('text-body-sm', 'text-warn-fg');
    expect(word).not.toHaveClass('uppercase');
  });

  it("is the Android app's mono upper-case word in the android look", () => {
    render(<StatusWord look="android" severity="caution" word="on battery" />);
    const word = screen.getByText('ON BATTERY');
    expect(word).toHaveClass('status-word', 'word--caution');
    expect(word).toHaveStyle({ fontWeight: 500, textTransform: 'uppercase' });
  });
});

describe('StatusBadge', () => {
  it('is the word and its lamp on the tint, inside its border, 4px round', () => {
    render(<StatusBadge state="unknown" />);
    const badge = screen.getByText('No signal');
    expect(badge).toHaveAttribute('data-slot', 'status-badge');
    expect(badge).toHaveClass(
      'rounded-sm',
      'border',
      'border-unknown-border',
      'bg-unknown-tint',
      'text-unknown-fg',
      'text-caption'
    );
    // The word names it; the lamp beside it adds the shape and stays quiet.
    const lamp = badge.querySelector('svg');
    expect(lamp).toHaveAttribute('data-shape', 'ring');
    expect(lamp).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('takes a word of its own', () => {
    render(<StatusBadge state="maintenance" word="Planned" />);
    expect(screen.getByText('Planned')).toHaveClass('bg-maintenance-tint');
  });
});
