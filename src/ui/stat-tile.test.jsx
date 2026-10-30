import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatTile } from '@ui/stat-tile';

describe('StatTile', () => {
  it('is a group named by its label, figure and note, with the figure and note drawn', () => {
    render(<StatTile label="Month to date" value="$6.10" note="so far" />);
    const tile = screen.getByRole('group', { name: 'Month to date: $6.10, so far' });
    expect(tile).toHaveAttribute('data-slot', 'stat-tile');
    expect(tile).toHaveTextContent('Month to date');
    expect(tile).toHaveTextContent('$6.10');
    expect(tile).toHaveTextContent('so far');
    expect(tile).not.toHaveAttribute('data-empty');
  });

  it('says "No reading" for a missing value, never 0', () => {
    for (const value of [null, undefined, '']) {
      const { unmount } = render(<StatTile label="Runtime at this load" value={value} />);
      const tile = screen.getByRole('group', { name: 'Runtime at this load: No reading' });
      expect(tile).toHaveAttribute('data-empty', 'true');
      expect(tile).not.toHaveTextContent('0');
      unmount();
    }
  });

  it('takes its own words for the empty figure and keeps a real zero', () => {
    const { rerender } = render(<StatTile label="Cost" value={null} emptyText="Not set up" />);
    expect(screen.getByRole('group')).toHaveTextContent('Not set up');
    rerender(<StatTile label="Cost" value="0 kWh" />);
    expect(screen.getByRole('group')).toHaveTextContent('0 kWh');
  });

  it('draws no status colour', () => {
    render(<StatTile label="Cost" value="$1" />);
    expect(screen.getByRole('group').outerHTML).not.toMatch(/(ok|warn|crit)-(solid|fg)/);
  });
});
