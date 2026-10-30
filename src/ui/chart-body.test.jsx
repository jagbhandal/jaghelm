import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ChartBody, ChartLink, ChartNote } from '@ui/chart-body';
import { StatTiles } from '@ui/stat-tile';

describe('chart body parts', () => {
  it('stack, note and link, each with its slot and the caller’s attributes', () => {
    render(
      <ChartBody data-testid="body">
        <ChartNote data-slot-test="n">Covers only the UPS.</ChartNote>
        <ChartLink href="/settings/system">Settings</ChartLink>
        <StatTiles>
          <span>tile</span>
        </StatTiles>
      </ChartBody>
    );
    expect(screen.getByTestId('body')).toHaveAttribute('data-slot', 'chart-body');
    expect(screen.getByText('Covers only the UPS.')).toHaveAttribute('data-slot', 'chart-note');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings/system');
    expect(screen.getByText('tile').parentElement).toHaveAttribute('data-slot', 'monitoring-tiles');
  });

  it('keeps the caller’s class beside its own', () => {
    render(<ChartNote className="mt-2">x</ChartNote>);
    expect(screen.getByText('x').className).toMatch(/text-text-2/);
    expect(screen.getByText('x').className).toMatch(/mt-2/);
  });
});
