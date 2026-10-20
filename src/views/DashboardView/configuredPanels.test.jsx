import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  giteaConfigured,
  upsConfigured,
  upsReported,
  useConfiguredPanels,
} from './configuredPanels';

const NONE = { status: null, charge: null, runtime: null, load: null };
const source = (overrides = {}) => ({ error: null, lastSuccessMs: null, ...overrides });

describe('upsReported', () => {
  it('is true once /api/ups carries any reading', () => {
    expect(upsReported({ ...NONE, status: 1, ok: true })).toBe(true);
    expect(upsReported({ ...NONE, charge: 0, ok: true })).toBe(true);
  });

  it('is false with no reading, nothing yet, or an empty body', () => {
    expect(upsReported({ ...NONE, ok: true })).toBe(false);
    expect(upsReported(null)).toBe(false);
    expect(upsReported({})).toBe(false);
  });
});

describe('upsConfigured', () => {
  it("takes the server's answer when it gives one", () => {
    expect(upsConfigured({ ...NONE, ok: true, configured: true })).toBe(true);
    expect(upsConfigured({ ...NONE, status: 1, ok: true, configured: false })).toBe(false);
  });

  it('is not known when Prometheus failed, before any answer, or for an empty body', () => {
    expect(upsConfigured({ ...NONE, ok: false, configured: null })).toBe(null);
    expect(upsConfigured(null)).toBe(null);
    expect(upsConfigured({})).toBe(null);
  });

  it('counts a body without the field (demo data) as a UPS when it carries a reading', () => {
    expect(upsConfigured({ ...NONE, status: 1 })).toBe(true);
    expect(upsConfigured({ ...NONE })).toBe(null);
  });
});

describe('giteaConfigured', () => {
  it('is false when the server says no Gitea is set up', () => {
    expect(giteaConfigured({ configured: false }, source({ lastSuccessMs: 1 }))).toBe(false);
    // An answer kept from before still says so while a later poll fails.
    expect(giteaConfigured({ configured: false }, source({ error: 'HTTP 502' }))).toBe(false);
  });

  it('is true for commits, an empty list once answered, or the 502 of a set-up Gitea failing', () => {
    expect(giteaConfigured([{ repo: 'r', commits: [] }], source())).toBe(true);
    expect(giteaConfigured([], source({ lastSuccessMs: 1_000 }))).toBe(true);
    expect(giteaConfigured([], source({ error: 'HTTP 502' }))).toBe(true);
  });

  it('is not known before any answer, for other failures, or for a body that is not a list', () => {
    expect(giteaConfigured([], source())).toBe(null);
    expect(giteaConfigured([], source({ error: 'Failed to fetch' }))).toBe(null);
    expect(giteaConfigured([], source({ error: 'HTTP 401' }))).toBe(null);
    expect(giteaConfigured({}, source({ lastSuccessMs: 1_000 }))).toBe(null);
    expect(giteaConfigured(null, source())).toBe(null);
  });
});

describe('useConfiguredPanels', () => {
  const run = (initial) =>
    renderHook((props) => useConfiguredPanels(props), { initialProps: initial });

  it('is not known (hidden) before any answer', () => {
    const { result } = run({ ups: null, commits: [], commitsSource: source() });
    expect(result.current).toEqual({ ups: null, pipeline: null });
  });

  it('keeps the last true or false while an answer says nothing, and follows a new one', () => {
    const { result, rerender } = run({
      ups: { ...NONE, status: 1, ok: true, configured: true },
      commits: [],
      commitsSource: source({ lastSuccessMs: 1 }),
    });
    expect(result.current).toEqual({ ups: true, pipeline: true });

    // Prometheus fails; JagHelm doesn't answer the Gitea poll.
    rerender({
      ups: { ...NONE, ok: false, configured: null },
      commits: [],
      commitsSource: source({ lastSuccessMs: 1, error: 'Failed to fetch' }),
    });
    expect(result.current).toEqual({ ups: true, pipeline: true });

    rerender({
      ups: { ...NONE, ok: true, configured: false },
      commits: { configured: false },
      commitsSource: source({ lastSuccessMs: 2 }),
    });
    expect(result.current).toEqual({ ups: false, pipeline: false });

    rerender({
      ups: { ...NONE, ok: false, configured: null },
      commits: { configured: false },
      commitsSource: source({ lastSuccessMs: 2, error: 'Failed to fetch' }),
    });
    expect(result.current).toEqual({ ups: false, pipeline: false });
  });
});
