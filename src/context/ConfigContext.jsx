import { createContext, useContext, useCallback, useMemo } from 'react';
import { setIn } from '../utils/setIn.js';

/**
 * ConfigContext — single source of the display config for the whole UI tree.
 *
 * Why a context instead of prop-drilling:
 *   App owns `const [config, setConfig] = useState(...)`. Previously that pair
 *   was drilled through DashboardView / SettingsView / NavBar and into all 13
 *   settings tabs (plus NodePanel → NodeCard, Widgets). Every render of App
 *   handed the children the SAME `config`/`setConfig`, but `update` was rebuilt
 *   inside SettingsView and any inline `() => setConfig(...)` closures were new
 *   each render — which defeats React.memo on the leaf cards.
 *
 *   By exposing `config`, the STABLE `setConfig` setter, and a memoised
 *   `update(path, value)` through context, consumers read exactly what they need
 *   and memo'd subtrees only re-render when `config` itself changes.
 *
 * Contract:
 *   - `setConfig` is the raw useState setter from App — stable across renders.
 *   - `update(path, value)` is wrapped in useCallback([setConfig]) so it, too,
 *     is stable. It performs an immutable structural-sharing deep-set via setIn,
 *     so untouched config branches keep their reference identity (memo-friendly).
 *   - The provided value object is memoised on [config, setConfig, update] so a
 *     re-render that doesn't change config hands consumers the same reference.
 */
const ConfigContext = createContext(null);

export function ConfigProvider({ config, setConfig, children }) {
  // Immutable deep-set by dotted/array path. Stable identity (depends only on
  // the stable setConfig) so consumers reading `update` don't thrash.
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
