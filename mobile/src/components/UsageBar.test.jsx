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

  it('colors the fill red at >=90%', () => {
    const { container } = render(<UsageBar label="CPU" value="95" unit="%" percent={95} />);
    const fill = container.querySelector('.usage-bar__fill');
    expect(fill).toHaveStyle({ background: 'var(--red)' });
  });

  it('colors the fill amber at >=75% and <90%', () => {
    const { container } = render(<UsageBar label="CPU" value="80" unit="%" percent={80} />);
    const fill = container.querySelector('.usage-bar__fill');
    expect(fill).toHaveStyle({ background: 'var(--amber)' });
  });

  it('colors the fill green below 75%', () => {
    const { container } = render(<UsageBar label="CPU" value="40" unit="%" percent={40} />);
    const fill = container.querySelector('.usage-bar__fill');
    expect(fill).toHaveStyle({ background: 'var(--green)' });
  });

  it('hides the bar and shows a steel em-dash for null percent', () => {
    const { container } = render(<UsageBar label="TEMP" value={null} unit="°C" percent={null} />);
    expect(container.querySelector('.usage-bar__track')).toBeNull();
    const valueEl = container.querySelector('.usage-bar__value');
    expect(valueEl.textContent).toBe('—');
    expect(valueEl).toHaveStyle({ color: 'var(--steel)' });
  });
});
