import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Plug } from 'lucide-react';
import { Button } from '@ui/button';
import { EmptyState } from '@ui/empty-state';

describe('EmptyState', () => {
  it('says what is empty and what to do next, centred, with its icon in the Settings chip', () => {
    render(
      <EmptyState
        icon={<Plug />}
        title="No integrations yet"
        description="Add one to show its headline stat on its service row."
        action={<Button variant="primary">Add an integration</Button>}
      />
    );
    const empty = screen.getByText('No integrations yet').closest('[data-slot="empty-state"]');
    expect(empty).toHaveClass('items-center', 'text-center');
    expect(screen.getByText('No integrations yet')).toHaveClass('text-title-xs', 'text-text-1');
    expect(screen.getByText('Add one to show its headline stat on its service row.')).toHaveClass(
      'max-w-[44ch]'
    );
    expect(empty).toHaveClass('text-text-2');
    const chip = empty.querySelector('[aria-hidden="true"]');
    expect(chip).toHaveClass('size-8', 'rounded-lg', 'bg-surface-3', 'text-text-1');
    expect(screen.getByRole('button', { name: 'Add an integration' })).toBeInTheDocument();
  });

  it('at sm is the command palette’s one line: 13px text-3', () => {
    render(<EmptyState size="sm" title="Nothing matches “grafna”." description="ignored" />);
    const empty = screen.getByText('Nothing matches “grafna”.');
    expect(empty).toHaveAttribute('data-slot', 'empty-state');
    expect(empty).toHaveClass('text-body-sm', 'text-text-3', 'px-2.5', 'py-4');
    expect(screen.queryByText('ignored')).toBeNull();
  });
});
