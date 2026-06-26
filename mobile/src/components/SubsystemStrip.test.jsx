import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SubsystemStrip from './SubsystemStrip.jsx';

const CELLS = [
  { key: 'services', label: 'Services', degraded: true, detail: '1 down' },
  { key: 'nodes', label: 'Nodes', degraded: false, detail: '3 online' },
  { key: 'ups', label: 'UPS', degraded: false, detail: 'Mains' },
  { key: 'cron', label: 'Cron', degraded: false, detail: 'Healthy' },
];

describe('SubsystemStrip', () => {
  it('renders all four cells and alarm-tints only the degraded one', () => {
    render(<SubsystemStrip cells={CELLS} />);
    expect(screen.getByText('Services')).toBeInTheDocument();
    expect(screen.getByText('1 down')).toBeInTheDocument();
    const svc = screen.getByText('Services').closest('.subsys-cell');
    const nodes = screen.getByText('Nodes').closest('.subsys-cell');
    expect(svc.className).toMatch(/subsys-cell--degraded/);
    expect(nodes.className).not.toMatch(/subsys-cell--degraded/);
  });
});
