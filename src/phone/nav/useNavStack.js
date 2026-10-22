import { useReducer, useMemo } from 'react';

/**
 * A minimal per-tab navigation stack (NOT a router lib). Each entry is
 * { screen, params }. push appends, pop drops the top (never below root),
 * reset replaces the whole stack with a single root. canPop drives hardware-back.
 */
function reducer(stack, action) {
  switch (action.type) {
    case 'push':
      return [...stack, { screen: action.screen, params: action.params }];
    case 'pop':
      return stack.length > 1 ? stack.slice(0, -1) : stack;
    case 'reset':
      return [action.root];
    default:
      return stack;
  }
}

export function useNavStack(root) {
  const [stack, dispatch] = useReducer(reducer, [root]);
  return useMemo(
    () => ({
      stack,
      current: stack[stack.length - 1],
      canPop: stack.length > 1,
      push: (screen, params) => dispatch({ type: 'push', screen, params }),
      pop: () => dispatch({ type: 'pop' }),
      reset: (r = root) => dispatch({ type: 'reset', root: r }),
    }),
    [stack] // root is stable per tab; reset default captured at first render is fine
  );
}
