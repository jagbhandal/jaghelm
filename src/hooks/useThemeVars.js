/**
 * useThemeVars — applies the user's display config to the document as CSS
 * custom properties.
 *
 * Extracted verbatim from AppMain so the god-component just composes hooks.
 * Two effects, in the same relative order:
 *   1. accent colour + bg/overlay opacity + font family + font sizes
 *   2. card blur override
 *
 * Every preset's webfonts are self-hosted (src/styles/fonts.css, #244), so
 * picking a preset only points the --font-* variables at its families: the
 * browser downloads a family's file once text renders in it, and nothing
 * leaves the origin.
 *
 * Pure side-effects on document.documentElement — returns
 * nothing. Callers pass the live `config` object.
 */

import { useEffect } from 'react';

// Each preset's families. src/styles/fonts.css self-hosts every one but the
// System preset's; scripts/fonts.test.mjs checks it does.
export const FONT_FAMILIES = {
  default: {
    display: "'Outfit', sans-serif",
    body: "'DM Sans', sans-serif",
    mono: "'JetBrains Mono', monospace",
  },
  clean: {
    display: "'Inter', sans-serif",
    body: "'Inter', sans-serif",
    mono: "'Fira Code', monospace",
  },
  rounded: {
    display: "'Nunito', sans-serif",
    body: "'Nunito', sans-serif",
    mono: "'Source Code Pro', monospace",
  },
  sharp: {
    display: "'Rajdhani', sans-serif",
    body: "'Roboto', sans-serif",
    mono: "'Roboto Mono', monospace",
  },
  system: {
    display: 'system-ui, -apple-system, sans-serif',
    body: 'system-ui, -apple-system, sans-serif',
    mono: "ui-monospace, 'SF Mono', monospace",
  },
};

export function useThemeVars(config) {
  useEffect(() => {
    const root = document.documentElement;
    const hex = config.accentColor || '#6366f1';
    root.style.setProperty('--accent', hex);
    const r = parseInt(hex.slice(1, 3), 16),
      g = parseInt(hex.slice(3, 5), 16),
      b = parseInt(hex.slice(5, 7), 16);
    root.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.12)`);
    root.style.setProperty('--accent-light', hex);
    root.style.setProperty('--bg-opacity', String(config.bgOpacity ?? 0.3));
    root.style.setProperty('--overlay-opacity', String(config.overlayOpacity ?? 0.75));

    // Font family
    const fonts = config.fontFamily || 'default';
    const ff = FONT_FAMILIES[fonts] || FONT_FAMILIES.default;
    root.style.setProperty('--font-display', ff.display);
    root.style.setProperty('--font-body', ff.body);
    root.style.setProperty('--font-mono', ff.mono);

    // Font sizes
    const fs = config.fontSizes || {};
    if (fs.sectionTitle) root.style.setProperty('--fs-section-title', `${fs.sectionTitle}px`);
    if (fs.sectionSubtitle)
      root.style.setProperty('--fs-section-subtitle', `${fs.sectionSubtitle}px`);
    if (fs.metricValue) root.style.setProperty('--fs-metric-value', `${fs.metricValue}px`);
    if (fs.metricValueSm) root.style.setProperty('--fs-metric-value-sm', `${fs.metricValueSm}px`);
    if (fs.metricLabel) root.style.setProperty('--fs-metric-label', `${fs.metricLabel}px`);
    if (fs.serviceName) root.style.setProperty('--fs-service-name', `${fs.serviceName}px`);
    if (fs.serviceStatValue)
      root.style.setProperty('--fs-service-stat-value', `${fs.serviceStatValue}px`);
    if (fs.serviceStatLabel)
      root.style.setProperty('--fs-service-stat-label', `${fs.serviceStatLabel}px`);
  }, [
    config.accentColor,
    config.bgOpacity,
    config.overlayOpacity,
    config.fontFamily,
    config.fontSizes,
  ]);

  // Card blur override
  useEffect(() => {
    const root = document.documentElement;
    const blur = config.cardBlur;
    if (blur && blur !== 'none') {
      const blurMap = { sm: '4px', md: '12px', lg: '24px' };
      root.style.setProperty('--glass-blur', blurMap[blur] || '24px');
    }
    // When 'none' or unset, don't override — let theme default handle it
  }, [config.cardBlur]);
}
