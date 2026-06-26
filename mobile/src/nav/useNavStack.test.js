import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNavStack } from './useNavStack.js';

describe('useNavStack', () => {
  it('starts at root, pushes + pops detail, and reports canPop', () => {
    const { result } = renderHook(() => useNavStack({ screen: 'list' }));
    expect(result.current.current.screen).toBe('list');
    expect(result.current.canPop).toBe(false);
    act(() => result.current.push('detail', { id: 7 }));
    expect(result.current.current).toEqual({ screen: 'detail', params: { id: 7 } });
    expect(result.current.canPop).toBe(true);
    act(() => result.current.pop());
    expect(result.current.current.screen).toBe('list');
    expect(result.current.canPop).toBe(false);
  });
  it('pop at root is a no-op; reset clears to a new root', () => {
    const { result } = renderHook(() => useNavStack({ screen: 'a' }));
    act(() => result.current.pop());
    expect(result.current.current.screen).toBe('a');
    act(() => result.current.push('b'));
    act(() => result.current.reset({ screen: 'c' }));
    expect(result.current.current.screen).toBe('c');
    expect(result.current.canPop).toBe(false);
  });
});
