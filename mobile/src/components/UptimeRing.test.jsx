import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import UptimeRing from './UptimeRing.jsx';

describe('UptimeRing', () => {
  describe('rendering percentage', () => {
    it('renders the uptime percentage via uptimePct (0.999 → "99.9%")', () => {
      render(<UptimeRing uptime24={0.999} />);
      expect(screen.getByText('99.9%')).toBeInTheDocument();
    });

    it('renders "42.0%" for uptime24=0.42', () => {
      render(<UptimeRing uptime24={0.42} />);
      expect(screen.getByText('42.0%')).toBeInTheDocument();
    });
  });

  describe('null / undefined guard', () => {
    it('renders nothing when uptime24 is null', () => {
      const { container } = render(<UptimeRing uptime24={null} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders nothing when uptime24 is undefined', () => {
      const { container } = render(<UptimeRing />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('colour: the service\'s drawn state, never a ramp of the ring\'s own (#325)', () => {
    it('draws the arc and the percentage in the state\'s colour, whatever the number', () => {
      const { container } = render(<UptimeRing uptime24={0.42} state="ok" />);
      expect(container.querySelector('.uptime-ring__arc').getAttribute('stroke')).toBe('var(--green)');
      expect(container.querySelector('.uptime-ring__pct').style.fill).toBe('var(--green)');
    });

    it('a service the model has down is red, even at 99.9 %', () => {
      const { container } = render(<UptimeRing uptime24={0.999} state="crit" />);
      expect(container.querySelector('.uptime-ring__arc').getAttribute('stroke')).toBe('var(--red)');
    });

    it('a stale status draws the ring steel (no signal)', () => {
      const { container } = render(<UptimeRing uptime24={0.999} state="unknown" />);
      expect(container.querySelector('.uptime-ring__arc').getAttribute('stroke')).toBe('var(--steel)');
      expect(container.querySelector('.uptime-ring__pct').style.fill).toBe('var(--steel)');
    });

    it('with no state, one neutral tone at any number', () => {
      for (const u of [0.999, 0.97, 0.42]) {
        const { container, unmount } = render(<UptimeRing uptime24={u} />);
        expect(container.querySelector('.uptime-ring__arc').getAttribute('stroke')).toBe('var(--text-muted)');
        unmount();
      }
    });
  });

  describe('Bug #1 regression: no "24H uptime42.0%" jam', () => {
    it('"24H" label and "%" value are separate DOM nodes (not a single jammed text node)', () => {
      render(<UptimeRing uptime24={0.42} />);
      // Both must exist as distinct nodes in the DOM
      const labelNode = screen.getByText('24H');
      const valueNode = screen.getByText('42.0%');
      expect(labelNode).toBeInTheDocument();
      expect(valueNode).toBeInTheDocument();
      // They must be different elements
      expect(labelNode).not.toBe(valueNode);
    });

    it('"24H" label node does not contain the percentage value', () => {
      render(<UptimeRing uptime24={0.42} />);
      const labelNode = screen.getByText('24H');
      expect(labelNode.textContent).not.toContain('42.0%');
    });

    it('percentage node does not contain the "24H" label text', () => {
      render(<UptimeRing uptime24={0.42} />);
      const valueNode = screen.getByText('42.0%');
      expect(valueNode.textContent).not.toContain('24H');
    });
  });

  describe('SVG structure', () => {
    it('renders a background track circle', () => {
      const { container } = render(<UptimeRing uptime24={0.8} />);
      const track = container.querySelector('.uptime-ring__track');
      expect(track).not.toBeNull();
      expect(track.getAttribute('fill')).toBe('none');
    });

    it('renders a progress arc circle with stroke-dasharray', () => {
      const { container } = render(<UptimeRing uptime24={0.8} />);
      const arc = container.querySelector('.uptime-ring__arc');
      expect(arc).not.toBeNull();
      expect(arc.getAttribute('stroke-dasharray')).toBeTruthy();
    });

    it('arc dasharray fraction reflects uptime (1.0 = full circle)', () => {
      const { container } = render(<UptimeRing uptime24={1.0} />);
      const arc = container.querySelector('.uptime-ring__arc');
      const dashArray = arc.getAttribute('stroke-dasharray');
      // Full circle: first number should equal or approximate second number
      const [filled, total] = dashArray.split(' ').map(parseFloat);
      expect(filled / total).toBeCloseTo(1.0, 1);
    });

    it('arc dasharray fraction reflects uptime (0.5 = half circle)', () => {
      const { container } = render(<UptimeRing uptime24={0.5} />);
      const arc = container.querySelector('.uptime-ring__arc');
      const dashArray = arc.getAttribute('stroke-dasharray');
      const [filled, total] = dashArray.split(' ').map(parseFloat);
      expect(filled / total).toBeCloseTo(0.5, 1);
    });
  });
});
