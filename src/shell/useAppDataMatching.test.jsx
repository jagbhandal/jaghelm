import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useAppDataMatching } from './useAppDataMatching';

const serviceData = {
  nodes: {
    pi: { services: [{ container: 'adguard-home', uid: 'pi:adguard-home' }] },
  },
};

describe('useAppDataMatching', () => {
  // #300: keyed by the service's uid, so two containers of one name on two
  // nodes each get their own numbers.
  it('keys each service by its uid: a same-named container on another node gets its own, or none', () => {
    const twoNodes = {
      nodes: {
        'pi-1': { services: [{ container: 'adguard-home', uid: 'pi-1:adguard-home' }] },
        'pi-2': { services: [{ container: 'adguard-home', uid: 'pi-2:adguard-home' }] },
      },
    };
    const both = {
      adguard_one: { Queries: '41k', _target: 'pi-1:adguard-home' },
      adguard_two: { Queries: '12k', _target: 'pi-2:adguard-home' },
    };
    const { result, rerender } = renderHook(({ data }) => useAppDataMatching(data, twoNodes), {
      initialProps: { data: both },
    });
    expect(result.current).toEqual({
      'pi-1:adguard-home': { Queries: '41k' },
      'pi-2:adguard-home': { Queries: '12k' },
    });
    // One set up, on pi-1: pi-2's container shows nothing of pi-1's.
    rerender({ data: { adguard: both.adguard_one } });
    expect(result.current).toEqual({ 'pi-1:adguard-home': { Queries: '41k' } });
    // Two by keyword alone: each takes its own container.
    rerender({
      data: {
        adguard_a: { Queries: '1', _preset: 'adguard' },
        adguard_b: { Queries: '2', _preset: 'adguard' },
      },
    });
    expect(result.current).toEqual({
      'pi-1:adguard-home': { Queries: '1' },
      'pi-2:adguard-home': { Queries: '2' },
    });
  });

  it('maps display fields to a target-scoped container (internal _fields stripped)', () => {
    const integrationData = { adguard: { Blocked: 100, _target: 'pi:adguard-home' } };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    expect(result.current['pi:adguard-home']).toEqual({ Blocked: 100 });
  });

  it('carries a failed integration error through as _doctor (target mode)', () => {
    const integrationData = {
      adguard: { _error: 'HTTP 401 Unauthorized', _target: 'pi:adguard-home' },
    };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    // Previously skipped (empty display fields) → the error was dropped.
    expect(result.current['pi:adguard-home']).toEqual({
      _doctor: { error: 'HTTP 401 Unauthorized' },
    });
  });

  it('carries _doctor via fuzzy keyword match too (no _target)', () => {
    const integrationData = { adguard: { _error: 'connect ETIMEDOUT' } };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    expect(result.current['pi:adguard-home']).toEqual({ _doctor: { error: 'connect ETIMEDOUT' } });
  });

  it('keeps real fields AND the doctor when an integration partially failed', () => {
    const integrationData = {
      adguard: { Blocked: 7, _error: 'stale', _target: 'pi:adguard-home' },
    };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    expect(result.current['pi:adguard-home']).toEqual({ Blocked: 7, _doctor: { error: 'stale' } });
  });

  it('still skips a truly empty integration (no display fields, no error)', () => {
    const integrationData = { adguard: { _target: 'pi:adguard-home' } };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    expect(result.current['pi:adguard-home']).toBeUndefined();
  });
});

describe('useAppDataMatching — collision precedence', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves two fuzzy matches on the same container deterministically (first key wins)', () => {
    // Two integrations whose keywords both resolve to "adguard-home". Previously
    // last-write-wins on map[container] made the chosen metrics depend on key order.
    const integrationData = {
      adguard_a: { Blocked: 1, _preset: 'adguard' },
      adguard_b: { Blocked: 2, _preset: 'adguard' },
    };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    // First in iteration order (adguard_a) wins; result is stable, not nondeterministic.
    expect(result.current['pi:adguard-home']).toEqual({ Blocked: 1 });
  });

  it('warns (in dev) on a fuzzy/fuzzy collision', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const integrationData = {
      adguard_a: { Blocked: 1, _preset: 'adguard' },
      adguard_b: { Blocked: 2, _preset: 'adguard' },
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
      adguard_fuzzy: { Blocked: 1, _preset: 'adguard' }, // fuzzy, claims first
      adguard_pinned: { Blocked: 99, _preset: 'adguard', _target: 'pi:adguard-home' }, // explicit target
    };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    // Target (higher precedence) overrides the earlier fuzzy claim.
    expect(result.current['pi:adguard-home']).toEqual({ Blocked: 99 });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// #640: the type the server ran the entry as (`_preset`) picks the keywords; a
// key that merely starts with a preset's name does not.
describe('useAppDataMatching: the preset an entry names, not the one its key suggests', () => {
  it('a custom integration keyed adguard_stats does not match the AdGuard container', () => {
    const integrationData = { adguard_stats: { Blocked: 5, _preset: 'adguard_stats' } };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    expect(result.current['pi:adguard-home']).toBeUndefined();
  });

  it('an entry naming the adguard preset matches whatever its key is', () => {
    const integrationData = { dns_home: { Blocked: 5, _preset: 'adguard' } };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    expect(result.current['pi:adguard-home']).toEqual({ Blocked: 5 });
  });

  it('an entry with no stamp falls back to its whole key', () => {
    const integrationData = { adguard: { Blocked: 5 } };
    const { result } = renderHook(() => useAppDataMatching(integrationData, serviceData));
    expect(result.current['pi:adguard-home']).toEqual({ Blocked: 5 });
  });
});
