import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
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
