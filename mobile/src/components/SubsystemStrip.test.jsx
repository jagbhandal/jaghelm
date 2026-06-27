import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SubsystemStrip from './SubsystemStrip.jsx';

// New cell shape (Task 1 contract): { key, label, severity, word, detail }.
const CELLS = [
  { key: 'services', label: 'Services', severity: 'critical', word: 'DOWN', detail: '1 / 2' },
  { key: 'nodes', label: 'Nodes', severity: 'healthy', word: 'OK', detail: '3 online' },
  { key: 'ups', label: 'UPS', severity: 'unknown', word: 'NO SIGNAL', detail: '—' },
  { key: 'cron', label: 'Cron', severity: 'healthy', word: 'OK', detail: '0 fail' },
];

describe('SubsystemStrip', () => {
  it('renders a 2×2 grid of SubsystemCells with the new severity/word/detail shape', () => {
    render(<SubsystemStrip cells={CELLS} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('Services')).toBeInTheDocument();
    expect(screen.getByText('DOWN')).toBeInTheDocument();
    expect(screen.getAllByText('OK')).toHaveLength(2);
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('an unreachable/unknown cell reads NO SIGNAL (steel), never green', () => {
    render(<SubsystemStrip cells={CELLS} />);
    expect(screen.getByText('NO SIGNAL')).toBeInTheDocument();
    const upsCell = screen.getByText('UPS').closest('.subsystem-cell');
    expect(upsCell.className).toMatch(/subsystem-cell--unknown/);
    expect(upsCell.className).not.toMatch(/subsystem-cell--healthy/);
  });

  it('tints each cell by its own severity', () => {
    render(<SubsystemStrip cells={CELLS} />);
    const svc = screen.getByText('Services').closest('.subsystem-cell');
    expect(svc.className).toMatch(/subsystem-cell--critical/);
  });
});
