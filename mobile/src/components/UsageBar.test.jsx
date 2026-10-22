import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import UsageBar from '@shared/phone/components/UsageBar.jsx';

// The bar judges nothing (#325): its number is the model's print and its
// colour the model's level for the reading.
describe('UsageBar', () => {
  it('renders label + the number as given and clamps the fill width to percent', () => {
    const { container } = render(<UsageBar label="CPU" shown="45%" percent={45.3} state="ok" />);
    expect(screen.getByText('CPU')).toBeInTheDocument();
    expect(screen.getByText('45%')).toBeInTheDocument();
    const fill = container.querySelector('.usage-bar__fill');
    expect(fill).toHaveStyle({ width: '45.3%' });
    expect(container.querySelector('.usage-bar').dataset.state).toBe('ok');
  });

  it('colours the fill by the model\'s level, whatever the number', () => {
    const fillOf = (percent, state) =>
      render(<UsageBar label="CPU" shown={`${percent}%`} percent={percent} state={state} />)
        .container.querySelector('.usage-bar__fill');
    // A line moved by pushThresholds: 80 % over it is amber, 92 % under it green.
    expect(fillOf(80, 'warn')).toHaveStyle({ background: 'var(--amber)' });
    expect(fillOf(92, 'ok')).toHaveStyle({ background: 'var(--green)' });
    expect(fillOf(96, 'crit')).toHaveStyle({ background: 'var(--red)' });
    // A stale status: no signal, never a level colour.
    expect(fillOf(96, 'unknown')).toHaveStyle({ background: 'var(--steel)' });
  });

  it('hides the bar and shows a steel em-dash with no value', () => {
    const { container } = render(<UsageBar label="TEMP" shown={null} percent={null} state="unknown" />);
    expect(container.querySelector('.usage-bar__track')).toBeNull();
    const valueEl = container.querySelector('.usage-bar__value');
    expect(valueEl.textContent).toBe('—');
    expect(valueEl).toHaveStyle({ color: 'var(--steel)' });
  });
});
