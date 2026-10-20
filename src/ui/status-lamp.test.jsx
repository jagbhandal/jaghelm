import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusLamp } from '@ui/status-lamp';
import { STATES, WORDS } from '@ui/lib/status.js';

/** What a lamp draws: each mark's element and the attributes that make its shape. */
function geometry(svg) {
  return [...svg.querySelectorAll('*')].map((el) =>
    [
      el.tagName,
      ...['r', 'fill', 'stroke', 'x1', 'y1', 'x2', 'y2', 'd', 'viewBox', 'class']
        .filter((a) => el.hasAttribute(a))
        .map((a) => `${a}=${el.getAttribute(a)}`),
    ].join(' ')
  );
}

describe('StatusLamp', () => {
  // The web's build, and these tests, define __ANDROID_LOOK__ false; the
  // Android app's tests check its own look (mobile/src/components/).
  it('draws the web look outside the Android build', () => {
    expect(__ANDROID_LOOK__).toBe(false);
    const { container } = render(<StatusLamp state="crit" />);
    expect(container.querySelector('svg')).toHaveAttribute('data-slot', 'status-lamp');
    expect(container.querySelector('svg')).not.toHaveClass('status-lamp');
  });

  // Status is never colour alone (docs/design-system.md, rule 3): every state
  // has its own shape, and a name a screen reader says.
  it('gives each of the five states a distinct shape and an accessible name', () => {
    const drawn = new Map();
    for (const state of STATES) {
      const { unmount } = render(<StatusLamp state={state} />);
      const lamp = screen.getByRole('img', { name: WORDS[state] });
      expect(lamp).toHaveAttribute('data-state', state);
      drawn.set(state, geometry(lamp).join(' | '));
      unmount();
    }
    expect(new Set(drawn.values()).size).toBe(STATES.length);
    expect(STATES).toEqual(['ok', 'warn', 'crit', 'unknown', 'maintenance']);
  });

  it('draws each state as design-system.md rule 3 says: disc, slashed disc, disc with a bar, hollow ring, wrench', () => {
    const marks = (state) => {
      const { container, unmount } = render(<StatusLamp state={state} />);
      const svg = container.querySelector('svg');
      const out = {
        shape: svg.getAttribute('data-shape'),
        circle: svg.querySelector('circle'),
        line: svg.querySelector('line'),
        path: svg.querySelector('path'),
      };
      unmount();
      return out;
    };

    const ok = marks('ok');
    expect(ok.shape).toBe('disc');
    expect(ok.circle).toHaveAttribute('fill', 'currentColor');
    expect(ok.line).toBeNull();
    expect(ok.path).toBeNull();

    // The slash runs corner to corner, bottom left to top right, in the cut colour.
    const warn = marks('warn');
    expect(warn.shape).toBe('slash');
    expect(warn.circle).toHaveAttribute('fill', 'currentColor');
    expect(warn.line).toHaveClass('stroke-lamp-cut');
    expect(Number(warn.line.getAttribute('y1'))).toBeGreaterThan(
      Number(warn.line.getAttribute('y2'))
    );
    expect(Number(warn.line.getAttribute('x1'))).toBeLessThan(Number(warn.line.getAttribute('x2')));

    // The bar is level.
    const crit = marks('crit');
    expect(crit.shape).toBe('bar');
    expect(crit.circle).toHaveAttribute('fill', 'currentColor');
    expect(crit.line).toHaveClass('stroke-lamp-cut');
    expect(crit.line.getAttribute('y1')).toBe(crit.line.getAttribute('y2'));

    const unknown = marks('unknown');
    expect(unknown.shape).toBe('ring');
    expect(unknown.circle).toHaveAttribute('fill', 'none');
    expect(unknown.circle).toHaveAttribute('stroke', 'currentColor');
    expect(unknown.line).toBeNull();

    const maintenance = marks('maintenance');
    expect(maintenance.shape).toBe('wrench');
    expect(maintenance.path).toHaveAttribute('fill', 'none');
    expect(maintenance.path).toHaveAttribute('stroke', 'currentColor');
    expect(maintenance.circle).toBeNull();
  });

  it("takes its state's solid colour, never a raw one", () => {
    for (const state of STATES) {
      const { container, unmount } = render(<StatusLamp state={state} />);
      expect(container.querySelector('svg')).toHaveClass(`text-${state}-solid`);
      unmount();
    }
  });

  it('is 10px, or 14px at lg, or any size in px', () => {
    const { container, rerender } = render(<StatusLamp state="ok" />);
    const svg = () => container.querySelector('svg');
    expect(svg()).toHaveAttribute('width', '10');
    rerender(<StatusLamp state="ok" size="lg" />);
    expect(svg()).toHaveAttribute('width', '14');
    expect(svg()).toHaveAttribute('viewBox', '0 0 14 14');
    rerender(<StatusLamp state="ok" size={16} />);
    expect(svg()).toHaveAttribute('height', '16');
  });

  it('takes a label as its name, and hides from assistive tech when decorative', () => {
    const { container, rerender } = render(<StatusLamp state="crit" label="Immich down" />);
    expect(screen.getByRole('img', { name: 'Immich down' })).toBeInTheDocument();
    rerender(<StatusLamp state="crit" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it("reads the Android app's severities, and reads anything else as no signal", () => {
    const shapeOf = (props) => {
      const { container, unmount } = render(<StatusLamp {...props} />);
      const svg = container.querySelector('svg');
      const out = [svg.getAttribute('data-state'), svg.getAttribute('data-shape')];
      unmount();
      return out;
    };
    expect(shapeOf({ severity: 'critical' })).toEqual(['crit', 'bar']);
    expect(shapeOf({ severity: 'caution' })).toEqual(['warn', 'slash']);
    expect(shapeOf({ severity: 'healthy' })).toEqual(['ok', 'disc']);
    expect(shapeOf({ severity: 'unknown' })).toEqual(['unknown', 'ring']);
    expect(shapeOf({ state: 'down' })).toEqual(['unknown', 'ring']);
    expect(shapeOf({})).toEqual(['unknown', 'ring']);
  });

  it("always draws its state's own shape: a shape is the Android look's", () => {
    const { container } = render(<StatusLamp state="crit" shape="bolt" />);
    expect(container.querySelector('svg')).toHaveAttribute('data-shape', 'bar');
    expect(container.querySelector('path')).toBeNull();
  });

  // The wrench is Lucide's 2-to-22 span drawn in the lamp's box, inset by half
  // its 1.5px line, so the box's edge doesn't clip it, and its inner viewport
  // is hidden, so assistive tech meets one image.
  it('draws the wrench inside its box, as one image', () => {
    for (const px of [10, 14, 16]) {
      const { container, unmount } = render(<StatusLamp state="maintenance" size={px} />);
      const lamp = screen.getByRole('img', { name: 'Maintenance' });
      const inner = lamp.querySelector('svg');
      expect(inner).toHaveAttribute('aria-hidden', 'true');
      expect(container.querySelectorAll('[role="img"]')).toHaveLength(1);
      const [x, y, w, h] = inner.getAttribute('viewBox').split(' ').map(Number);
      expect([x, w]).toEqual([y, h]);
      // Lucide's 2 lands at 0.75 and its 22 at px - 0.75: the line's outer edge
      // meets the box's.
      const at = (u) => ((u - x) * px) / w;
      expect(at(2)).toBeCloseTo(0.75, 6);
      expect(at(22)).toBeCloseTo(px - 0.75, 6);
      expect(inner.querySelector('path')).toHaveAttribute('stroke-width', '1.5');
      unmount();
    }
  });
});
