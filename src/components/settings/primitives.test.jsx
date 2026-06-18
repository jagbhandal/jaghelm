import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Card, Toggle, ChoiceGroup, EmptyState } from './primitives.jsx';

// These primitives were duplicated verbatim across the settings tabs; the tests
// lock in the contract every tab relies on (so the extraction can't silently
// change behavior) plus the accessibility the inline copies lacked.

describe('Card', () => {
  it('renders a title heading when given one', () => {
    render(<Card title="Weather">body</Card>);
    expect(screen.getByRole('heading', { name: 'Weather' })).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('omits the heading entirely when no title is given', () => {
    render(<Card>body</Card>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});

describe('Toggle', () => {
  it('reflects checked state and reports the new boolean (not the event)', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Toggle label="Show search" checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Show search' });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('ChoiceGroup', () => {
  const opts = [
    { value: 'list', label: 'List' },
    { value: 'row', label: 'Row' },
    { value: 'grid', label: 'Grid' },
  ];

  it('marks the active option with aria-pressed and uses real type=button', () => {
    render(<ChoiceGroup ariaLabel="Card Layout" value="row" options={opts} onChange={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Card Layout' });
    expect(group).toBeInTheDocument();
    const active = screen.getByRole('button', { name: 'Row' });
    expect(active).toHaveAttribute('aria-pressed', 'true');
    expect(active).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the chosen option value', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ChoiceGroup value="row" options={opts} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Grid' }));
    expect(onChange).toHaveBeenCalledWith('grid');
  });

  it('accepts bare primitives as both value and label', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ChoiceGroup value="F" options={['F', 'C']} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'C' }));
    expect(onChange).toHaveBeenCalledWith('C');
  });
});

describe('EmptyState', () => {
  it('renders the message and hides the decorative icon from AT', () => {
    render(<EmptyState icon="📂">No custom groups yet.</EmptyState>);
    expect(screen.getByText('No custom groups yet.')).toBeInTheDocument();
    expect(screen.getByText('📂')).toHaveAttribute('aria-hidden', 'true');
  });
});
