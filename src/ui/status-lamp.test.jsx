import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusLamp } from '@ui/status-lamp';
import { DEFAULT_LOOK, STATES, WORDS } from '@ui/lib/status.js';

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
  it('draws the web look outside the Android build', () => {
    expect(DEFAULT_LOOK).toBe('ui');
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

  it('draws each state as §5.2 says: disc, slashed disc, disc with a bar, hollow ring, wrench', () => {
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

  it("draws the Android app's lamp in the android look", () => {
    const { container } = render(
      <StatusLamp look="android" shape="slash" severity="critical" label="DOWN" size={14} />
    );
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('status-lamp', 'lamp--critical');
    expect(svg).not.toHaveAttribute('data-slot');
    expect(svg.querySelector('line')).toHaveAttribute('stroke', 'white');
    expect(svg.querySelector('title')).toHaveTextContent('DOWN');
    expect(screen.getByRole('img', { name: 'DOWN' })).toBe(svg);
  });
});
