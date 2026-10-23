import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ListFilters } from '@ui/list-filters';

// ListFilters (#313): a list page's filters in one row, each control named,
// holding nothing itself.

const STATES = [
  { value: 'all', label: 'All states' },
  { value: 'problems', label: 'Problems' },
  { value: 'ok', label: 'Up' },
];

function draw(props = {}) {
  const onSearch = vi.fn();
  const onState = vi.fn();
  const onClear = vi.fn();
  render(
    <ListFilters
      search={{ value: 'jelly', onChange: onSearch, label: 'Search services' }}
      filters={[
        { id: 'state', label: 'State', value: 'all', items: STATES, onValueChange: onState },
      ]}
      onClear={onClear}
      {...props}
    />
  );
  return { onSearch, onState, onClear };
}

describe('ListFilters', () => {
  it('a group named Filters: the search, a Select for each filter, and Clear filters', () => {
    draw();
    const group = screen.getByRole('group', { name: 'Filters' });
    const search = within(group).getByRole('searchbox', { name: 'Search services' });
    expect(search).toHaveValue('jelly');
    expect(search).toHaveAttribute('placeholder', 'Search services');
    expect(within(group).getByRole('combobox', { name: 'State' })).toHaveTextContent('All states');
    expect(within(group).getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('says what changed: the text typed, the value chosen, Clear', async () => {
    const user = userEvent.setup();
    const { onSearch, onState, onClear } = draw();
    await user.type(screen.getByRole('searchbox', { name: 'Search services' }), 'f');
    expect(onSearch).toHaveBeenLastCalledWith('jellyf');
    await user.click(screen.getByRole('combobox', { name: 'State' }));
    await user.click(await screen.findByRole('option', { name: 'Problems' }));
    expect(onState).toHaveBeenCalledWith('problems');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('no Clear without anything to clear; no search without one', () => {
    draw({ onClear: undefined, search: undefined });
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'State' })).toBeInTheDocument();
  });
});
