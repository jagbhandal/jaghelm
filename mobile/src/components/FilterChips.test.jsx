import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FilterChips from './FilterChips.jsx';

describe('FilterChips', () => {
  it('marks the active chip and fires onChange with the chosen id', () => {
    const onChange = vi.fn();
    render(<FilterChips chips={[{ id: 'all', label: 'All' }, { id: 'down', label: 'Down' }]} active="all" onChange={onChange} />);
    const all = screen.getByRole('button', { name: 'All' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Down' }));
    expect(onChange).toHaveBeenCalledWith('down');
  });
});
