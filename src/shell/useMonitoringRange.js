/**
 * The Monitoring range the user chose (#802), shared by the wide page
 * (MonitoringPage.jsx) and the phone's (phone/views/Monitoring.jsx). App.jsx
 * swaps the two trees at 768px, so a range held in either tree's own state
 * was lost on a rotation or a resize; held here, the tree that mounts next
 * starts from it. Kept for the life of the tab, not in the address: the
 * banner's View graph links are `/monitoring?focus=` and would drop a `?range=`.
 */
import { useCallback, useState } from 'react';
import { MONITORING_RANGES } from './monitoring.js';

const DEFAULT = MONITORING_RANGES[0].value;
let chosen = DEFAULT;

/** @returns {[string, (value: string) => void]} the range's value and its setter, like useState. */
export function useMonitoringRange() {
  const [value, setValue] = useState(chosen);
  const set = useCallback((next) => {
    chosen = next;
    setValue(next);
  }, []);
  return [value, set];
}

/** Back to the default, for tests (the choice outlives a mounted tree). */
export function resetMonitoringRange() {
  chosen = DEFAULT;
}
