import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Sparkline from './Sparkline';

describe('Sparkline', () => {
  it('renders nothing for fewer than 2 points (no trend to draw)', () => {
    expect(render(<Sparkline data={[]} />).container.querySelector('svg')).toBeNull();
    expect(render(<Sparkline data={[50]} />).container.querySelector('svg')).toBeNull();
    expect(render(<Sparkline data={null} />).container.querySelector('svg')).toBeNull();
  });

  it('is decorative (aria-hidden) with a path of N points and a dot at the newest', () => {
    const { container } = render(<Sparkline data={[0, 50, 100]} width={60} height={16} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    const path = svg.querySelector('path');
    expect((path.getAttribute('d').match(/[ML]/g) || []).length).toBe(3);
    const dot = svg.querySelector('circle');
    expect(dot).toHaveAttribute('cx', '60'); // newest at the right edge
    expect(dot).toHaveAttribute('cy', '0'); // 100% → top
  });

  it('maps the FIXED domain (0=bottom, max=top), not auto-scaled to the window', () => {
    const { container } = render(<Sparkline data={[0, 100]} width={10} height={20} />);
    expect(container.querySelector('path').getAttribute('d')).toBe('M0 20 L10 0');
  });

  it('clamps out-of-range values to the domain', () => {
    // 150 clamps to 100 (→ y=0); -10 clamps to 0 (→ y=20).
    const { container } = render(<Sparkline data={[-10, 150]} width={10} height={20} />);
    expect(container.querySelector('path').getAttribute('d')).toBe('M0 20 L10 0');
  });
});
