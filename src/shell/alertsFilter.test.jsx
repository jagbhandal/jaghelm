/*
 * The Alerts page's filters in the address (#314), on the list pages' one
 * hook (listFilters.js useUrlFilters, #313): a change is an entry Back
 * undoes, a search refined replaces the entry open and keeps what it held
 * (an entity's sheets, #309), and an open entity's id stays as written.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUrlAlertFilters } from './alertsFilter.js';
import { NO_FILTERS } from './alertsView.js';

const url = () => window.location.pathname + window.location.search;

beforeEach(() => window.history.replaceState(null, '', '/alerts'));

describe('useUrlAlertFilters', () => {
  it('reads the address; a change is a new entry, the rest of the query as written', () => {
    window.history.replaceState(null, '', '/alerts?entity=services/apps:jellyfin&kind=nodes');
    const { result } = renderHook(() => useUrlAlertFilters());
    expect(result.current[0]).toEqual({ severity: null, kind: 'nodes', q: '' });
    const before = window.history.length;
    act(() => result.current[1]({ ...result.current[0], severity: 'critical' }));
    expect(url()).toBe('/alerts?entity=services/apps:jellyfin&severity=critical&kind=nodes');
    expect(window.history.length).toBe(before + 1);
    expect(result.current[0]).toEqual({ severity: 'critical', kind: 'nodes', q: '' });
    act(() => result.current[1](NO_FILTERS));
    expect(url()).toBe('/alerts?entity=services/apps:jellyfin');
  });

  it('a search refined replaces the entry open, keeping what it held', () => {
    const sheets = { jaghelmSheets: [{ screen: 'incident', params: { id: 'nodes/edge' } }] };
    window.history.replaceState(sheets, '', '/alerts?entity=nodes/edge&q=pv');
    const { result } = renderHook(() => useUrlAlertFilters());
    const before = window.history.length;
    act(() => result.current[1]({ ...result.current[0], q: 'pve' }, { replace: true }));
    expect(url()).toBe('/alerts?entity=nodes/edge&q=pve');
    expect(window.history.state).toEqual(sheets);
    expect(window.history.length).toBe(before);
  });
});
