/*
 * A choice kept per browser (usePref.js, #313): read back on the next mount,
 * a value it doesn't know ignored, followed at once by every other reader of
 * the same key (the Overview, out of sight, and a page), and with storage
 * blocked lasting the visit.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePref } from './usePref.js';

const VALUES = Object.freeze(['cards', 'table']);
const use = (key = 'test-view') => usePref(key, VALUES, 'cards');

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('usePref', () => {
  it('the fallback first; a choice is stored and read back', () => {
    const { result } = renderHook(() => use());
    expect(result.current[0]).toBe('cards');
    act(() => result.current[1]('table'));
    expect(result.current[0]).toBe('table');
    expect(localStorage.getItem('test-view')).toBe('table');
    expect(renderHook(() => use()).result.current[0]).toBe('table');
  });

  it('ignores a value it does not know, stored or chosen', () => {
    localStorage.setItem('test-view', 'grid');
    const { result } = renderHook(() => use());
    expect(result.current[0]).toBe('cards');
    act(() => result.current[1]('grid'));
    expect(result.current[0]).toBe('cards');
  });

  it('every reader of the key follows a choice made in another; other keys do not', () => {
    const overview = renderHook(() => use());
    const page = renderHook(() => use());
    const other = renderHook(() => use('another-view'));
    act(() => page.result.current[1]('table'));
    expect(overview.result.current[0]).toBe('table');
    expect(other.result.current[0]).toBe('cards');
    // One that has gone hears nothing.
    page.unmount();
    act(() => overview.result.current[1]('cards'));
    expect(overview.result.current[0]).toBe('cards');
  });

  it('with storage blocked: the fallback, and a choice lasts the visit, for every reader', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const a = renderHook(() => use());
    const b = renderHook(() => use());
    expect(a.result.current[0]).toBe('cards');
    act(() => a.result.current[1]('table'));
    expect(a.result.current[0]).toBe('table');
    expect(b.result.current[0]).toBe('table');
  });
});
