/*
 * The list pages' filters in the address (#313, listFilters.js): what a query
 * holds, the query a change writes (the other parameters kept), the state and
 * search matches, and the hooks: a change is a history entry Back undoes, a
 * search refined replaces the entry it started, and typing reaches the
 * address once it stops.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NODE_FILTERS,
  SEARCH_DELAY_MS,
  SERVICE_FILTERS,
  hasListFilters,
  listFiltersSearch,
  readListFilters,
  searchMatches,
  stateMatches,
  useListFilters,
  useSearchDraft,
} from './listFilters.js';

const url = () => window.location.pathname + window.location.search;

beforeEach(() => window.history.replaceState(null, '', '/services'));

describe('what the address holds', () => {
  it('reads each filter a page has, and nothing it does not', () => {
    expect(
      readListFilters('?q=+jelly+&state=problems&node=apps&tag=media', SERVICE_FILTERS)
    ).toEqual({ q: 'jelly', state: 'problems', node: 'apps', tag: 'media' });
    expect(readListFilters('?q=pi&state=ok&role=NAS&node=apps', NODE_FILTERS)).toEqual({
      q: 'pi',
      state: 'ok',
      role: 'NAS',
    });
    expect(readListFilters('', SERVICE_FILTERS)).toEqual({
      q: '',
      state: null,
      node: null,
      tag: null,
    });
  });

  it('a state it has no filter for is none; a search is cut at 100 characters', () => {
    expect(readListFilters('?state=down', SERVICE_FILTERS).state).toBeNull();
    for (const state of ['problems', 'ok', 'maintenance', 'no-signal'])
      expect(readListFilters(`?state=${state}`, SERVICE_FILTERS).state).toBe(state);
    expect(readListFilters(`?q=${'a'.repeat(150)}`, SERVICE_FILTERS).q).toHaveLength(100);
  });

  it('writes the filters set, keeping the other parameters (an open entity) before them', () => {
    expect(
      listFiltersSearch(
        { q: 'jelly fin', state: 'problems', node: null, tag: '' },
        '?entity=services/apps:jellyfin&q=old&node=apps',
        SERVICE_FILTERS
      )
    ).toBe('?entity=services/apps:jellyfin&q=jelly+fin&state=problems');
    expect(listFiltersSearch({ q: '', state: null }, '?q=old&state=ok', SERVICE_FILTERS)).toBe('');
  });

  it('knows when anything is filtered', () => {
    expect(hasListFilters({ q: '', state: null, node: null })).toBe(false);
    expect(hasListFilters({ q: 'x', state: null })).toBe(true);
    expect(hasListFilters({ q: '', role: 'NAS' })).toBe(true);
  });
});

describe('what a filter keeps', () => {
  it("state: problems are the model's issues (critical, warning, no signal); each other its own", () => {
    const states = ['ok', 'warn', 'crit', 'unknown', 'maintenance'];
    const kept = (filter) => states.filter((s) => stateMatches(filter, s));
    expect(kept(null)).toEqual(states);
    expect(kept('problems')).toEqual(['warn', 'crit', 'unknown']);
    expect(kept('ok')).toEqual(['ok']);
    expect(kept('maintenance')).toEqual(['maintenance']);
    expect(kept('no-signal')).toEqual(['unknown']);
    expect(kept('nonsense')).toEqual(states);
  });

  it('search: each word somewhere in the fields, any case; none matches everything', () => {
    const fields = ['Jellyfin', 'apps', 'App Server', null, 'jellyfin'];
    expect(searchMatches('', fields)).toBe(true);
    expect(searchMatches('JELLY', fields)).toBe(true);
    expect(searchMatches('jelly server', fields)).toBe(true);
    expect(searchMatches('jelly storage', fields)).toBe(false);
    expect(searchMatches('  ', fields)).toBe(true);
  });
});

describe('useListFilters', () => {
  it('a change is a new entry, the page where it was; Back undoes it', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const { result } = renderHook(() => useListFilters(SERVICE_FILTERS));
    const before = window.history.length;
    act(() => result.current[1]({ state: 'problems' }));
    expect(url()).toBe('/services?state=problems');
    expect(result.current[0].state).toBe('problems');
    expect(window.history.length).toBe(before + 1);
    act(() => result.current[1]({ node: 'apps' }));
    expect(url()).toBe('/services?state=problems&node=apps');
    expect(scrollTo).not.toHaveBeenCalled();
    act(() => {
      window.history.replaceState(null, '', '/services?state=problems');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toMatchObject({ state: 'problems', node: null });
    scrollTo.mockRestore();
  });

  it('a replaced entry keeps what it held, and the entity open', () => {
    window.history.replaceState({ held: 1 }, '', '/services?entity=nodes/apps&q=gr');
    const { result } = renderHook(() => useListFilters(SERVICE_FILTERS));
    const before = window.history.length;
    act(() => result.current[1]({ q: 'graf' }, { replace: true }));
    expect(url()).toBe('/services?entity=nodes/apps&q=graf');
    expect(window.history.state).toEqual({ held: 1 });
    expect(window.history.length).toBe(before);
  });
});

describe('useSearchDraft', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('commits once typing stops: a new entry to start, the same one while refined, a new one when cleared', () => {
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(({ q }) => useSearchDraft(q, onCommit), {
      initialProps: { q: '' },
    });
    act(() => result.current[1]('j'));
    act(() => result.current[1]('je'));
    expect(result.current[0]).toBe('je');
    expect(onCommit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    expect(onCommit).toHaveBeenLastCalledWith('je', { replace: false });
    rerender({ q: 'je' });
    act(() => result.current[1]('jelly '));
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    expect(onCommit).toHaveBeenLastCalledWith('jelly', { replace: true });
    rerender({ q: 'jelly' });
    act(() => result.current[1](''));
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    expect(onCommit).toHaveBeenLastCalledWith('', { replace: false });
    expect(onCommit).toHaveBeenCalledTimes(3);
  });

  it('a q changed from elsewhere (Back, Clear filters) becomes the text, committing nothing', () => {
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(({ q }) => useSearchDraft(q, onCommit), {
      initialProps: { q: 'gra' },
    });
    expect(result.current[0]).toBe('gra');
    rerender({ q: '' });
    expect(result.current[0]).toBe('');
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS * 2));
    expect(onCommit).not.toHaveBeenCalled();
  });
});
