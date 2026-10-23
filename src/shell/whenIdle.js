/** Calls `fn` once the browser is idle (soon, where it can't say); returns what cancels it. */
export function whenIdle(fn) {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(fn, { timeout: 3000 });
    return () => window.cancelIdleCallback?.(handle);
  }
  const timer = setTimeout(fn, 1500);
  return () => clearTimeout(timer);
}
