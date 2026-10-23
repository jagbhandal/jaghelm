import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { AlertFilters } from '@ui/alert-filters';

// #314: the Alerts page's filters. It holds nothing: each control says what
// it is given and calls back with what is chosen.

const SEVERITIES = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];
const KINDS = [
  { value: 'all', label: 'Everything' },
  { value: 'services', label: 'Services' },
  { value: 'nodes', label: 'Nodes' },
];

function draw(props = {}) {
  const calls = { onSeverity: vi.fn(), onKind: vi.fn(), onSearch: vi.fn() };
  render(
    <AlertFilters
      severity="all"
      kind="all"
      search=""
      severities={SEVERITIES}
      kinds={KINDS}
      {...calls}
      {...props}
    />
  );
  return calls;
}

describe('AlertFilters', () => {
  it('names each control and says what is chosen', () => {
    draw({ severity: 'warning', kind: 'nodes', search: 'pve' });
    expect(screen.getByRole('radiogroup', { name: 'Severity' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Warning' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('combobox', { name: 'Kind' })).toHaveTextContent('Nodes');
    expect(screen.getByRole('searchbox', { name: 'Search alerts' })).toHaveValue('pve');
  });

  it('calls back with what is chosen and typed', async () => {
    const user = userEvent.setup();
    const calls = draw();
    await user.click(screen.getByRole('radio', { name: 'Critical' }));
    expect(calls.onSeverity).toHaveBeenCalledWith('critical', expect.anything());
    await user.click(screen.getByRole('combobox', { name: 'Kind' }));
    await user.click(await screen.findByRole('option', { name: 'Services' }));
    expect(calls.onKind).toHaveBeenCalledWith('services', expect.anything());
    await user.type(screen.getByRole('searchbox', { name: 'Search alerts' }), 'g');
    expect(calls.onSearch).toHaveBeenCalledWith('g');
  });

  it('offers Clear filters only when given what clears them', async () => {
    draw();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    const onClear = vi.fn();
    draw({ onClear });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
