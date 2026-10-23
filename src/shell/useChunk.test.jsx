import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useChunk } from './useChunk.js';

// A lazy chunk drawn as soon as it is in, with no Suspense (#578).

describe('useChunk', () => {
  it('nothing until the chunk is in, then its default export; one in already is there at once', async () => {
    const View = () => null;
    const load = () => Promise.resolve({ default: View });
    const first = renderHook(() => useChunk(load));
    expect(first.result.current).toEqual([null, false]);
    await waitFor(() => expect(first.result.current).toEqual([View, true]));
    // Asked again (another mount): in on the first render.
    const again = renderHook(() => useChunk(load));
    expect(again.result.current).toEqual([View, true]);
  });

  it('a chunk that fails to load settles with nothing, so the page draws without it', async () => {
    const load = () => Promise.reject(new Error('Failed to fetch dynamically imported module'));
    const { result } = renderHook(() => useChunk(load));
    await waitFor(() => expect(result.current).toEqual([null, true]));
  });
});
