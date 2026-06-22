import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useAppDataMatching } from './useAppDataMatching';

const serviceData = {
  nodes: {
    pi: { services: [{ container: 'adguard-home', uid: 'pi:adguard-home' }] },
  },
};

describe('useAppDataMatching', () => {
  it('maps display fields to a target-scoped container (internal _fields stripped)', () => {
    const integrationData = { adguard: { Blocked: 100, _target: 'pi:adguard-home' } };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    expect(result.current['adguard-home']).toEqual({ Blocked: 100 });
  });

  it('carries a failed integration error through as _doctor (target mode)', () => {
    const integrationData = { adguard: { _error: 'HTTP 401 Unauthorized', _target: 'pi:adguard-home' } };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    // Previously skipped (empty display fields) → the error was dropped.
    expect(result.current['adguard-home']).toEqual({ _doctor: { error: 'HTTP 401 Unauthorized' } });
  });

  it('carries _doctor via fuzzy keyword match too (no _target)', () => {
    const integrationData = { adguard: { _error: 'connect ETIMEDOUT' } };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    expect(result.current['adguard-home']).toEqual({ _doctor: { error: 'connect ETIMEDOUT' } });
  });

  it('keeps real fields AND the doctor when an integration partially failed', () => {
    const integrationData = { adguard: { Blocked: 7, _error: 'stale', _target: 'pi:adguard-home' } };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    expect(result.current['adguard-home']).toEqual({ Blocked: 7, _doctor: { error: 'stale' } });
  });

  it('still skips a truly empty integration (no display fields, no error)', () => {
    const integrationData = { adguard: { _target: 'pi:adguard-home' } };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    expect(result.current['adguard-home']).toBeUndefined();
  });
});

describe('useAppDataMatching — collision precedence', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves two fuzzy matches on the same container deterministically (first key wins)', () => {
    // Two integrations whose keywords both resolve to "adguard-home". Previously
    // last-write-wins on map[container] made the chosen metrics depend on key order.
    const integrationData = {
      adguard_a: { Blocked: 1 },
      adguard_b: { Blocked: 2 },
    };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    // First in iteration order (adguard_a) wins; result is stable, not nondeterministic.
    expect(result.current['adguard-home']).toEqual({ Blocked: 1 });
  });

  it('warns (in dev) on a fuzzy/fuzzy collision', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const integrationData = {
      adguard_a: { Blocked: 1 },
      adguard_b: { Blocked: 2 },
    };
    renderHook(() => useAppDataMatching(integrationData, serviceData));
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0];
    expect(msg).toContain('adguard-home');
    expect(msg).toContain('adguard_a');
    expect(msg).toContain('adguard_b');
  });

  it('lets an explicit _target win over a prior fuzzy claim on the same container', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const integrationData = {
      adguard_fuzzy: { Blocked: 1 }, // fuzzy, claims first
      adguard_pinned: { Blocked: 99, _target: 'pi:adguard-home' }, // explicit target
    };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    // Target (higher precedence) overrides the earlier fuzzy claim.
    expect(result.current['adguard-home']).toEqual({ Blocked: 99 });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
