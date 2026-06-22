import { createContext, useContext, useCallback, useMemo } from 'react';
import { setIn } from '../utils/setIn.js';

/**
 * ConfigContext — single source of the display config for the whole UI tree
 * (App owns the useState; this exposes it without prop-drilling through the 13
 * settings tabs and node/widget leaves).
 *
 * Memo-friendliness is the point: `update(path, value)` does an immutable
 * structural-sharing deep-set via setIn, so untouched config branches keep their
 * reference identity and React.memo'd subtrees don't thrash. Both `update` and
 * the provided value object are memoised on the stable setConfig, so a re-render
 * that doesn't change config hands consumers the same reference.
 */
const ConfigContext = createContext(null);

export function ConfigProvider({ config, setConfig, children }) {
  // Immutable deep-set by dotted/array path.
  const update = useCallback(
    (path, value) => {
      setConfig((prev) => setIn(prev, path, value));
    },
    [setConfig]
  );

  const value = useMemo(() => ({ config, setConfig, update }), [config, setConfig, update]);

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (ctx === null) {
    throw new Error('useConfig must be used within a <ConfigProvider>');
  }
  return ctx;
}
