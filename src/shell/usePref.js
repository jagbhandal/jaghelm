/**
 * A choice kept per browser (`prefs`, src/storage), such as the Infrastructure
 * section's cards or table and the Services section's grouping: one of
 * `values`, `fallback` until one is chosen (or when what is stored isn't one
 * of them). With storage blocked, a choice lasts the visit.
 *
 * Every part of the page that reads the same key follows a choice made in
 * another (#313): the Overview stays mounted out of sight while the Services
 * or Infrastructure page is open, and draws the choice made there when it
 * comes back.
 */
import { useCallback, useEffect, useState } from 'react';
import { prefs } from '../storage/index.js';

/** What each key's readers re-render with when one of them chooses. */
const readers = new Map();

/**
 * The choice under `key`, and what changes it (a value not in `values` is
 * ignored).
 *
 * @param {string} key
 * @param {ReadonlyArray<string>} values
 * @param {string} fallback
 * @returns {[string, (next: string) => void]}
 */
export function usePref(key, values, fallback) {
  const [value, setValue] = useState(() => {
    const stored = prefs.get(key);
    return values.includes(stored) ? stored : fallback;
  });

  useEffect(() => {
    if (!readers.has(key)) readers.set(key, new Set());
    const set = readers.get(key);
    set.add(setValue);
    return () => {
      set.delete(setValue);
      if (set.size === 0) readers.delete(key);
    };
  }, [key]);

  const choose = useCallback(
    (next) => {
      if (!values.includes(next)) return;
      prefs.set(key, next);
      setValue(next);
      for (const set of readers.get(key) ?? []) set(next);
    },
    // `values` is each caller's frozen list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );
  return [value, choose];
}
