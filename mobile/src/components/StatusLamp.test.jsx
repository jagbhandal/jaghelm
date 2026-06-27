import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusLamp from './StatusLamp.jsx';

describe('StatusLamp', () => {
  describe('shapes', () => {
    it('disc: renders a filled circle with no slash or bolt', () => {
      const { container } = render(<StatusLamp shape="disc" severity="healthy" />);
      const circle = container.querySelector('circle');
      expect(circle).not.toBeNull();
      // filled: fill is not "none"
      expect(circle.getAttribute('fill')).not.toBe('none');
      // no slash line, no bolt path
      expect(container.querySelector('line')).toBeNull();
      expect(container.querySelector('path')).toBeNull();
    });

    it('ring: renders a stroke-only hollow circle', () => {
      const { container } = render(<StatusLamp shape="ring" severity="unknown" />);
      const circle = container.querySelector('circle');
      expect(circle).not.toBeNull();
      // hollow: fill is explicitly "none"
      expect(circle.getAttribute('fill')).toBe('none');
      // has a visible stroke
      expect(circle.getAttribute('stroke')).toBeTruthy();
    });

    it('slash: renders a filled circle plus a diagonal slash line', () => {
      const { container } = render(<StatusLamp shape="slash" severity="critical" />);
      const circle = container.querySelector('circle');
      expect(circle).not.toBeNull();
      // circle is filled (not hollow)
      expect(circle.getAttribute('fill')).not.toBe('none');
      // a diagonal cut (line element)
      const line = container.querySelector('line');
      expect(line).not.toBeNull();
    });

    it('bolt: renders a lightning path with no circle', () => {
      const { container } = render(<StatusLamp shape="bolt" severity="caution" />);
      const path = container.querySelector('path');
      expect(path).not.toBeNull();
      // bolt has no circle
      expect(container.querySelector('circle')).toBeNull();
    });
  });

  describe('severity classes', () => {
    it.each([
      ['critical', 'lamp--critical'],
      ['caution', 'lamp--caution'],
      ['healthy', 'lamp--healthy'],
      ['unknown', 'lamp--unknown'],
    ])('%s severity applies %s class to the svg element', (severity, cls) => {
      const { container } = render(<StatusLamp shape="disc" severity={severity} />);
      const svg = container.querySelector('svg');
      expect(svg).toHaveClass(cls);
    });
  });

  describe('accessibility', () => {
    it('label is exposed as aria-label on the svg', () => {
      render(<StatusLamp shape="disc" severity="healthy" label="Service is up" />);
      expect(screen.getByRole('img', { name: 'Service is up' })).toBeInTheDocument();
    });

    it('renders without a label without crashing', () => {
      const { container } = render(<StatusLamp shape="ring" severity="unknown" />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('size prop controls svg dimensions', () => {
      const { container } = render(<StatusLamp shape="disc" severity="healthy" size={20} />);
      const svg = container.querySelector('svg');
      expect(svg.getAttribute('width')).toBe('20');
      expect(svg.getAttribute('height')).toBe('20');
    });
  });
});
