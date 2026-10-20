import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Rocket } from 'lucide-react';
import { Button } from '@ui/button';
import { Panel } from '@ui/panel';

describe('Panel', () => {
  it('is a section named by its title, flat on surface-1 with a subtle edge and a 12px radius', () => {
    render(
      <Panel title="Quick Launch" description="In ⌘K too">
        <p>Nextcloud</p>
      </Panel>
    );
    const panel = screen.getByRole('region', { name: 'Quick Launch' });
    expect(panel).toHaveAttribute('data-slot', 'panel');
    expect(panel).toHaveClass('bg-surface-1', 'border', 'border-border', 'rounded-xl');
    // Flat: only overlays cast a shadow (design-system rule 7).
    expect(panel.className).not.toMatch(/shadow|blur/);
    expect(screen.getByRole('heading', { level: 2, name: 'Quick Launch' })).toHaveClass(
      'text-title-xs'
    );
    expect(screen.getByText('In ⌘K too')).toHaveClass('text-caption', 'text-text-3');
  });

  it('pads by the density: p-panel, 20px comfortable and 16px compact', () => {
    render(
      <Panel title="Pipeline">
        <p>CI passed</p>
      </Panel>
    );
    const panel = screen.getByRole('region', { name: 'Pipeline' });
    expect(panel).toHaveClass('p-panel', 'gap-3');
    expect(panel).toContainElement(screen.getByText('CI passed'));
  });

  it('shows its icon in the mock’s accent chip, hidden from assistive tech, and actions at the end', () => {
    render(
      <Panel title="Quick Launch" icon={<Rocket />} actions={<Button size="sm">Edit</Button>} />
    );
    const chip = screen.getByRole('region').querySelector('[aria-hidden="true"]');
    expect(chip).toHaveClass(
      'size-7',
      'rounded-lg',
      'bg-accent-tint',
      'text-accent-text',
      'inset-ring-accent-border'
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('flush: rows run edge to edge under a subtle rule, the header keeps the padding', () => {
    render(
      <Panel title="Devices" flush>
        <div>Pixel 8</div>
      </Panel>
    );
    const panel = screen.getByRole('region', { name: 'Devices' });
    expect(panel).not.toHaveClass('p-panel');
    expect(panel.querySelector('[data-slot="panel-header"]')).toHaveClass('px-panel', 'pt-panel');
    expect(panel.querySelector('[data-slot="panel-body"]')).toHaveClass(
      'border-t',
      'border-border'
    );
  });

  it('takes another heading level, and needs no title', () => {
    const { unmount } = render(<Panel title="Thresholds" titleAs="h3" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Thresholds' })).toBeInTheDocument();
    unmount();
    const { container } = render(
      <Panel>
        <p>Weather</p>
      </Panel>
    );
    const panel = container.querySelector('[data-slot="panel"]');
    expect(panel).not.toHaveAttribute('aria-labelledby');
    expect(panel.querySelector('[data-slot="panel-header"]')).toBeNull();
  });
});
