import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { LayoutGrid, Rows3 } from 'lucide-react';
import { SegmentedControl } from '@ui/segmented-control';

const NO_RING = /(^|\s|:)outline-(none|hidden|0)(\s|$)/;
const DENSITY = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

describe('SegmentedControl', () => {
  it("is a named radio group, drawn as the mock's segmented picker", () => {
    render(<SegmentedControl aria-label="Density" options={DENSITY} defaultValue="comfortable" />);
    const group = screen.getByRole('radiogroup', { name: 'Density' });
    expect(group).toHaveAttribute('data-slot', 'segmented-control');
    // A surface-3 track with 2px of padding; text-3 never sits on it (rule 5).
    expect(group).toHaveClass('bg-surface-3', 'rounded-lg', 'p-0.5', 'gap-0.5');
    const on = screen.getByRole('radio', { name: 'Comfortable' });
    const off = screen.getByRole('radio', { name: 'Compact' });
    expect(on).toHaveAttribute('aria-checked', 'true');
    expect(off).toHaveAttribute('aria-checked', 'false');
    expect(on.tagName).toBe('BUTTON');
    // The chosen segment lifts onto surface-1; the others are text-2. A
    // segment is h-segment (30px), so with the track's 2px the control is 34.
    expect(on).toHaveClass(
      'h-segment',
      'rounded-md',
      'px-3.5',
      'text-body-sm',
      'font-semibold',
      'text-text-2',
      'data-checked:bg-surface-1',
      'data-checked:text-text-1',
      'data-checked:shadow-control'
    );
    expect(group.className).not.toMatch(/text-text-3/);
    expect(on.className).not.toMatch(NO_RING);
  });

  it('enters at the chosen segment with Tab; the arrow keys move and choose', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <>
        <button type="button">Before</button>
        <SegmentedControl
          aria-label="Temperature unit"
          options={[
            { value: 'c', label: '°C' },
            { value: 'f', label: '°F' },
          ]}
          defaultValue="f"
          onValueChange={onValueChange}
        />
      </>
    );
    await user.tab();
    await user.tab();
    const c = screen.getByRole('radio', { name: '°C' });
    const f = screen.getByRole('radio', { name: '°F' });
    expect(f).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(c).toHaveFocus();
    expect(c).toHaveAttribute('aria-checked', 'true');
    expect(f).toHaveAttribute('aria-checked', 'false');
    expect(onValueChange).toHaveBeenLastCalledWith('c', expect.anything());
    await user.keyboard('{ArrowRight}');
    expect(f).toHaveAttribute('aria-checked', 'true');
  });

  it('is chosen by a click, and one segment is always chosen', async () => {
    const user = userEvent.setup();
    render(<SegmentedControl aria-label="Density" options={DENSITY} defaultValue="comfortable" />);
    const compact = screen.getByRole('radio', { name: 'Compact' });
    await user.click(compact);
    expect(compact).toHaveAttribute('aria-checked', 'true');
    await user.click(compact);
    expect(compact).toHaveAttribute('aria-checked', 'true');
  });

  it('shows a Lucide icon beside a segment’s label, hidden from assistive tech', () => {
    render(
      <SegmentedControl
        aria-label="Node view"
        options={[
          { value: 'cards', label: 'Cards', icon: LayoutGrid },
          { value: 'table', label: 'Table', icon: Rows3 },
        ]}
        defaultValue="cards"
      />
    );
    const cards = screen.getByRole('radio', { name: 'Cards' });
    expect(cards.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('carries its value in a form, by name', async () => {
    const user = userEvent.setup();
    render(
      <form data-testid="form">
        <SegmentedControl
          aria-label="Density"
          name="density"
          options={DENSITY}
          defaultValue="comfortable"
        />
      </form>
    );
    const form = screen.getByTestId('form');
    expect(new FormData(form).get('density')).toBe('comfortable');
    await user.click(screen.getByRole('radio', { name: 'Compact' }));
    expect(new FormData(form).get('density')).toBe('compact');
  });

  it('skips a disabled segment', async () => {
    const user = userEvent.setup();
    render(
      <SegmentedControl
        aria-label="Group services by"
        options={[
          { value: 'node', label: 'Node' },
          { value: 'tag', label: 'Tag', disabled: true },
          { value: 'custom', label: 'Custom groups' },
        ]}
        defaultValue="node"
      />
    );
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Custom groups' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Tag' })).toHaveAttribute('aria-checked', 'false');
  });
});
