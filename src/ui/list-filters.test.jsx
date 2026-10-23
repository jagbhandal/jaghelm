import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ListFilters } from '@ui/list-filters';

// ListFilters (#313): a list page's filters in one row, its controls in the
// order given (a search, Selects, a segmented control), each named, holding
// nothing itself. AlertFilters is one configuration of it (#314).

const STATES = [
  { value: 'all', label: 'All states' },
  { value: 'problems', label: 'Problems' },
  { value: 'ok', label: 'Up' },
];
const SEVERITIES = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical' },
];

function draw(props = {}) {
  const calls = { onSearch: vi.fn(), onState: vi.fn(), onSeverity: vi.fn(), onClear: vi.fn() };
  render(
    <ListFilters
      filters={[
        {
          kind: 'search',
          id: 'q',
          label: 'Search services',
          value: 'jelly',
          onValueChange: calls.onSearch,
        },
        { id: 'state', label: 'State', value: 'all', items: STATES, onValueChange: calls.onState },
        {
          kind: 'segmented',
          id: 'severity',
          label: 'Severity',
          value: 'all',
          items: SEVERITIES,
          onValueChange: calls.onSeverity,
        },
      ]}
      onClear={calls.onClear}
      {...props}
    />
  );
  return calls;
}

describe('ListFilters', () => {
  it('a group named Filters: its controls in their order, each named, and Clear filters', () => {
    draw();
    const group = screen.getByRole('group', { name: 'Filters' });
    const search = within(group).getByRole('searchbox', { name: 'Search services' });
    expect(search).toHaveValue('jelly');
    expect(search).toHaveAttribute('placeholder', 'Search services');
    const state = within(group).getByRole('combobox', { name: 'State' });
    expect(state).toHaveTextContent('All states');
    expect(state).toHaveClass('w-44');
    const severity = within(group).getByRole('radiogroup', { name: 'Severity' });
    expect(within(severity).getByRole('radio', { name: 'All' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    // In the order given.
    const order = [search, state, severity].map((el) =>
      [...group.querySelectorAll('[data-filter]')].indexOf(el)
    );
    expect(order).toEqual([0, 1, 2]);
    expect(within(group).getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('says what changed: the text typed, the value chosen, Clear', async () => {
    const user = userEvent.setup();
    const calls = draw();
    await user.type(screen.getByRole('searchbox', { name: 'Search services' }), 'f');
    expect(calls.onSearch).toHaveBeenLastCalledWith('jellyf');
    await user.click(screen.getByRole('combobox', { name: 'State' }));
    await user.click(await screen.findByRole('option', { name: 'Problems' }));
    expect(calls.onState).toHaveBeenCalledWith('problems', expect.anything());
    await user.click(screen.getByRole('radio', { name: 'Critical' }));
    expect(calls.onSeverity).toHaveBeenCalledWith('critical', expect.anything());
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(calls.onClear).toHaveBeenCalled();
  });

  it('no Clear without anything to clear; a Select takes its own width', () => {
    render(
      <ListFilters
        filters={[
          {
            id: 'kind',
            label: 'Kind',
            value: 'all',
            items: STATES,
            onValueChange: vi.fn(),
            className: 'w-48',
          },
        ]}
      />
    );
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    const kind = screen.getByRole('combobox', { name: 'Kind' });
    expect(kind).toHaveClass('w-48');
    expect(kind).not.toHaveClass('w-44');
  });
});
