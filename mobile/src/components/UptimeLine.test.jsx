import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import UptimeLine from './UptimeLine.jsx';

describe('UptimeLine', () => {
  it('renders the uptime percentage text', () => {
    render(<UptimeLine uptime24={0.42} />);
    expect(screen.getByText('42.0%')).toBeInTheDocument();
  });

  it('applies the red color token for a low uptime value', () => {
    render(<UptimeLine uptime24={0.42} />);
    const strong = screen.getByText('42.0%');
    expect(strong.style.color).toBe('var(--red)');
  });

  it('applies the green color token for a high uptime value', () => {
    render(<UptimeLine uptime24={0.999} />);
    const strong = screen.getByText('99.9%');
    expect(strong.style.color).toBe('var(--green)');
  });

  it('applies the amber color token for mid-range uptime', () => {
    render(<UptimeLine uptime24={0.97} />);
    const strong = screen.getByText('97.0%');
    expect(strong.style.color).toBe('var(--amber)');
  });

  it('returns null when uptime24 is null', () => {
    const { container } = render(<UptimeLine uptime24={null} />);
    expect(container.firstChild).toBeNull();
  });
});
