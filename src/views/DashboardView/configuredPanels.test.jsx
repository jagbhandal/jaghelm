import { describe, it, expect } from 'vitest';
import { configNamesPanel, giteaReported, upsReported } from './configuredPanels';

describe('upsReported', () => {
  it('is true once /api/ups carries any reading', () => {
    expect(upsReported({ status: 1, charge: null, runtime: null, load: null, ok: true })).toBe(
      true
    );
    expect(upsReported({ status: null, charge: 0, runtime: null, load: null, ok: true })).toBe(
      true
    );
  });

  it('is false with no UPS series, a failed read, nothing yet, or an empty body', () => {
    const none = { status: null, charge: null, runtime: null, load: null };
    expect(upsReported({ ...none, ok: true })).toBe(false);
    expect(upsReported({ ...none, ok: false })).toBe(false);
    expect(upsReported(null)).toBe(false);
    expect(upsReported({})).toBe(false);
  });
});

describe('giteaReported', () => {
  it('is true for commits, or for an empty list once the source has succeeded', () => {
    expect(giteaReported([{ repo: 'r', commits: [] }], null)).toBe(true);
    expect(giteaReported([], 1_000)).toBe(true);
  });

  it('is false for the [] seed before any answer, or a body that is not a list', () => {
    expect(giteaReported([], null)).toBe(false);
    expect(giteaReported({}, 1_000)).toBe(false);
    expect(giteaReported(null, 1_000)).toBe(false);
  });
});

describe('configNamesPanel', () => {
  it('finds the panel in any breakpoint of the saved layout', () => {
    expect(configNamesPanel({ gridLayout: { md: [{ i: 'ups' }] } }, 'ups')).toBe(true);
    expect(configNamesPanel({ gridLayout: { lg: [{ i: 'todos' }] } }, 'ups')).toBe(false);
  });

  it('counts a panel switched on in Settings, not one left at its default or switched off', () => {
    expect(configNamesPanel({ sections: { pipeline: { visible: true } } }, 'pipeline')).toBe(true);
    expect(configNamesPanel({ sections: { pipeline: {} } }, 'pipeline')).toBe(false);
    expect(configNamesPanel({ sections: { pipeline: { visible: false } } }, 'pipeline')).toBe(
      false
    );
  });

  it('tolerates a missing or malformed config', () => {
    expect(configNamesPanel(null, 'ups')).toBe(false);
    expect(configNamesPanel({ gridLayout: null }, 'ups')).toBe(false);
    expect(configNamesPanel({ gridLayout: { lg: 'nope', md: [null] } }, 'ups')).toBe(false);
  });
});
