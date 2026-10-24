import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useThemeVars } from './useThemeVars.js';

const style = () => document.documentElement.style;

afterEach(() => {
  document.documentElement.removeAttribute('style');
});

describe('useThemeVars', () => {
  it("sets no accent: a config's old accentColor is not read (#304)", () => {
    renderHook(() => useThemeVars({ accentColor: '#ff0000' }));
    for (const name of ['--accent', '--accent-light', '--accent-glow']) {
      expect(style().getPropertyValue(name)).toBe('');
    }
  });

  it('still applies the opacities', () => {
    renderHook(() => useThemeVars({ bgOpacity: 0.5 }));
    expect(style().getPropertyValue('--bg-opacity')).toBe('0.5');
  });

  // #660: the old font presets are gone; the old variables the remaining old
  // widgets read follow the chosen typeface.
  it('points the old --font-* variables at the chosen typeface; a config’s old fontFamily reads as Manrope', () => {
    const { rerender } = renderHook(({ config }) => useThemeVars(config), {
      initialProps: { config: { fontFamily: 'clean' } },
    });
    expect(style().getPropertyValue('--font-body')).toMatch(/^'Manrope Variable', /);
    expect(style().getPropertyValue('--font-display')).toMatch(/^'Manrope Variable', /);
    expect(style().getPropertyValue('--font-mono')).toBe("'JetBrains Mono', monospace");
    rerender({ config: { typeface: 'montserrat', fontFamily: 'clean' } });
    expect(style().getPropertyValue('--font-body')).toMatch(/^'Montserrat Variable', /);
    expect(style().getPropertyValue('--font-display')).toMatch(/^'Montserrat Variable', /);
  });

  // #306: the per-element sizes sized the old board's panels, which are gone.
  it('sets no per-element font size, whatever a config saved', () => {
    renderHook(() =>
      useThemeVars({ fontSizes: { sectionTitle: 22, serviceName: 16, metricValue: 30 } })
    );
    for (const name of ['--fs-section-title', '--fs-service-name', '--fs-metric-value']) {
      expect(style().getPropertyValue(name)).toBe('');
    }
  });
});
