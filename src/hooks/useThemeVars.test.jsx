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

  it('still applies the opacities and the font preset', () => {
    renderHook(() => useThemeVars({ bgOpacity: 0.5, fontFamily: 'clean' }));
    expect(style().getPropertyValue('--bg-opacity')).toBe('0.5');
    expect(style().getPropertyValue('--font-body')).toBe("'Inter', sans-serif");
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
