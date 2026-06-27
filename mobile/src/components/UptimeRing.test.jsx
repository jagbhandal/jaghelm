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

  describe('color ramp via uptimeColor', () => {
    it('progress arc is green for high uptime (0.999 > 0.99 threshold)', () => {
      const { container } = render(<UptimeRing uptime24={0.999} />);
      const arc = container.querySelector('.uptime-ring__arc');
      expect(arc).not.toBeNull();
      expect(arc.getAttribute('stroke')).toBe('var(--green)');
    });

    it('progress arc is amber for mid uptime (0.97, between 0.95 and 0.99)', () => {
      const { container } = render(<UptimeRing uptime24={0.97} />);
      const arc = container.querySelector('.uptime-ring__arc');
      expect(arc).not.toBeNull();
      expect(arc.getAttribute('stroke')).toBe('var(--amber)');
    });

    it('progress arc is red for low uptime (0.42 ≤ 0.95 threshold)', () => {
      const { container } = render(<UptimeRing uptime24={0.42} />);
      const arc = container.querySelector('.uptime-ring__arc');
      expect(arc).not.toBeNull();
      expect(arc.getAttribute('stroke')).toBe('var(--red)');
    });

    it('percentage text fill color matches the uptimeColor ramp (green for 0.999)', () => {
      const { container } = render(<UptimeRing uptime24={0.999} />);
      const pctText = container.querySelector('.uptime-ring__pct');
      expect(pctText).not.toBeNull();
      expect(pctText.style.fill).toBe('var(--green)');
    });

    it('percentage text fill color matches the uptimeColor ramp (red for 0.42)', () => {
      const { container } = render(<UptimeRing uptime24={0.42} />);
      const pctText = container.querySelector('.uptime-ring__pct');
      expect(pctText).not.toBeNull();
      expect(pctText.style.fill).toBe('var(--red)');
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
