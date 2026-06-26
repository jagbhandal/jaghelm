import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import UsageBar from './UsageBar.jsx';

describe('UsageBar', () => {
  it('renders label + value + unit and clamps the fill width to percent', () => {
    const { container } = render(<UsageBar label="CPU" value="45.3" unit="%" percent={45.3} />);
    expect(screen.getByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('45.3%')).toBeInTheDocument();
    const fill = container.querySelector('.usage-bar__fill');
    expect(fill).toHaveStyle({ width: '45.3%' });
  });
  it('handles a null percent (no bar, em-dash value)', () => {
    render(<UsageBar label="TEMP" value={null} unit="°C" percent={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
