import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterChips from './FilterChips.jsx';

const CHIPS_NO_COUNT = [{ id: 'all', label: 'All' }, { id: 'down', label: 'Down' }];
const CHIPS_WITH_COUNT = [
  { id: 'all',  label: 'All',  count: 17 },
  { id: 'down', label: 'Down', count: 2  },
  { id: 'node-03', label: 'node-03', count: 6 },
];

describe('FilterChips', () => {
  it('marks the active chip and fires onChange with the chosen id', () => {
    const onChange = vi.fn();
    render(<FilterChips chips={CHIPS_NO_COUNT} active="all" onChange={onChange} />);
    const all = screen.getByRole('button', { name: 'All' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Down' }));
    expect(onChange).toHaveBeenCalledWith('down');
  });

  it('renders per-chip counts inline (e.g. "All 17", "Down 2")', () => {
    render(<FilterChips chips={CHIPS_WITH_COUNT} active="all" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'All 17' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Down 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'node-03 6' })).toBeInTheDocument();
  });

  it('omits count when not provided (backward-compatible)', () => {
    render(<FilterChips chips={CHIPS_NO_COUNT} active="all" onChange={() => {}} />);
    // Chip text is just the label — no trailing space/number
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Down' })).toBeInTheDocument();
  });

  it('active chip carries chip--active class (not a lone circle)', () => {
    render(<FilterChips chips={CHIPS_WITH_COUNT} active="all" onChange={() => {}} />);
    const allBtn = screen.getByRole('button', { name: 'All 17' });
    // The chip--active class signals pill styling (min-width in CSS keeps it a pill)
    expect(allBtn).toHaveClass('chip--active');
    expect(allBtn).toHaveClass('chip');
    // Inactive chips do NOT carry chip--active
    expect(screen.getByRole('button', { name: 'Down 2' })).not.toHaveClass('chip--active');
  });

  it('selecting a chip fires onChange with the chip id', () => {
    const onChange = vi.fn();
    render(<FilterChips chips={CHIPS_WITH_COUNT} active="all" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Down 2' }));
    expect(onChange).toHaveBeenCalledWith('down');
  });
});
