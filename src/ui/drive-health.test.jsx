import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DriveHealthSetting } from './drive-health.jsx';

// The Drive health switch (#728): shows what JAGHELM_DRIVES has in force, and
// cannot be changed here; the words say where to change it.

describe('DriveHealthSetting', () => {
  it('on: a checked switch named Drive health, locked, with what it does and where it is set', () => {
    render(<DriveHealthSetting state="on" />);
    const region = screen.getByRole('region', { name: 'Drive health' });
    const toggle = within(region).getByRole('switch', { name: 'Drive health' });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(toggle).toHaveAccessibleDescription(/smartctl_exporter.*JAGHELM_DRIVES/s);
    expect(within(region).getByText('On')).toBeInTheDocument();
    expect(within(region).getByText('JAGHELM_DRIVES')).toBeInTheDocument();
  });

  it('off: unchecked, and says the drives are gone and how to turn it back on', () => {
    render(<DriveHealthSetting state="off" />);
    const toggle = screen.getByRole('switch', { name: 'Drive health' });
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText(/ignores drive data/)).toBeInTheDocument();
    expect(screen.getByText(/docker compose up -d/)).toBeInTheDocument();
  });
});
