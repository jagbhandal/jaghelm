import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { closeEntity, openEntity } from './entityNav.js';
import { useDrillSheet } from './drillSheet.js';
import { backOnce, clearBackPending } from './historyBack.js';

// #837: a fast double tap on a sheet's Back called history.back() twice, the second
// popping the entry under the sheet (the page). jsdom delivers popstate after the
// back() call returns, as a browser does, so two synchronous closes reproduce it.

const url = () => window.location.pathname + window.location.search;
const popped = () => new Promise((r) => window.addEventListener('popstate', r, { once: true }));
let back;

beforeEach(() => {
  clearBackPending();
  // Two entries under the sheet, so a second back() would visibly land on '/earlier'.
  window.history.pushState(null, '', '/earlier');
  window.history.pushState(null, '', '/page');
  back = vi.spyOn(window.history, 'back');
});
afterEach(() => back.mockRestore());

/** The two paths under test: open a sheet, and the close that sheet's Back calls. */
let n = 0;
const paths = {
  'a row sheet (closeEntity)': () => {
    act(() => openEntity('nodes/n'));
    return { close: () => closeEntity(), isOpen: () => url().includes('entity=') };
  },
  'the drill-down sheet (useDrillSheet)': () => {
    const node = `n${(n += 1)}`; // a new node each time: opening the shown one is a no-op
    const { result } = renderHook(() => useDrillSheet('cpu'));
    act(() => result.current.open(node));
    return { close: () => result.current.close(), isOpen: () => result.current.node === node };
  },
};

describe.each(Object.entries(paths))('%s', (_name, open) => {
  it('two closes before popstate go back once and stay on the page', async () => {
    const sheet = open();
    expect(sheet.isOpen()).toBe(true);
    const landed = popped();
    sheet.close();
    sheet.close();
    await landed;
    await new Promise((r) => setTimeout(r, 20));
    expect(back).toHaveBeenCalledTimes(1);
    expect(url()).toBe('/page');
    expect(sheet.isOpen()).toBe(false);
  });

  it('a single close still goes back, and a later sheet closes again', async () => {
    let sheet = open();
    let landed = popped();
    sheet.close();
    await landed;
    expect(back).toHaveBeenCalledTimes(1);
    expect(url()).toBe('/page');
    sheet = open();
    landed = popped();
    sheet.close();
    await landed;
    expect(back).toHaveBeenCalledTimes(2);
    expect(url()).toBe('/page');
  });

  it('a sheet reopened while a close is pending closes with its first tap', async () => {
    const sheet = open();
    sheet.close();
    // The reopen lands before the first close's popstate.
    const again = open();
    const landed = popped();
    again.close();
    await landed;
    expect(back).toHaveBeenCalledTimes(2);
  });
});

describe('the pending flag cannot stick', () => {
  it('the hardware Back while a close is pending clears it', async () => {
    act(() => openEntity('nodes/n'));
    let landed = popped();
    closeEntity();
    window.history.back(); // the hardware Back, before the close's popstate
    await landed;
    await new Promise((r) => setTimeout(r, 20));
    back.mockClear();
    act(() => openEntity('nodes/m'));
    landed = popped();
    closeEntity();
    await landed;
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('a back() whose popstate never comes is not pending once the entry is another', () => {
    window.history.replaceState({ a: 1 }, '', '/page');
    expect(backOnce()).toBe(true);
    expect(backOnce()).toBe(false);
    window.history.replaceState({ a: 2 }, '', '/page'); // another entry's state, no popstate
    expect(backOnce()).toBe(true);
  });

  it('unmounting the drill-down mid-pending clears it', () => {
    const { result, unmount } = renderHook(() => useDrillSheet('mem'));
    act(() => result.current.open('n'));
    result.current.close();
    unmount();
    expect(backOnce()).toBe(true);
  });
});
